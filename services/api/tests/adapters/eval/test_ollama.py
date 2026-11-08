import httpx
import pytest

from criteria.adapters.eval.ollama import OllamaProbeError, probe


def server(models: list[dict[str, object]], fail: bool = False) -> httpx.AsyncClient:
    calls: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(f"{request.method} {request.url.path}")
        if fail:
            return httpx.Response(503)
        if request.url.path == "/api/version":
            return httpx.Response(200, json={"version": "0.40.14"})
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={"done": True})
        return httpx.Response(200, json={"models": models})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    client.calls = calls  # type: ignore[attr-defined]
    return client


async def test_reports_the_share_of_the_model_on_the_gpu() -> None:
    client = server(
        [{"name": "llama3.1:8b", "size": 5_900, "size_vram": 5_900, "context_length": 16384}]
    )

    status = await probe("http://pc.local:11434/v1", "llama3.1:8b", client)

    assert (status.version, status.gpu_percent, status.context_length) == ("0.40.14", 100.0, 16384)
    assert client.calls == [  # type: ignore[attr-defined]
        "GET /api/version",
        "POST /api/generate",
        "GET /api/ps",
    ]


async def test_a_partial_load_is_reported_as_is() -> None:
    client = server([{"model": "llama3.1:8b", "size": 1000, "size_vram": 800}])

    status = await probe("http://pc.local:11434", "llama3.1:8b", client)

    assert status.gpu_percent == 80.0


async def test_a_model_that_is_not_loaded_or_a_failing_server() -> None:
    with pytest.raises(OllamaProbeError, match="is not loaded"):
        await probe("http://pc.local:11434", "llama3.1:8b", server([]))
    with pytest.raises(OllamaProbeError, match="did not answer"):
        await probe("http://pc.local:11434", "llama3.1:8b", server([], fail=True))
