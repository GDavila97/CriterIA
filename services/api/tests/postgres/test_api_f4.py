"""Account deletion, another version, per-agent options, usage and the fake backend over HTTP."""

from typing import Any

import pytest

from criteria.domain.approval import MAX_OTRAS_VERSIONES
from tests import factories as f
from tests.postgres.api_support import Api

pytestmark = pytest.mark.integration


async def _created(api: Api, user: str = "user-1", **body: object) -> dict[str, Any]:
    response = await api.create_run(user, **body)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def _approve(api: Api, run_id: str, body: dict[str, Any], user: str = "user-1") -> Any:
    return await api.client.post(f"/runs/{run_id}/approval", json=body, headers=api.headers(user))


async def test_deleting_the_account_deletes_every_row_of_the_user(api: Api) -> None:
    await api.client.put("/me/settings", json={"save_history": True}, headers=api.headers())
    await api.client.put(
        "/me/credentials/openai", json={"api_key": "sk-user-0000"}, headers=api.headers()
    )
    run_id = (await _created(api))["run_id"]
    _, before = await api.stream(run_id)
    await _approve(api, run_id, {"decision": "aprobado"})
    await api.stream(run_id, last_event_id=before[-1]["seq"])
    await _created(api)
    await _created(api, "someone-else")

    api.sql('DELETE FROM auth."user" WHERE id = %s', "user-1")

    left = api.sql(
        "SELECT (SELECT count(*) FROM app.user_settings WHERE user_id = 'user-1')"
        " + (SELECT count(*) FROM app.provider_credential WHERE user_id = 'user-1')"
        " + (SELECT count(*) FROM app.credential_check WHERE user_id = 'user-1')"
        " + (SELECT count(*) FROM app.usage_daily WHERE user_id = 'user-1')"
        " + (SELECT count(*) FROM app.run_start WHERE user_id = 'user-1')"
        " + (SELECT count(*) FROM app.run WHERE user_id = 'user-1')"
        " + (SELECT count(*) FROM app.saved_run WHERE user_id = 'user-1')"
    )
    assert left == [(0,)]
    assert api.sql("SELECT count(*) FROM app.run WHERE user_id = 'someone-else'") == [(1,)]


async def test_checkpoints_left_by_a_deleted_account_are_cleaned_later(api: Api) -> None:
    run_id = (await _created(api, "leaving"))["run_id"]
    await api.stream(run_id, user="leaving")
    assert api.sql("SELECT count(*) FROM graph.checkpoints WHERE thread_id = %s", run_id) != [(0,)]

    api.sql('DELETE FROM auth."user" WHERE id = %s', "leaving")
    await _created(api, "staying")

    assert api.sql("SELECT count(*) FROM graph.checkpoints WHERE thread_id = %s", run_id) == [(0,)]
    assert api.sql("SELECT count(*) FROM graph.checkpoint_blobs WHERE thread_id = %s", run_id) == [
        (0,)
    ]


async def test_the_api_refuses_rows_for_users_that_do_not_exist(api: Api) -> None:
    with pytest.raises(Exception, match="foreign key"):
        api.sql("INSERT INTO app.user_settings (user_id) VALUES ('ghost')")


async def test_another_version_reruns_the_analista_and_costs_dollars_not_a_run(
    api: Api,
) -> None:
    api.team.scripts["analista"] = [f.historias(1), f.historias(2), f.historias(2)]
    created = await _created(api)
    run_id = created["run_id"]
    _, first = await api.stream(run_id)
    [(reserved_before,)] = api.sql("SELECT server_cost_reserved_usd FROM app.run")

    accepted = await _approve(api, run_id, {"decision": "otra_version", "nota": "Más corto"})
    _, second = await api.stream(run_id, last_event_id=first[-1]["seq"])
    [(reserved_after,)] = api.sql("SELECT server_cost_reserved_usd FROM app.run")

    assert accepted.status_code == 204
    assert second[0]["decision"] == "otra_version"
    assert second[-1]["type"] == "en_espera_humano"
    assert len(second[-1]["historias"]) == 2
    assert "Más corto" in api.team.prompts["analista"][1]
    assert float(reserved_after) > float(reserved_before)
    assert api.sql("SELECT runs FROM app.usage_daily") == [(1,)]
    assert api.sql("SELECT runs FROM app.global_usage_daily") == [(1,)]


