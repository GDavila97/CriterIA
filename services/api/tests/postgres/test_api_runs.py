from uuid import UUID, uuid4

import pytest
from pydantic_ai import ModelHTTPError

from criteria.domain.approval import RespuestaHumana
from tests import factories as f
from tests.postgres.api_support import Api

pytestmark = pytest.mark.integration


async def _created(api: Api, user: str = "user-1", **body: object) -> str:
    response = await api.create_run(user, **body)
    assert response.status_code == 201, response.text
    return str(response.json()["run_id"])


async def test_full_run_create_stream_approve_stream_finish(api: Api) -> None:
    await api.client.put("/me/settings", json={"save_history": True}, headers=api.headers())

    created = await api.create_run()
    body = created.json()
    run_id = body["run_id"]
    first, before = await api.stream(run_id)
    approval = await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers()
    )
    _, after = await api.stream(run_id, last_event_id=before[-1]["seq"])

    assert created.status_code == 201
    assert body["generacion"] == {
        "proveedor": "groq",
        "modelo": "openai/gpt-oss-20b",
        "clave": "servidor",
        "temperatura": 0.2,
        "max_tokens": 4096,
    }
    assert body["juez_mismo_proveedor"] is True
    assert body["costo_estimado_usd"] > 0
    assert first.headers["content-type"].startswith("text/event-stream")
    assert first.headers["cache-control"] == "no-store"
    assert before[0]["type"] == "corrida_inicia"
    assert before[-1]["type"] == "en_espera_humano"
    assert approval.status_code == 204
    assert after[0]["type"] == "humano_responde"
    assert after[-1]["type"] == "corrida_fin"
    seqs = [e["seq"] for e in before + after]
    assert seqs == list(range(1, len(seqs) + 1))
    assert api.sql("SELECT count(*) FROM app.run")[0][0] == 0
    assert api.sql("SELECT count(*) FROM app.run_event")[0][0] == 0
    assert api.sql("SELECT count(*) FROM graph.checkpoints")[0][0] == 0
    history = (await api.client.get("/me/runs", headers=api.headers())).json()
    assert [item["id"] for item in history] == [run_id]
    item = (await api.client.get(f"/me/runs/{run_id}", headers=api.headers())).json()
    assert item["requirement"] == f.REQUERIMIENTO
    assert set(item["artifacts"]) == {"historias", "pruebas", "revision", "puntajes"}
    assert item["status"] == "completada"


async def test_runs_without_history_leave_nothing_behind(api: Api) -> None:
    run_id = await _created(api)
    await api.stream(run_id)
    await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers()
    )
    await api.stream(run_id)

    assert (await api.client.get("/me/runs", headers=api.headers())).json() == []
    assert api.sql("SELECT count(*) FROM app.saved_run")[0][0] == 0
    assert api.sql("SELECT count(*) FROM app.run")[0][0] == 0


async def test_reconnecting_with_last_event_id_replays_only_later_events(api: Api) -> None:
    run_id = await _created(api)
    _, first = await api.stream(run_id)

    _, replay = await api.stream(run_id, last_event_id=2)
    _, nothing_new = await api.stream(run_id, last_event_id=first[-1]["seq"])

    assert [e["seq"] for e in replay] == [e["seq"] for e in first if e["seq"] > 2]
    assert nothing_new == []


async def test_a_cut_stream_resumes_from_the_last_checkpoint(api: Api) -> None:
    run_id = await _created(api)
    stream = await api.services.runs.open_stream("user-1", UUID(run_id), 0)
    seen = []
    async for event in stream:
        if event is not None:
            seen.append(event.type)  # type: ignore[attr-defined]
        if len(seen) == 2:
            break
    await stream.aclose()  # type: ignore[attr-defined]

    assert api.sql("SELECT status FROM app.run")[0][0] == "en_curso"
    _, rest = await api.stream(run_id, last_event_id=2)
    types = [e["type"] for e in rest]
    assert types[-1] == "en_espera_humano"
    assert "corrida_inicia" not in types


async def test_an_approval_sent_as_soon_as_the_wait_event_arrives_is_kept(api: Api) -> None:
    run_id = UUID(await _created(api))
    stream = await api.services.runs.open_stream("user-1", run_id, 0)
    last_seq = 0
    async for event in stream:
        if event is None:
            continue
        last_seq = event.seq
        if event.type == "en_espera_humano":  # type: ignore[attr-defined]
            await api.services.runs.approve("user-1", run_id, RespuestaHumana(decision="aprobado"))

    _, after = await api.stream(str(run_id), last_event_id=last_seq)

    assert after[0]["type"] == "humano_responde"
    assert after[-1]["type"] == "corrida_fin"


