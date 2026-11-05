import logging
from collections.abc import Callable

import httpx2
from pydantic import SecretStr

from criteria.adapters.llm.ssrf import guarded_client, validate_endpoint_url
from criteria.domain.events import ProveedorId
from criteria.ports.keys import EstadoClave, KeyCheck

logger = logging.getLogger(__name__)

# Listing models is free on every provider and proves the key is accepted.
MODELS_URL: dict[ProveedorId, str] = {
    "openai": "https://api.openai.com/v1/models",
    "anthropic": "https://api.anthropic.com/v1/models?limit=1",
    "groq": "https://api.groq.com/openai/v1/models",
}
ANTHROPIC_VERSION = "2023-06-01"
MIN_KEY_LENGTH_FOR_LAST4 = 8
HTTP_UNAUTHORIZED, HTTP_FORBIDDEN = 401, 403


def last4(key: str) -> str:
    # A very short value would be revealed almost entirely by its last four characters.
    return key[-4:] if len(key) >= MIN_KEY_LENGTH_FOR_LAST4 else "****"


def _estado(status_code: int) -> EstadoClave:
    if httpx2.codes.is_success(status_code):
        return "valida"
    if status_code in (HTTP_UNAUTHORIZED, HTTP_FORBIDDEN):
        return "invalida"
    return "no_verificable"


class HttpKeyValidator:
    def __init__(
        self,
        *,
        timeout_seconds: float = 10.0,
        max_response_bytes: int = 1_048_576,
        provider_client: Callable[[], httpx2.AsyncClient] | None = None,
        user_endpoint_client: Callable[[], httpx2.AsyncClient] | None = None,
    ) -> None:
        self._provider_client = provider_client or (
            lambda: httpx2.AsyncClient(
                timeout=httpx2.Timeout(timeout_seconds), follow_redirects=False, trust_env=False
            )
        )
        self._user_endpoint_client = user_endpoint_client or (
            lambda: guarded_client(
                timeout_seconds=timeout_seconds, max_response_bytes=max_response_bytes
            )
        )

    async def validate(
        self, proveedor: ProveedorId, api_key: SecretStr, base_url: str | None = None
    ) -> KeyCheck:
        key = api_key.get_secret_value()
        url, headers, client_factory = self._request(proveedor, key, base_url)
        try:
            async with client_factory() as client:
                response = await client.get(url, headers=headers)
            estado = _estado(response.status_code)
        except Exception as error:
            # Only the type name is logged: the error may carry the request headers.
            logger.info("key check for %s failed: %s", proveedor, type(error).__name__)
            estado = "no_verificable"
        logger.info("key check for %s: %s", proveedor, estado)
        return KeyCheck(estado=estado, last4=last4(key))

    def _request(
        self, proveedor: ProveedorId, key: str, base_url: str | None
    ) -> tuple[str, dict[str, str], Callable[[], httpx2.AsyncClient]]:
        match proveedor:
            case "openai" | "groq":
                return (
                    MODELS_URL[proveedor],
                    {"authorization": f"Bearer {key}"},
                    self._provider_client,
                )
            case "anthropic":
                return (
                    MODELS_URL["anthropic"],
                    {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION},
                    self._provider_client,
                )
            case "openai_compatible":
                if base_url is None:
                    raise ValueError("openai_compatible needs its base_url to check a key")
                endpoint = validate_endpoint_url(base_url)
                url = f"{str(endpoint).rstrip('/')}/models"
                return url, {"authorization": f"Bearer {key}"}, self._user_endpoint_client
            case "ollama":
                raise ValueError("ollama does not take an API key")
