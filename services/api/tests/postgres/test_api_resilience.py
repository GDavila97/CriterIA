"""Neon suspends an idle compute and closes every session: the API must reconnect on its own."""

from uuid import UUID

import pytest

from criteria.adapters.postgres.stores import _lock_key
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
