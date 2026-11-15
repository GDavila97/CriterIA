import json
import logging
from uuid import uuid4

import pytest

from tests import factories as f
from tests.postgres.api_support import Api, parse_sse

pytestmark = pytest.mark.integration

KEY = "sk-user-openai-secreta-1234"


async def _finished(api: Api, user: str = "user-1", **body: object) -> str:
    created = await api.create_run(user, guardar_historial=True, **body)
    run_id: str = created.json()["run_id"]
    _, before = await api.stream(run_id, user)
    await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers(user)
    )
    await api.stream(run_id, user, last_event_id=before[-1]["seq"])
    return run_id


async def test_a_saved_analysis_keeps_the_events_the_person_saw_and_nothing_else(
    api: Api,
) -> None:
    saved = await api.client.put(
        "/me/credentials/openai", json={"api_key": KEY}, headers=api.headers()
    )
    assert saved.status_code == 200
    await _finished(api, "someone-else")
    run_id = await _finished(api, proveedor="openai", nivel="economico")

    item = (await api.client.get(f"/me/runs/{run_id}", headers=api.headers())).json()

    events = item["events"]
    assert item["events_version"] == 1
    assert events[0]["type"] == "corrida_inicia"
    assert events[-1]["type"] == "corrida_fin"
    assert {e["run_id"] for e in events} == {run_id}
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    stored = json.dumps(events)
    assert KEY not in stored
    assert "user-1" not in stored
    assert "someone-else" not in stored


async def test_rows_written_by_the_previous_api_read_back_without_events(api: Api) -> None:
    # The API one version behind does not know the new columns: they stay NULL.
    api.headers("user-1")
    row_id = uuid4()
    api.sql(
        "INSERT INTO app.saved_run (id, user_id, requirement, artifacts, scores, status, provider,"
        " model, judge_model, prompt_version, judge_version, experimental, totals, created_at)"
        " VALUES (%s, 'user-1', %s, '{}', '[]', 'completada', 'groq', 'm', 'groq:m', 'v1', 'v1',"
        " false, '{}', now())",
        row_id,
        f.REQUERIMIENTO,
    )

    item = (await api.client.get(f"/me/runs/{row_id}", headers=api.headers())).json()

    assert (item["events"], item["events_version"]) == (None, None)


async def test_the_events_go_with_the_saved_analysis_and_the_account(api: Api) -> None:
    await _finished(api)
    assert api.sql("SELECT count(*) FROM app.saved_run WHERE events IS NOT NULL")[0][0] == 1

    api.sql("""DELETE FROM auth."user" WHERE id = 'user-1'""")

    assert api.sql("SELECT count(*) FROM app.saved_run")[0][0] == 0


async def test_one_saved_analysis_can_be_deleted_by_its_owner_only(api: Api) -> None:
    run_id = await _finished(api)
    other = await _finished(api, "someone-else")

    stranger = await api.client.delete(f"/me/runs/{run_id}", headers=api.headers("someone-else"))
    mine = await api.client.delete(f"/me/runs/{run_id}", headers=api.headers())
    again = await api.client.delete(f"/me/runs/{run_id}", headers=api.headers())

    assert (stranger.status_code, mine.status_code, again.status_code) == (404, 204, 404)
    assert api.sql("SELECT id::text FROM app.saved_run") == [(other,)]


async def test_deleting_a_saved_analysis_needs_a_session(api: Api) -> None:
    run_id = await _finished(api)

    response = await api.client.delete(f"/me/runs/{run_id}")

    assert response.status_code == 401
    assert response.json()["code"] == "no_autenticado"
    assert api.sql("SELECT count(*) FROM app.saved_run")[0][0] == 1


async def test_another_users_analysis_looks_the_same_as_one_that_does_not_exist(
    api: Api,
) -> None:
    run_id = await _finished(api)

    stranger = await api.client.delete(f"/me/runs/{run_id}", headers=api.headers("someone-else"))
    missing = await api.client.delete(f"/me/runs/{uuid4()}", headers=api.headers("someone-else"))

    assert stranger.status_code == missing.status_code == 404
    assert stranger.json() == missing.json()
    assert stranger.json()["code"] == "no_encontrado"
    assert run_id not in stranger.text
    assert api.sql("SELECT count(*) FROM app.saved_run")[0][0] == 1


@pytest.mark.api_settings(model_backend="fake", fake_model_delay_ms=40, sse_heartbeat_seconds=0.01)
async def test_the_saved_events_are_the_streamed_ones_without_heartbeats(api: Api) -> None:
    run_id = (await api.create_run(guardar_historial=True)).json()["run_id"]
    first = await api.client.get(f"/runs/{run_id}/stream", headers=api.headers())
    seen = parse_sse(first.text)
    await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers()
    )
    resumed = api.headers()
    resumed["last-event-id"] = str(seen[-1]["seq"])
    second = await api.client.get(f"/runs/{run_id}/stream", headers=resumed)
    seen += parse_sse(second.text)

    stored = (await api.client.get(f"/me/runs/{run_id}", headers=api.headers())).json()["events"]

    assert ": ping" in first.text + second.text
    assert stored == seen
    assert "ping" not in json.dumps(stored)


async def test_an_analysis_over_the_events_cap_is_saved_without_them(
    api: Api, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr("criteria.application.run_api.EVENTS_LIMIT_BYTES", 1024)
    caplog.set_level(logging.WARNING, logger="criteria.application.run_api")

    run_id = await _finished(api)

    item = (await api.client.get(f"/me/runs/{run_id}", headers=api.headers())).json()
    assert (item["events"], item["events_version"]) == (None, None)
    assert item["status"] == "completada"
    assert item["artifacts"]["historias"]
    assert f"run {run_id} saved without its events" in caplog.text
