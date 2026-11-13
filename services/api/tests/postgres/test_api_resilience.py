"""Neon suspends an idle compute and closes every session: the API must reconnect on its own."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import psycopg
import pytest

from criteria.adapters.postgres.stores import _lock_key
from criteria.application.run_api import RunRequest
from tests import factories as f
from tests.postgres.api_support import Api

pytestmark = pytest.mark.integration

ME_ROUTES = ("/me/settings", "/me/usage", "/me/runs", "/me/credentials")


def _terminate_api_sessions(api: Api) -> int:
    rows = api.sql(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity"
        " WHERE usename = 'api_role' AND datname = current_database()"
    )
    return len(rows)


async def _complete_run(api: Api) -> list[str]:
    created = await api.create_run()
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]
    response, events = await api.stream(run_id)
    assert response.status_code == 200
    return [event["type"] for event in events]


async def test_every_route_works_after_the_server_closes_the_pooled_connections(
    api: Api,
) -> None:
    assert "en_espera_humano" in await _complete_run(api)
    for route in ME_ROUTES:
        assert (await api.client.get(route, headers=api.headers())).status_code == 200

    assert _terminate_api_sessions(api) > 0

    assert "en_espera_humano" in await _complete_run(api)
    for route in ME_ROUTES:
        response = await api.client.get(route, headers=api.headers())
        assert response.status_code == 200, (route, response.text)


async def test_a_stream_survives_losing_the_session_that_holds_its_lock(api: Api) -> None:
    created = await api.create_run()
    run_id = UUID(created.json()["run_id"])
    stream = await api.services.runs.open_stream("user-1", run_id, 0)
    kinds = []
    async for event in stream:
        if event is None:
            continue
        kinds.append(event.type)  # type: ignore[attr-defined]
        if len(kinds) == 1:
            assert _terminate_api_sessions(api) > 0

    assert kinds[-1] == "en_espera_humano"
    # The server dropped the lock with its session, so the next stream can take it.
    assert api.sql("SELECT pg_try_advisory_lock(%s)", _lock_key(run_id)) == [(True,)]


async def test_a_failing_cleanup_never_blocks_creating_a_run(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    closed = psycopg.errors.AdminShutdown("terminating connection due to administrator command")

    async def broken() -> int:
        raise closed

    monkeypatch.setattr(api.services.runs._checkpointer, "discard_orphans", broken)

    response = await api.create_run()

    assert response.status_code == 201, response.text
    assert api.reporter.reported == [(closed, None)]


def _quota(api: Api) -> tuple[list[tuple[Any, ...]], ...]:
    return (
        api.sql("SELECT count(*) FROM app.run_start"),
        api.sql("SELECT runs, cost_usd FROM app.usage_daily"),
        api.sql("SELECT runs, cost_usd FROM app.global_usage_daily"),
    )


async def test_a_run_that_cannot_be_stored_gives_back_its_quota(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _complete_run(api)
    before = _quota(api)
    runs = api.services.runs

    async def lost(_record: object) -> None:
        raise psycopg.OperationalError("server closed the connection unexpectedly")

    monkeypatch.setattr(runs._runs, "create", lost)

    with pytest.raises(psycopg.OperationalError):
        await runs.create("user-1", RunRequest(requerimiento=f.REQUERIMIENTO))

    assert _quota(api) == before
    assert api.sql("SELECT count(*) FROM app.run") == [(1,)]


async def test_releasing_twice_gives_back_the_quota_once(api: Api) -> None:
    usage = api.services.accounts._usage
    await _complete_run(api)
    before = _quota(api)
    reservation = await usage.reserve("user-1", datetime.now(UTC), True, 0.01)

    await usage.release(reservation)
    await usage.release(reservation)

    assert _quota(api) == before
