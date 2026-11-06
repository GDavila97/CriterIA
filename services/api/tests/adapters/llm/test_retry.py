from collections.abc import Callable

import httpx
import httpx2
import pytest

from criteria.adapters.llm.catalog import CatalogEntry, ModelCatalog
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.adapters.llm.retry import LegacyTransientRetryTransport, TransientRetryTransport
from criteria.config import Settings
from criteria.domain.run_config import ProviderSelection

Outcome = int | type[Exception]


def scripted(
    outcomes: list[Outcome], calls: list[str]
) -> Callable[[httpx2.Request], httpx2.Response]:
    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(request.method)
        outcome = outcomes[min(len(calls), len(outcomes)) - 1]
        if isinstance(outcome, int):
            return httpx2.Response(outcome, json={})
        raise outcome("scripted failure")

    return handler


async def send(outcomes: list[Outcome]) -> tuple[httpx2.Response | Exception, int]:
    calls: list[str] = []
    transport = TransientRetryTransport(httpx2.MockTransport(scripted(outcomes, calls)))
    async with httpx2.AsyncClient(transport=transport) as client:
        try:
            response: httpx2.Response | Exception = await client.post(
                "https://api.example/v1", json={}
            )
        except Exception as error:
            response = error
    return response, len(calls)


@pytest.mark.parametrize(
    ("outcomes", "status", "calls"),
    [
        ([200], 200, 1),
        ([503, 200], 200, 2),
        ([500, 502], 502, 2),
        ([httpx2.ConnectError, 200], 200, 2),
    ],
)
async def test_transient_failures_get_exactly_one_more_attempt(
    outcomes: list[Outcome], status: int, calls: int
) -> None:
    response, attempts = await send(outcomes)

    assert isinstance(response, httpx2.Response)
    assert (response.status_code, attempts) == (status, calls)


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422, 429])
async def test_client_errors_are_never_retried(status: int) -> None:
    response, attempts = await send([status, 200])

    assert isinstance(response, httpx2.Response)
    assert (response.status_code, attempts) == (status, 1)


async def test_timeouts_are_not_retried() -> None:
    response, attempts = await send([httpx2.ReadTimeout, 200])

    assert isinstance(response, httpx2.ReadTimeout)
    assert attempts == 1


async def test_a_second_connection_failure_propagates() -> None:
    response, attempts = await send([httpx2.ConnectError, httpx2.ConnectError])

    assert isinstance(response, httpx2.ConnectError)
    assert attempts == 2


async def test_legacy_transport_follows_the_same_policy() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response([503, 200, 429][len(calls) - 1] if len(calls) <= 3 else 200)

    transport = LegacyTransientRetryTransport(httpx.MockTransport(handler))
    async with httpx.AsyncClient(transport=transport) as client:
        first = await client.get("https://api.example/v1")
        second = await client.get("https://api.example/v1")

    assert (first.status_code, second.status_code, len(calls)) == (200, 429, 3)


async def test_legacy_transport_retries_one_connection_failure() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("down")
        return httpx.Response(200)

    transport = LegacyTransientRetryTransport(httpx.MockTransport(handler))
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.get("https://api.example/v1")

    assert (response.status_code, len(calls)) == (200, 2)


CATALOG = ModelCatalog(
    models=[
        CatalogEntry(provider="openai", name="o"),
        CatalogEntry(provider="anthropic", name="a"),
        CatalogEntry(provider="groq", name="g"),
        CatalogEntry(provider="ollama", name="l"),
    ]
)


def test_sdk_clients_never_retry_on_their_own_and_use_the_provider_timeout() -> None:
    settings = Settings.model_validate(
        {
            "app_env": "test",
            "server_key_providers": "openai,anthropic,groq,ollama",
            "openai_api_key": "k",
            "anthropic_api_key": "k",
            "groq_api_key": "k",
            "ollama_base_url": "http://localhost:11434",
            "provider_timeouts": "ollama:180, groq:45",
        }
    )
    registry = ProviderRegistry(settings, CATALOG)

    for provider, name in (("openai", "o"), ("anthropic", "a"), ("groq", "g"), ("ollama", "l")):
        selection = ProviderSelection.model_validate({"proveedor": provider, "modelo": name})
        model = registry.model(selection)
        assert model.client.max_retries == 0  # type: ignore[attr-defined]
    timeouts = {
        provider: registry.model_settings(
            ProviderSelection.model_validate({"proveedor": provider, "modelo": name})
        )["timeout"]
        for provider, name in (("openai", "o"), ("groq", "g"), ("ollama", "l"))
    }
    assert timeouts == {"openai": 60.0, "groq": 45.0, "ollama": 180.0}


@pytest.mark.parametrize("raw", ["ollama", "ollama:abc", "ollama:0", "ollama:999"])
def test_invalid_timeouts_are_rejected(raw: str) -> None:
    with pytest.raises(ValueError, match=r"timeout|pairs"):
        Settings.model_validate({"app_env": "test", "provider_timeouts": raw})