async def test_only_two_new_versions_are_allowed(api: Api) -> None:
    api.team.scripts["analista"] = [f.historias(1)] * 3
    run_id = (await _created(api))["run_id"]
    _, events = await api.stream(run_id)
    last = events[-1]["seq"]
    for _ in range(MAX_OTRAS_VERSIONES):
        await _approve(api, run_id, {"decision": "otra_version"})
        _, events = await api.stream(run_id, last_event_id=last)
        last = events[-1]["seq"]

    refused = await _approve(api, run_id, {"decision": "otra_version"})

    assert (refused.status_code, refused.json()["code"]) == (409, "versiones_agotadas")
    assert (await _approve(api, run_id, {"decision": "aprobado"})).status_code == 204


async def test_notes_only_travel_with_a_request_for_another_version(api: Api) -> None:
    run_id = (await _created(api))["run_id"]
    await api.stream(run_id)

    response = await _approve(api, run_id, {"decision": "aprobado", "nota": "hola"})

    assert (response.status_code, response.json()["code"]) == (422, "entrada_invalida")


async def test_per_agent_options_and_the_history_choice_are_kept(api: Api) -> None:
    created = await _created(
        api,
        agentes={"qa": {"modelo": "openai/gpt-oss-20b", "temperatura": 0.7}},
        max_rondas=3,
        guardar_historial=True,
    )

    assert created["agentes"]["qa"]["modelo"] == "openai/gpt-oss-20b"
    assert created["agentes"]["qa"]["temperatura"] == 0.7
    assert created["agentes"]["analista"]["modelo"] == "openai/gpt-oss-20b"
    assert (created["max_rondas"], created["guardar_historial"]) == (3, True)
    assert api.sql("SELECT save_history FROM app.run") == [(True,)]


@pytest.mark.parametrize(
    "body",
    [
        {"agentes": {"qa": {"temperatura": 1.5}}},
        {"agentes": {"qa": {"max_tokens": 100}}},
        {"agentes": {"juez": {}}},
        {"max_rondas": 4},
    ],
)
async def test_out_of_range_options_are_rejected(api: Api, body: dict[str, Any]) -> None:
    response = await api.create_run(**body)

    assert (response.status_code, response.json()["code"]) == (422, "entrada_invalida")


async def test_usage_reports_what_is_left_this_hour(api: Api) -> None:
    await _created(api)
    await _created(api)

    usage = (await api.client.get("/me/usage", headers=api.headers())).json()

    assert usage == {"corridas_hora": 2, "limite_hora": 5, "corridas_dia": 2, "limite_dia": 20}


async def test_agents_lists_the_prompts_and_the_limits(api: Api) -> None:
    body = (await api.client.get("/agents", headers=api.headers())).json()

    assert (body["version_prompts"], body["version_juez"]) == ("v1", "v1")
    assert set(body["prompts"]) == {"analista", "qa", "revisor", "evaluador"}
    assert all(len(text) > 100 for text in body["prompts"].values())
    assert body["temperatura_maxima"] == 1.0
    assert (body["max_tokens_minimo"], body["max_tokens_maximo"]) == (256, 16384)
    assert body["rondas_maximas"] == 3


@pytest.mark.api_settings(auth_require_verified_email=False)
async def test_unverified_accounts_can_run_while_email_is_off(api: Api) -> None:
    response = await api.client.post(
        "/runs",
        json={"requerimiento": f.REQUERIMIENTO},
        headers=api.headers(verified=False),
    )

    assert response.status_code == 201


@pytest.mark.api_settings(model_backend="fake", fake_model_delay_ms=0)
async def test_the_fake_backend_runs_a_whole_run_without_any_provider(api: Api) -> None:
    run_id = (await _created(api))["run_id"]
    _, first = await api.stream(run_id)
    await _approve(api, run_id, {"decision": "aprobado"})

    _, rest = await api.stream(run_id, last_event_id=first[-1]["seq"])

    assert rest[-1]["type"] == "corrida_fin"
    assert rest[-1]["estado"] == "completada"
    revisor_cases = [
        caso
        for e in rest
        if e["type"] == "agente_entrega" and e["artefactos"]["tipo"] == "pruebas"
        for caso in e["artefactos"]["casos"]
        if caso["origen"] == "revisor"
    ]
    assert [c["id"] for c in revisor_cases] == ["CP-90"]


@pytest.mark.api_settings(model_backend="fake", fake_model_delay_ms=0)
async def test_the_fake_backend_reproduces_a_key_without_balance(api: Api) -> None:
    saved = await api.client.put(
        "/me/credentials/openai", json={"api_key": "nosaldo-0000"}, headers=api.headers()
    )
    run_id = (await _created(api, proveedor="openai", juez="openai"))["run_id"]

    _, events = await api.stream(run_id)

    assert saved.status_code == 200
    error = next(e for e in events if e["type"] == "agente_error")
    assert (error["codigo"], error["respaldo_sugerido"]) == ("sin_saldo", "groq")
