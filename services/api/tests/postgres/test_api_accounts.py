from uuid import uuid4

import httpx
import pytest

from tests import factories as f
from tests.postgres.api_support import Api

pytestmark = pytest.mark.integration

KEY = "sk-user-openai-7k2Q"


async def _put_key(
    api: Api, provider: str = "openai", user: str = "user-1", **body: object
) -> httpx.Response:
    return await api.client.put(
        f"/me/credentials/{provider}", json={"api_key": KEY, **body}, headers=api.headers(user)
    )


async def _finished_run(api: Api, user: str = "user-1") -> str:
    run_id = str((await api.create_run(user)).json()["run_id"])
    _, before = await api.stream(run_id, user=user)
    await api.client.post(
        f"/runs/{run_id}/approval", json={"decision": "aprobado"}, headers=api.headers(user)
    )
    await api.stream(run_id, user=user, last_event_id=before[-1]["seq"])
    return run_id


class TestCredentials:
    async def test_saved_keys_are_encrypted_and_only_the_last_four_come_back(
        self, api: Api
    ) -> None:
        saved = await _put_key(api)
        listed = await api.client.get("/me/credentials", headers=api.headers())

        assert saved.status_code == 200
        assert saved.json()["last4"] == "7k2Q"
        assert [item["proveedor"] for item in listed.json()] == ["openai"]
        for response in (saved, listed):
            assert KEY not in response.text
        [(ciphertext, nonce, version)] = api.sql(
            "SELECT ciphertext, nonce, key_version FROM app.provider_credential"
        )
        assert KEY.encode() not in bytes(ciphertext)
        assert (len(bytes(nonce)), version) == (12, 1)

    async def test_saving_again_replaces_the_key_with_a_new_ciphertext(self, api: Api) -> None:
        await _put_key(api)
        [(first,)] = api.sql("SELECT ciphertext FROM app.provider_credential")
        await _put_key(api)

        [(second,)] = api.sql("SELECT ciphertext FROM app.provider_credential")
        assert bytes(first) != bytes(second)

    @pytest.mark.parametrize(
        ("key", "code"),
        [("sk-bad-0000", "clave_invalida"), ("sk-down-0000", "clave_no_verificable")],
    )
    async def test_rejected_keys_are_not_stored(self, api: Api, key: str, code: str) -> None:
        response = await api.client.put(
            "/me/credentials/anthropic", json={"api_key": key}, headers=api.headers()
        )

        assert (response.status_code, response.json()["code"]) == (422, code)
        assert key not in response.text
        assert api.sql("SELECT count(*) FROM app.provider_credential") == [(0,)]

    @pytest.mark.api_settings(credential_checks_per_hour=2)
    async def test_validations_are_rate_limited_per_user(self, api: Api) -> None:
        responses = [await _put_key(api) for _ in range(3)]

        assert [r.status_code for r in responses] == [200, 200, 429]
        assert responses[-1].json()["code"] == "limite_validaciones"
        assert api.validator.checked == ["openai", "openai"]
        assert (await _put_key(api, user="user-2")).status_code == 200

    @pytest.mark.parametrize(
        ("provider", "body", "code"),
        [
            ("openai_compatible", {"base_url": "https://10.0.0.5/v1"}, "destino_no_permitido"),
            (
                "openai_compatible",
                {"base_url": "http://llm.example.com/v1"},
                "destino_no_permitido",
            ),
            ("openai_compatible", {}, "entrada_invalida"),
            ("openai", {"base_url": "https://llm.example.com/v1"}, "entrada_invalida"),
            ("ollama", {}, "entrada_invalida"),
        ],
    )
    async def test_endpoints_and_providers_are_checked_before_validating(
        self, api: Api, provider: str, body: dict[str, str], code: str
    ) -> None:
        response = await _put_key(api, provider, **body)

        assert response.json()["code"] == code
        assert api.validator.checked == []

    async def test_a_compatible_endpoint_keeps_its_url(self, api: Api) -> None:
        response = await _put_key(api, "openai_compatible", base_url="https://llm.example.com/v1")

        assert response.json()["base_url"] == "https://llm.example.com/v1"

    async def test_deleting_a_key_twice_reports_it_is_gone(self, api: Api) -> None:
        await _put_key(api)

        first = await api.client.delete("/me/credentials/openai", headers=api.headers())
        second = await api.client.delete("/me/credentials/openai", headers=api.headers())

        assert (first.status_code, second.status_code) == (204, 404)

    async def test_keys_belong_to_one_user(self, api: Api) -> None:
        await _put_key(api, user="owner")

        listed = await api.client.get("/me/credentials", headers=api.headers("other"))
        deleted = await api.client.delete("/me/credentials/openai", headers=api.headers("other"))

        assert listed.json() == []
        assert deleted.status_code == 404

    async def test_runs_use_the_decrypted_key_only_inside_the_selection(self, api: Api) -> None:
        await _put_key(api)

        created = await api.create_run(proveedor="openai", juez="openai")
        _, events = await api.stream(created.json()["run_id"])

        generation, judge = api.selections[0].analista, api.selections[0].evaluador
        assert generation.api_key is not None
        assert generation.api_key.get_secret_value() == KEY
        assert judge.api_key == generation.api_key
        assert KEY not in created.text
        assert all(KEY not in str(event) for event in events)
        assert api.sql(
            "SELECT count(*) FROM app.run_event WHERE payload::text LIKE %s", f"%{KEY}%"
        ) == [(0,)]