async def test_a_second_stream_on_the_same_run_gets_409(api: Api) -> None:
    run_id = await _created(api)
    store = api.services.runs._runs

    async with store.stream_lock(UUID(run_id)):
        response, _ = await api.stream(run_id)

    assert response.status_code == 409
    assert response.json()["code"] == "stream_activo"
    retry, events = await api.stream(run_id)
    assert retry.status_code == 200
    assert events[-1]["type"] == "en_espera_humano"


async def test_someone_elses_run_looks_like_it_does_not_exist(api: Api) -> None:
    run_id = await _created(api, "owner")

    stream, _ = await api.stream(run_id, user="intruder")
    approval = await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers("intruder")
    )
    missing, _ = await api.stream(str(uuid4()), user="owner")

    for response in (stream, approval, missing):
        assert response.status_code == 404
        assert response.json()["code"] == "no_encontrado"


async def test_approval_is_only_accepted_while_waiting(api: Api) -> None:
    run_id = await _created(api)

    early = await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers()
    )
    await api.stream(run_id)
    invalid = await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "editado"}, headers=api.headers()
    )

    assert (early.status_code, early.json()["code"]) == (409, "estado_invalido")
    assert (invalid.status_code, invalid.json()["code"]) == (422, "entrada_invalida")


async def test_edited_stories_reach_qa(api: Api) -> None:
    run_id = await _created(api)
    _, before = await api.stream(run_id)
    edited = RespuestaHumana.model_validate(
        {
            "decision": "editado",
            "historias": {"historias": [f.historia(1, quiero="pagar en línea")]},
        }
    )

    await api.client.post(
        f"/runs/{run_id}/approval", json=edited.model_dump(mode="json"), headers=api.headers()
    )
    _, events = await api.stream(run_id, last_event_id=before[-1]["seq"])

    assert events[0]["decision"] == "editado"
    assert events[0]["historias"][0]["quiero"] == "pagar en línea"
    assert "pagar en línea" in api.team.prompts["qa"][0]


async def test_invalid_requirements_are_rejected_before_reserving(api: Api) -> None:
    short = await api.create_run(requerimiento="corto")
    long = await api.create_run(requerimiento="x" * 2001)

    for response in (short, long):
        assert (response.status_code, response.json()["code"]) == (422, "entrada_invalida")
    assert api.sql("SELECT count(*) FROM app.run_start")[0][0] == 0


async def test_abandoned_runs_are_cleaned_when_another_run_starts(api: Api) -> None:
    old = await _created(api, "user-a")
    await api.stream(old, user="user-a")
    api.sql("UPDATE app.run SET updated_at = now() - interval '2 hours' WHERE id = %s", old)
    assert api.sql("SELECT count(*) FROM graph.checkpoints WHERE thread_id = %s", old)[0][0] > 0

    await _created(api, "user-b")

    assert api.sql("SELECT count(*) FROM app.run WHERE id = %s", old)[0][0] == 0
    assert api.sql("SELECT count(*) FROM app.run_event WHERE run_id = %s", old)[0][0] == 0
    assert api.sql("SELECT count(*) FROM graph.checkpoints WHERE thread_id = %s", old)[0][0] == 0


async def test_providers_without_access_need_the_users_key(api: Api) -> None:
    response = await api.create_run(proveedor="openai")

    assert (response.status_code, response.json()["code"]) == (422, "clave_requerida")
    assert api.sql("SELECT count(*) FROM app.run_start")[0][0] == 0


async def test_a_failing_agent_ends_the_run_with_its_code_and_suggestion(api: Api) -> None:
    api.team.scripts["analista"] = [ModelHTTPError(429, "groq")]
    run_id = await _created(api)

    _, events = await api.stream(run_id)

    assert events[-2]["type"] == "agente_error"
    assert events[-2]["codigo"] == "limite_proveedor"
    assert events[-2]["respaldo_sugerido"] is None
    assert events[-1]["estado"] == "error"
    assert api.sql("SELECT count(*) FROM app.run")[0][0] == 0


async def test_history_keeps_the_stories_the_person_approved(api: Api) -> None:
    await api.client.put("/me/settings", json={"save_history": True}, headers=api.headers())
    run_id = (await api.create_run()).json()["run_id"]
    _, before = await api.stream(run_id)
    edited = RespuestaHumana.model_validate(
        {
            "decision": "editado",
            "historias": {"historias": [f.historia(1, quiero="pagar en línea")]},
        }
    )
    await api.client.post(
        f"/runs/{run_id}/approval", json=edited.model_dump(mode="json"), headers=api.headers()
    )
    await api.stream(run_id, last_event_id=before[-1]["seq"])

    item = (await api.client.get(f"/me/runs/{run_id}", headers=api.headers())).json()

    assert [h["quiero"] for h in item["artifacts"]["historias"]["historias"]] == ["pagar en línea"]
