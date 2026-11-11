import asyncio
from collections import Counter
from collections.abc import Sequence

import httpx
import pytest

from tests.postgres.api_support import Api

pytestmark = pytest.mark.integration

OPENAI_KEY = "sk-user-openai-0000"


def _codes(responses: Sequence[httpx.Response]) -> Counter[int | str]:
    return Counter(r.status_code if r.status_code == 201 else r.json()["code"] for r in responses)


async def _with_openai_key(api: Api, user: str) -> None:
    saved = await api.client.put(
        "/me/credentials/openai", json={"api_key": OPENAI_KEY}, headers=api.headers(user)
    )
    assert saved.status_code == 200, saved.text


async def test_the_hourly_limit_stops_the_sixth_run(api: Api) -> None:
    responses = [await api.create_run() for _ in range(6)]

    assert [r.status_code for r in responses] == [201] * 5 + [429]
    assert responses[-1].json() == {
        "code": "limite_hora",
        "message": "Alcanzaste el límite de corridas por hora.",
    }
    assert (await api.create_run("someone-else")).status_code == 201


async def test_runs_older_than_an_hour_no_longer_count(api: Api) -> None:
    for _ in range(5):
        await api.create_run()
    api.sql("UPDATE app.run_start SET started_at = now() - interval '61 minutes'")

    assert (await api.create_run()).status_code == 201


@pytest.mark.api_settings(user_runs_per_hour=50, user_runs_per_day=2)
async def test_the_daily_limit_applies_across_hours(api: Api) -> None:
    responses = [await api.create_run() for _ in range(3)]

    assert _codes(responses) == {201: 2, "limite_dia": 1}


@pytest.mark.api_settings(global_daily_runs=2)
async def test_the_global_cap_closes_the_free_mode_for_everyone(api: Api) -> None:
    responses = [await api.create_run(f"user-{i}") for i in range(3)]

    assert _codes(responses) == {201: 2, "cupo_gratuito_agotado": 1}
    assert api.sql("SELECT runs FROM app.global_usage_daily") == [(2,)]


@pytest.mark.api_settings(global_daily_budget_usd=0.012)
async def test_the_global_budget_counts_reserved_dollars(api: Api) -> None:
    first = await api.create_run("user-a")
    reserved = first.json()["costo_servidor_usd"]
    second = await api.create_run("user-b")

    assert 0.006 < reserved <= 0.012 < 2 * reserved
    assert (second.status_code, second.json()["code"]) == (429, "cupo_gratuito_agotado")


@pytest.mark.api_settings(global_daily_runs=1)
async def test_two_simultaneous_reservations_cannot_both_take_the_last_slot(api: Api) -> None:
    responses = await asyncio.gather(*(api.create_run(f"racer-{i}") for i in range(2)))

    assert _codes(responses) == {201: 1, "cupo_gratuito_agotado": 1}
    assert api.sql("SELECT runs FROM app.global_usage_daily") == [(1,)]


@pytest.mark.api_settings(user_runs_per_hour=1)
async def test_one_user_racing_against_themselves_gets_one_run(api: Api) -> None:
    responses = await asyncio.gather(*(api.create_run() for _ in range(3)))

    assert _codes(responses) == {201: 1, "limite_hora": 2}
    assert api.sql("SELECT count(*) FROM app.run_start") == [(1,)]


@pytest.mark.api_settings(global_daily_runs=1)
async def test_runs_with_the_users_own_keys_skip_the_global_cap(api: Api) -> None:
    await _with_openai_key(api, "user-1")
    assert (await api.create_run("user-2")).status_code == 201

    own = await api.create_run("user-1", proveedor="openai", juez="openai")
    body = own.json()

    assert own.status_code == 201, own.text
    assert body["generacion"]["clave"] == body["juez"]["clave"] == "usuario"
    assert body["costo_servidor_usd"] == 0
    assert api.sql("SELECT runs FROM app.global_usage_daily") == [(1,)]


async def test_finished_runs_settle_the_reservation_to_the_real_cost(api: Api) -> None:
    created = (await api.create_run()).json()
    run_id = created["run_id"]
    _, before = await api.stream(run_id)
    await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers()
    )
    _, after = await api.stream(run_id, last_event_id=before[-1]["seq"])

    real = after[-1]["totales"]["costo_usd"]
    [(user_cost,)] = api.sql("SELECT cost_usd FROM app.usage_daily")
    [(global_cost,)] = api.sql("SELECT cost_usd FROM app.global_usage_daily")
    assert float(user_cost) == pytest.approx(real, abs=1e-6)
    assert float(global_cost) == pytest.approx(real, abs=1e-6)
    assert real != pytest.approx(created["costo_servidor_usd"], abs=1e-9)
