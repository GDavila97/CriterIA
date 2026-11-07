"""HTTP layer without a database: errors, hardening, CORS, auth and SSE framing."""

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from importlib.metadata import version
from typing import Any
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from criteria.adapters.auth.jwks import JwksCache, JwtVerifier, TokenPolicy
from criteria.adapters.http import sse
from criteria.adapters.http.app import build_app
from criteria.adapters.http.middleware import JsonFormatter, user_ref
from criteria.adapters.http.services import ApiServices
from criteria.config import ConfigError, load_api_settings
from criteria.domain.events import AgenteInicia
from criteria.main import create_app
from tests.fakes import FakeClock
from tests.http.support import AUDIENCE, ISSUER, WEB_ORIGIN, TokenFactory, api_settings


class Unreachable:
    """Every use case raises: these tests must never get past the HTTP layer."""

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"unexpected call to {name}")


async def _noop() -> None:
    return None


@asynccontextmanager
async def app_with(tokens: TokenFactory, **settings: Any) -> AsyncIterator[httpx.AsyncClient]:
    verifier = JwtVerifier(
        JwksCache(tokens.fetch, FakeClock(), 300),
        TokenPolicy(
            issuer=ISSUER,
            audience=AUDIENCE,
            algorithms=frozenset({"EdDSA"}),
            verified_claim="email_verified",
            leeway_seconds=0,
        ),
    )
    services = ApiServices(
        verifier=verifier,
        runs=Unreachable(),  # type: ignore[arg-type]
        credentials=Unreachable(),  # type: ignore[arg-type]
        accounts=Unreachable(),  # type: ignore[arg-type]
        evaluation=Unreachable(),
        startup=_noop,
        shutdown=_noop,
    )
    app = build_app(api_settings(**settings), lambda: services)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://api.test"
        ) as client,
    ):
        yield client


@pytest.fixture
def tokens() -> TokenFactory:
    return TokenFactory()


async def test_healthz_reports_only_status_and_version(tokens: TokenFactory) -> None:
    async with app_with(tokens) as client:
        response = await client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": version("criteria")}


async def test_responses_carry_security_headers_and_no_store(tokens: TokenFactory) -> None:
    async with app_with(tokens) as client:
        response = await client.get("/me/settings")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "headers",
    [{}, {"authorization": "Basic abc"}, {"authorization": "Bearer not-a-token"}],
)
async def test_missing_or_invalid_tokens_get_a_uniform_401(
    tokens: TokenFactory, headers: dict[str, str]
) -> None:
    async with app_with(tokens) as client:
        response = await client.get("/me/settings", headers=headers)

    assert response.status_code == 401
    assert response.json() == {"code": "no_autenticado", "message": "Falta un token válido."}
    assert response.headers["www-authenticate"] == "Bearer"


async def test_runs_need_a_verified_email(tokens: TokenFactory) -> None:
    async with app_with(tokens) as client:
        response = await client.post(
            "/runs", json={"requerimiento": "x" * 30}, headers=tokens.headers(verified=False)
        )

    assert response.status_code == 403
    assert response.json()["code"] == "correo_no_verificado"


async def test_validation_errors_never_echo_the_input(tokens: TokenFactory) -> None:
    secret = "sk-user-echo-0000"
    async with app_with(tokens) as client:
        response = await client.put(
            "/me/credentials/openai",
            json={"api_key": secret, "unexpected": secret},
            headers=tokens.headers(),
        )

    assert response.status_code == 422
    assert response.json() == {
        "code": "entrada_invalida",
        "message": "La petición no cumple el formato esperado.",
    }
    assert secret not in response.text


async def test_unknown_routes_and_methods_use_the_same_error_shape(tokens: TokenFactory) -> None:
    async with app_with(tokens) as client:
        missing = await client.get("/nothing-here")
        method = await client.patch("/healthz")

    assert (missing.status_code, missing.json()["code"]) == (404, "no_encontrado")
    assert (method.status_code, method.json()["code"]) == (405, "metodo_no_permitido")


async def test_bodies_over_the_limit_are_rejected(tokens: TokenFactory) -> None:
    async with app_with(tokens, max_request_bytes=1024) as client:
        declared = await client.post("/runs", content=b"x" * 2048, headers=tokens.headers())

        async def chunks() -> AsyncIterator[bytes]:
            for _ in range(4):
                yield b"x" * 512

        streamed = await client.post("/runs", content=chunks(), headers=tokens.headers())

    for response in (declared, streamed):
        assert response.status_code == 413
        assert response.json()["code"] == "cuerpo_demasiado_grande"


