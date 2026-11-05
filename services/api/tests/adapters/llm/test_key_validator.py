import logging
from collections.abc import Callable

import httpx2
import pytest
from pydantic import SecretStr

from criteria.adapters.llm.key_validator import HttpKeyValidator, last4
from criteria.adapters.llm.ssrf import EndpointNotAllowedError, GuardedTransport
from criteria.domain.events import ProveedorId

KEY = SecretStr("sk-user-8888-check-AbCd")
Handler = Callable[[httpx2.Request], httpx2.Response]


class Recorder:
    def __init__(self, handler: Handler) -> None:
        self.requests: list[httpx2.Request] = []
        self._handler = handler

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return self._handler(request)


def validator(recorder: Recorder) -> HttpKeyValidator:
    def client() -> httpx2.AsyncClient:
        return httpx2.AsyncClient(transport=httpx2.MockTransport(recorder))

    def user_client() -> httpx2.AsyncClient:
        return httpx2.AsyncClient(
            transport=GuardedTransport(httpx2.MockTransport(recorder), max_response_bytes=65536)
        )

    return HttpKeyValidator(provider_client=client, user_endpoint_client=user_client)


def answering(status: int) -> Recorder:
    return Recorder(lambda _request: httpx2.Response(status, json={"data": []}))


@pytest.mark.parametrize(
    ("provider", "url", "header", "value"),
    [
        (
            "openai",
            "https://api.openai.com/v1/models",
            "authorization",
            f"Bearer {KEY.get_secret_value()}",
        ),
        (
            "groq",
            "https://api.groq.com/openai/v1/models",
            "authorization",
            f"Bearer {KEY.get_secret_value()}",
        ),
        (
            "anthropic",
            "https://api.anthropic.com/v1/models?limit=1",
            "x-api-key",
            KEY.get_secret_value(),
        ),
    ],
)
async def test_calls_the_cheapest_endpoint_with_the_providers_auth_header(
    provider: ProveedorId, url: str, header: str, value: str
) -> None:
    recorder = answering(200)

    check = await validator(recorder).validate(provider, KEY)

    assert check.estado == "valida"
    assert check.last4 == "AbCd"
    request = recorder.requests[0]
    assert (request.method, str(request.url), request.headers[header]) == ("GET", url, value)


async def test_anthropic_requests_carry_the_api_version() -> None:
    recorder = answering(200)

    await validator(recorder).validate("anthropic", KEY)

    assert recorder.requests[0].headers["anthropic-version"] == "2023-06-01"


@pytest.mark.parametrize(
    ("status", "estado"),
    [
        (200, "valida"),
        (401, "invalida"),
        (403, "invalida"),
        (429, "no_verificable"),
        (503, "no_verificable"),
    ],
)
async def test_maps_the_response_status(status: int, estado: str) -> None:
    check = await validator(answering(status)).validate("openai", KEY)

    assert check.estado == estado


async def test_network_failures_are_not_verifiable(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)

    def fail(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectTimeout(f"timed out with {request.headers['authorization']}")

    check = await validator(Recorder(fail)).validate("groq", KEY)

    assert check.estado == "no_verificable"
    assert KEY.get_secret_value() not in caplog.text


async def test_the_key_never_reaches_logs_or_the_result(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)

    check = await validator(answering(401)).validate("openai", KEY)

    assert KEY.get_secret_value() not in caplog.text
    assert KEY.get_secret_value() not in repr(check)


async def test_user_endpoint_lists_models_under_its_base_url() -> None:
    recorder = answering(200)

    check = await validator(recorder).validate(
        "openai_compatible", KEY, base_url="https://llm.example.com/v1/"
    )

    assert check.estado == "valida"
    assert str(recorder.requests[0].url) == "https://llm.example.com/v1/models"


async def test_user_endpoint_redirects_are_not_followed() -> None:
    recorder = Recorder(
        lambda _r: httpx2.Response(302, headers={"location": "https://169.254.169.254/"})
    )

    check = await validator(recorder).validate(
        "openai_compatible", KEY, base_url="https://llm.example.com/v1"
    )

    assert check.estado == "no_verificable"
    assert len(recorder.requests) == 1


@pytest.mark.parametrize("base_url", ["http://llm.example.com/v1", "https://10.0.0.5/v1", None])
async def test_user_endpoint_needs_a_public_https_base_url(base_url: str | None) -> None:
    recorder = answering(200)

    with pytest.raises((EndpointNotAllowedError, ValueError)):
        await validator(recorder).validate("openai_compatible", KEY, base_url=base_url)

    assert recorder.requests == []


async def test_ollama_takes_no_key() -> None:
    with pytest.raises(ValueError, match="ollama does not take an API key"):
        await validator(answering(200)).validate("ollama", KEY)


def test_short_values_are_fully_masked() -> None:
    assert last4("abcdefgh") == "efgh"
    assert last4("abc123") == "****"


async def test_default_clients_are_built_without_network_access() -> None:
    default = HttpKeyValidator(timeout_seconds=0.01)

    check = await default.validate("openai_compatible", KEY, base_url="https://localhost:9/v1")

    assert check.estado == "no_verificable"
