"""Checks Ollama before a local batch: its version and how much of the model sits on the GPU."""

from dataclasses import dataclass

import httpx

FULL_GPU = 100.0
TIMEOUT_SECONDS = 300.0


class OllamaProbeError(RuntimeError):
    pass


@dataclass(frozen=True)
class OllamaStatus:
    version: str
    gpu_percent: float
    context_length: int | None


def _root(base_url: str) -> str:
    root = base_url.rstrip("/")
    return root.removesuffix("/v1")


async def probe(base_url: str, model: str, client: httpx.AsyncClient | None = None) -> OllamaStatus:
    """Loads the model with an empty prompt, then reads its placement from /api/ps."""
    owned = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
    root = _root(base_url)
    try:
        version = (await client.get(f"{root}/api/version")).raise_for_status().json()["version"]
        await client.post(
            f"{root}/api/generate", json={"model": model, "prompt": "", "keep_alive": "60m"}
        )
        loaded = (await client.get(f"{root}/api/ps")).raise_for_status().json()["models"]
    except (httpx.HTTPError, KeyError, ValueError) as error:
        raise OllamaProbeError(
            f"Ollama did not answer as expected: {type(error).__name__}"
        ) from error
    finally:
        if owned:
            await client.aclose()
    entry = next((m for m in loaded if m.get("name") == model or m.get("model") == model), None)
    if entry is None or not entry.get("size"):
        raise OllamaProbeError(f"{model} is not loaded in Ollama")
    return OllamaStatus(
        version=str(version),
        gpu_percent=round(100 * entry.get("size_vram", 0) / entry["size"], 1),
        context_length=entry.get("context_length"),
    )