async def test_cors_allows_only_the_web_origin_without_credentials(tokens: TokenFactory) -> None:
    async with app_with(tokens) as client:
        allowed = await client.options(
            "/runs",
            headers={
                "origin": WEB_ORIGIN,
                "access-control-request-method": "POST",
                "access-control-request-headers": "authorization, content-type, last-event-id",
            },
        )
        denied = await client.options(
            "/runs",
            headers={"origin": "https://evil.example", "access-control-request-method": "POST"},
        )

    assert allowed.headers["access-control-allow-origin"] == WEB_ORIGIN
    assert "last-event-id" in allowed.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in allowed.headers
    assert "access-control-allow-origin" not in denied.headers


async def test_docs_are_hidden_in_production(tokens: TokenFactory) -> None:
    async with app_with(tokens, app_env="production") as client:
        docs = await client.get("/docs")
        schema = await client.get("/openapi.json")

    assert (docs.status_code, schema.status_code) == (404, 404)


def test_the_app_is_created_before_any_event_loop_runs() -> None:
    # uvicorn builds the app synchronously; pools and the checkpointer must wait for the loop.
    app = create_app(api_settings())

    assert app.title == "CriterIA API"


def test_sse_frames_use_the_seq_as_id() -> None:
    event = AgenteInicia(run_id=uuid4(), seq=7, ts=datetime.now(UTC), agent="qa", ronda=1)

    frame = sse.format_event(event).decode()

    assert frame.startswith("id: 7\nevent: agente_inicia\ndata: {")
    assert frame.endswith("\n\n")
    assert json.loads(frame.split("data: ", 1)[1])["ronda"] == 1


@pytest.mark.parametrize(
    ("raw", "expected"), [(None, 0), ("12", 12), (" 3 ", 3), ("abc", 0), ("-1", 0)]
)
def test_last_event_id_parsing(raw: str | None, expected: int) -> None:
    assert sse.parse_last_event_id(raw) == expected


async def test_heartbeats_are_sse_comments() -> None:
    async def items() -> AsyncIterator[AgenteInicia | None]:
        yield None

    frames = [frame async for frame in sse.encode(items())]

    assert frames == [b": ping\n\n"]


def test_logs_are_json_and_identify_users_only_by_a_pseudonym() -> None:
    record = logging.LogRecord("criteria.http", logging.INFO, __file__, 1, "request", None, None)
    record.user = user_ref("person@example.com")
    record.status = 200

    entry = json.loads(JsonFormatter().format(record))

    assert entry["user"] == user_ref("person@example.com")
    assert "example.com" not in json.dumps(entry)
    assert len(entry["user"]) == 12


class TestApiSettings:
    def test_fake_models_are_refused_outside_tests(self) -> None:
        with pytest.raises(ValidationError, match="MODEL_BACKEND=fake"):
            api_settings(model_backend="fake", app_env="production")
        with pytest.raises(ValidationError, match="MODEL_BACKEND=fake"):
            api_settings(model_backend="fake", app_env="development")

        assert api_settings(model_backend="fake").model_backend == "fake"

    def test_verified_email_is_required_by_default(self) -> None:
        assert api_settings().auth_require_verified_email is True

    def test_requires_the_server_settings(self) -> None:
        with pytest.raises(ConfigError) as error:
            load_api_settings()

        for name in ("DATABASE_URL", "WEB_ORIGIN", "AUTH_JWKS_URL", "CREDENTIALS_KEYS"):
            assert name in str(error.value)

    def test_rejects_symmetric_algorithms(self) -> None:
        with pytest.raises(ValidationError, match="only asymmetric"):
            api_settings(auth_algorithms="HS256")

    def test_active_key_must_exist(self) -> None:
        with pytest.raises(ValidationError, match="CREDENTIALS_ACTIVE_KEY"):
            api_settings(credentials_active_key=2)

    def test_errors_never_repeat_key_material(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CREDENTIALS_KEYS", "1:c2VjcmV0LWtleS1tYXRlcmlhbA==")
        monkeypatch.setenv("CREDENTIALS_ACTIVE_KEY", "1")

        with pytest.raises(ConfigError) as error:
            load_api_settings()

        assert "c2VjcmV0" not in str(error.value)
        assert "CREDENTIALS_KEYS" in str(error.value)
