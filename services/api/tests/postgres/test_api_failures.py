from typing import Any
from uuid import UUID

import psycopg
import pytest

from criteria.adapters.postgres.stores import _lock_key
from criteria.application.run_api import INTERNAL_ERROR_MESSAGE
from tests.postgres.api_support import Api

pytestmark = pytest.mark.integration


async def _created(api: Api, user: str = "user-1") -> str:
    response = await api.create_run(user)
    assert response.status_code == 201, response.text
    return str(response.json()["run_id"])


async def _cut_after_the_first_delivery(api: Api, run_id: str, user: str = "user-1") -> None:
    stream = await api.services.runs.open_stream(user, UUID(run_id), 0)
    async for event in stream:
        if event is not None and event.type == "agente_entrega":  # type: ignore[attr-defined]
            break
    await stream.aclose()  # type: ignore[attr-defined]


def _spent(api: Api, run_id: str) -> float:
    rows = api.sql(
        "SELECT payload FROM app.run_event WHERE run_id = %s AND type = 'agente_entrega'", run_id
    )
    return round(sum(float(row[0]["uso"]["costo_usd"]) for row in rows), 6)


def _costs(api: Api, user: str = "user-1") -> tuple[float, float]:
    [(user_cost,)] = api.sql("SELECT cost_usd FROM app.usage_daily WHERE user_id = %s", user)
    [(global_cost,)] = api.sql("SELECT cost_usd FROM app.global_usage_daily")
    return float(user_cost), float(global_cost)


async def test_an_error_in_a_node_ends_the_run_and_settles_the_real_cost(api: Api) -> None:
    await api.client.put("/me/settings", json={"save_history": True}, headers=api.headers())
    boom = RuntimeError("secret-requirement-text")
    api.broken = {"qa": boom}
    run_id = await _created(api)
    _, before = await api.stream(run_id)
    spent = _spent(api, run_id)
    await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers()
    )

    response, after = await api.stream(run_id, last_event_id=before[-1]["seq"])

    end: dict[str, Any] = after[-1]
    assert response.status_code == 200
    assert (end["type"], end["estado"], end["codigo"]) == ("corrida_fin", "error", "error_interno")
    assert end["mensaje"] == INTERNAL_ERROR_MESSAGE
    assert "secret-requirement-text" not in response.text
    assert api.reporter.reported == [(boom, UUID(run_id))]
    assert api.sql("SELECT count(*) FROM app.run") == [(0,)]
    assert api.sql("SELECT count(*) FROM graph.checkpoints") == [(0,)]
    assert _costs(api) == pytest.approx((spent, spent), abs=1e-6)
    assert api.sql("SELECT status FROM app.saved_run") == [("error",)]


async def test_a_run_left_by_a_crashed_instance_resumes_from_its_checkpoint(api: Api) -> None:
    run_id = await _created(api)
    await _cut_after_the_first_delivery(api, run_id)
    [(last_seq,)] = api.sql("SELECT max(seq) FROM app.run_event WHERE run_id = %s", run_id)
    # The crashed instance still holds the stream lock until Postgres drops its session.
    dead = psycopg.connect(api.database.admin, autocommit=True)
    dead.execute("SELECT pg_advisory_lock(%s)", (_lock_key(UUID(run_id)),))
    [(pid,)] = dead.execute("SELECT pg_backend_pid()").fetchall()

    busy, _ = await api.stream(run_id, last_event_id=last_seq)
    api.sql("SELECT pg_terminate_backend(%s)", pid)
    dead.close()
    resumed, events = await api.stream(run_id, last_event_id=last_seq)

    assert busy.status_code == 409
    assert api.sql("SELECT status FROM app.run WHERE id = %s", run_id) == [
        ("esperando_aprobacion",)
    ]
    assert resumed.status_code == 200
    assert events[-1]["type"] == "en_espera_humano"
    assert "corrida_inicia" not in [e["type"] for e in events]
    assert [e["seq"] for e in events] == list(range(last_seq + 1, last_seq + 1 + len(events)))


async def test_a_crash_while_closing_is_finished_once_by_the_next_stream(api: Api) -> None:
    await api.client.put("/me/settings", json={"save_history": True}, headers=api.headers())
    run_id = await _created(api)
    _, before = await api.stream(run_id)
    await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers()
    )
    store: Any = api.services.runs._runs
    delete = store.delete

    async def crash_once(target: UUID) -> None:
        store.delete = delete
        raise ConnectionError("instance lost")

    store.delete = crash_once
    with pytest.raises(ConnectionError):
        await api.stream(run_id, last_event_id=before[-1]["seq"])
    [(last_seq,)] = api.sql("SELECT max(seq) FROM app.run_event WHERE run_id = %s", run_id)
    spent = _spent(api, run_id)
    calls = dict(api.team.calls)

    closed, replay = await api.stream(run_id, last_event_id=last_seq)

    assert closed.status_code == 200
    assert replay == []
    assert api.team.calls == calls
    assert api.sql("SELECT count(*) FROM app.run") == [(0,)]
    assert api.sql("SELECT count(*) FROM app.saved_run") == [(1,)]
    assert _costs(api) == pytest.approx((spent, spent), abs=1e-6)


async def test_an_orphan_older_than_the_ttl_fails_and_returns_the_unused_quota(
    api: Api,
) -> None:
    created = (await api.create_run("user-a")).json()
    run_id = created["run_id"]
    await _cut_after_the_first_delivery(api, run_id, "user-a")
    spent = _spent(api, run_id)
    api.sql("UPDATE app.run SET updated_at = now() - interval '61 minutes' WHERE id = %s", run_id)

    await _created(api, "user-b")

    assert api.sql("SELECT count(*) FROM app.run WHERE id = %s", run_id) == [(0,)]
    assert api.sql("SELECT count(*) FROM app.run_event WHERE run_id = %s", run_id) == [(0,)]
    assert api.sql("SELECT count(*) FROM graph.checkpoints WHERE thread_id = %s", run_id) == [(0,)]
    [(user_cost,)] = api.sql("SELECT cost_usd FROM app.usage_daily WHERE user_id = 'user-a'")
    assert 0 < spent < created["costo_servidor_usd"]
    assert float(user_cost) == pytest.approx(spent, abs=1e-6)


async def test_an_orphan_with_a_live_stream_is_not_cleaned(api: Api) -> None:
    run_id = await _created(api, "user-a")
    api.sql("UPDATE app.run SET updated_at = now() - interval '2 hours' WHERE id = %s", run_id)
    store: Any = api.services.runs._runs

    async with store.stream_lock(UUID(run_id)):
        await _created(api, "user-b")

    assert api.sql("SELECT status FROM app.run WHERE id = %s", run_id) == [("creada",)]