class TestSettingsAndCatalog:
    async def test_settings_start_with_defaults_and_persist(self, api: Api) -> None:
        empty = await api.client.get("/me/settings", headers=api.headers())
        wanted = {
            "save_history": True,
            "default_provider": "groq",
            "default_tier": "economico",
            "judge_provider": "groq",
        }
        saved = await api.client.put("/me/settings", json=wanted, headers=api.headers())
        read = await api.client.get("/me/settings", headers=api.headers())

        assert empty.json()["save_history"] is False
        assert saved.json() == read.json() == wanted

    async def test_catalog_reflects_server_access_and_the_users_keys(self, api: Api) -> None:
        before = (await api.client.get("/catalog", headers=api.headers())).json()
        await _put_key(api)
        after = (await api.client.get("/catalog", headers=api.headers())).json()

        by_provider = {p["proveedor"]: p for p in before["proveedores"]}
        assert by_provider["groq"]["clave"] == "servidor"
        assert by_provider["openai"]["disponible"] is False
        assert by_provider["groq"]["acepta_clave_propia"] is True
        assert by_provider["ollama"]["acepta_clave_propia"] is False
        assert by_provider["groq"]["niveles"][0]["costo_estimado_usd"] > 0
        assert before["proveedor_predeterminado"] == "groq"
        openai = next(p for p in after["proveedores"] if p["proveedor"] == "openai")
        assert (openai["disponible"], openai["clave"]) == (True, "usuario")
        assert {t["nivel"] for t in openai["niveles"]} == {"economico", "equilibrado", "maximo"}


class TestHistory:
    async def test_history_is_private_and_can_be_cleared(self, api: Api) -> None:
        for user in ("owner", "other"):
            await api.client.put(
                "/me/settings", json={"save_history": True}, headers=api.headers(user)
            )
        run_id = await _finished_run(api, "owner")
        await _finished_run(api, "other")

        foreign = await api.client.get(f"/me/runs/{run_id}", headers=api.headers("other"))
        missing = await api.client.get(f"/me/runs/{uuid4()}", headers=api.headers("owner"))
        summary = (await api.client.get("/me/runs", headers=api.headers("owner"))).json()
        cleared = await api.client.delete("/me/runs", headers=api.headers("owner"))

        assert (foreign.status_code, missing.status_code) == (404, 404)
        assert [item["id"] for item in summary] == [run_id]
        assert summary[0]["scores"]
        assert cleared.json() == {"deleted": 1}
        assert (await api.client.get("/me/runs", headers=api.headers("owner"))).json() == []
        assert len((await api.client.get("/me/runs", headers=api.headers("other"))).json()) == 1

    async def test_saved_runs_keep_versions_and_totals(self, api: Api) -> None:
        await api.client.put("/me/settings", json={"save_history": True}, headers=api.headers())
        run_id = await _finished_run(api)

        item = (await api.client.get(f"/me/runs/{run_id}", headers=api.headers())).json()

        assert (item["prompt_version"], item["judge_version"]) == ("v1", "v1")
        assert item["provider"] == "groq"
        assert item["experimental"] is False
        assert item["totals"]["costo_usd"] > 0
        assert item["requirement"] == f.REQUERIMIENTO


class TestEvaluation:
    async def test_evaluation_is_public_cached_and_aggregated(self, api: Api) -> None:
        batch, case = uuid4(), uuid4()
        api.sql(
            "INSERT INTO app.eval_case (id, title, text, difficulty) VALUES (%s, 't', 'x', 'baja')",
            case,
        )
        api.sql(
            "INSERT INTO app.eval_batch (id, provider, model, prompt_version, judge_model,"
            " judge_version, output_mode, git_sha) VALUES (%s, 'groq', 'm', 'v1', 'j', 'v1',"
            " 'native', 'abc')",
            batch,
        )
        for latency, valid, cost in ((100, True, 0.01), (300, False, 0.03)):
            api.sql(
                "INSERT INTO app.eval_result (id, batch_id, case_id, artifacts, valid_output,"
                " review_rounds, latency_ms, tokens_in, tokens_out, cost_usd, scores)"
                " VALUES (%s, %s, %s, '{}', %s, 1, %s, 10, 10, %s, '[]')",
                uuid4(),
                batch,
                case,
                valid,
                latency,
                cost,
            )

        response = await api.client.get("/evaluation")

        assert response.status_code == 200
        assert response.headers["cache-control"] == "public, max-age=60"
        [lote] = response.json()["lotes"]
        assert (lote["cases"], lote["valid_rate"]) == (2, 0.5)
        assert lote["latency_p50_ms"] == 200
        assert lote["cost_usd_avg"] == pytest.approx(0.02)
        assert (lote["completed"], lote["score_mean"], lote["judge_same_provider"]) == (
            2,
            None,
            False,
        )
        assert response.json()["acuerdo_juez"] is None
