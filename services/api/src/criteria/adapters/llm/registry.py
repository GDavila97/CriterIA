from collections.abc import Callable, Collection

import httpx2
from openai import AsyncOpenAI
from pydantic import SecretStr
from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.models.ollama import OllamaModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.groq import GroqProvider
from pydantic_ai.providers.ollama import OllamaProvider
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings

from criteria.adapters.llm.catalog import ModelCatalog
from criteria.adapters.llm.ssrf import guarded_client, validate_endpoint_url
from criteria.config import Settings
from criteria.domain.events import ProveedorId
from criteria.domain.run_config import USER_KEY_PROVIDERS, ProviderSelection

PROVIDER_ORDER: tuple[ProveedorId, ...] = (
    "openai",
    "anthropic",
    "groq",
    "ollama",
    "openai_compatible",
)


class ProviderNotAllowedError(ValueError):
    pass


class KeyRequiredError(ProviderNotAllowedError):
    codigo = "clave_requerida"


def _secret(value: SecretStr | None) -> str | None:
    return value.get_secret_value() if value is not None else None


def _key(selection: ProviderSelection, server_key: SecretStr | None) -> str | None:
    # validate() already ensured that a run without a user key is allowed the server key.
    return _secret(selection.api_key) or _secret(server_key)


class ProviderRegistry:
    def __init__(
        self,
        settings: Settings,
        catalog: ModelCatalog,
        user_endpoint_client: Callable[[], httpx2.AsyncClient] | None = None,
    ) -> None:
        self._settings = settings
        self._catalog = catalog
        self._user_endpoint_client = user_endpoint_client or self._default_user_endpoint_client

    def server_access(self, provider: ProveedorId) -> bool:
        """Whether runs without a user key may use the operator's credentials for this provider."""
        settings = self._settings
        configured: dict[ProveedorId, bool] = {
            "openai": settings.openai_api_key is not None,
            "anthropic": settings.anthropic_api_key is not None,
            "groq": settings.groq_api_key is not None,
            "ollama": settings.ollama_base_url is not None,
            "openai_compatible": False,
        }
        return provider in settings.server_key_providers and configured[provider]

    def available(self, user_keys: Collection[ProveedorId] = ()) -> list[ProveedorId]:
        return [
            provider
            for provider in PROVIDER_ORDER
            if self.server_access(provider)
            or (provider in user_keys and provider in USER_KEY_PROVIDERS)
        ]

    def validate(self, selection: ProviderSelection) -> None:
        if not selection.usa_clave_propia and not self.server_access(selection.proveedor):
            raise KeyRequiredError(f"{selection.proveedor} needs the user's own API key")
        if not self._catalog.allows(selection.proveedor, selection.modelo):
            raise ProviderNotAllowedError(f"model {selection.etiqueta} is not allowed")
        if selection.base_url is not None:
            validate_endpoint_url(str(selection.base_url))

    def model(self, selection: ProviderSelection) -> Model:
        self.validate(selection)
        settings = self._settings
        match selection.proveedor:
            case "openai":
                return OpenAIChatModel(
                    selection.modelo,
                    provider=OpenAIProvider(api_key=_key(selection, settings.openai_api_key)),
                )
            case "anthropic":
                return AnthropicModel(
                    selection.modelo,
                    provider=AnthropicProvider(api_key=_key(selection, settings.anthropic_api_key)),
                )
            case "groq":
                return GroqModel(
                    selection.modelo,
                    provider=GroqProvider(api_key=_key(selection, settings.groq_api_key)),
                )
            case "ollama":
                base_url = str(settings.ollama_base_url).rstrip("/")
                return OllamaModel(
                    selection.modelo, provider=OllamaProvider(base_url=f"{base_url}/v1")
                )
            case "openai_compatible":
                client = AsyncOpenAI(
                    base_url=str(selection.base_url),
                    api_key=_secret(selection.api_key),
                    http_client=self._user_endpoint_client(),
                    max_retries=0,
                )
                return OpenAIChatModel(
                    selection.modelo, provider=OpenAIProvider(openai_client=client)
                )

    def model_settings(self, selection: ProviderSelection) -> ModelSettings:
        model_settings = ModelSettings(
            temperature=selection.temperatura,
            max_tokens=selection.max_tokens,
            timeout=self._settings.provider_timeout_seconds,
        )
        entry = self._catalog.entry(selection.proveedor, selection.modelo)
        if entry is not None and entry.thinking is not None:
            model_settings["thinking"] = entry.thinking
        return model_settings

    def cost_usd(
        self, selection: ProviderSelection, tokens_in: int, tokens_out: int
    ) -> float | None:
        return self._catalog.cost_usd(selection.proveedor, selection.modelo, tokens_in, tokens_out)

    def _default_user_endpoint_client(self) -> httpx2.AsyncClient:
        return guarded_client(
            timeout_seconds=self._settings.provider_timeout_seconds,
            max_response_bytes=self._settings.provider_max_response_bytes,
        )
