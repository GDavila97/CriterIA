from collections.abc import Callable, Collection

import httpx2
from anthropic import AsyncAnthropic
from groq import AsyncGroq
from openai import AsyncOpenAI
from pydantic import SecretStr
from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.models.ollama import OllamaModel
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.groq import GroqProvider
from pydantic_ai.providers.ollama import OllamaProvider
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings

from criteria.adapters.llm.catalog import ModelCatalog, TierNotAvailableError
from criteria.adapters.llm.retry import legacy_provider_client, provider_client
from criteria.adapters.llm.ssrf import guarded_client, validate_endpoint_url
from criteria.config import Settings
from criteria.domain.events import ProveedorId
from criteria.domain.run_config import USER_KEY_PROVIDERS, Nivel, OutputMode, ProviderSelection
from criteria.ports.models import KeyRequiredError, ProviderNotAllowedError

PROVIDER_ORDER: tuple[ProveedorId, ...] = (
    "openai",
    "anthropic",
    "groq",
    "ollama",
    "openai_compatible",
)


__all__ = ["KeyRequiredError", "ProviderNotAllowedError", "ProviderRegistry"]


def _secret(value: SecretStr | None) -> str | None:
    return value.get_secret_value() if value is not None else None


def _model_name(selection: ProviderSelection) -> str:
    if selection.modelo is None:
        raise ProviderNotAllowedError(f"{selection.proveedor} needs a model or a known tier")
    return selection.modelo


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

    def has_tier(self, provider: ProveedorId, nivel: Nivel) -> bool:
        try:
            self._catalog.resolve(provider, nivel)
        except TierNotAvailableError:
            return False
        return True

    def resolve(self, selection: ProviderSelection) -> ProviderSelection:
        if selection.modelo is not None or selection.nivel is None:
            return selection
        try:
            modelo = self._catalog.resolve(selection.proveedor, selection.nivel)
        except TierNotAvailableError as error:
            raise ProviderNotAllowedError(str(error)) from None
        return selection.model_copy(update={"modelo": modelo})

    def validate(self, selection: ProviderSelection) -> ProviderSelection:
        """Returns the selection with its tier resolved, or raises before any model is called."""
        if not selection.usa_clave_propia and not self.server_access(selection.proveedor):
            raise KeyRequiredError(f"{selection.proveedor} needs the user's own API key")
        resolved = self.resolve(selection)
        if not self._catalog.allows(resolved.proveedor, _model_name(resolved)):
            raise ProviderNotAllowedError(f"model {resolved.etiqueta} is not allowed")
        if resolved.base_url is not None:
            validate_endpoint_url(str(resolved.base_url))
        return resolved

    def estimate_run_cost(
        self, generacion: ProviderSelection, juez: ProviderSelection
    ) -> float | None:
        gen, judge = self.resolve(generacion), self.resolve(juez)
        return self._catalog.estimate_run_cost(
            (gen.proveedor, _model_name(gen)), (judge.proveedor, _model_name(judge))
        )

    def estimate_parts(
        self, generacion: ProviderSelection, juez: ProviderSelection
    ) -> tuple[float | None, float | None]:
        gen, judge = self.resolve(generacion), self.resolve(juez)
        return self._catalog.estimate_parts(
            (gen.proveedor, _model_name(gen)), (judge.proveedor, _model_name(judge))
        )

    def tiers(self, provider: ProveedorId) -> dict[Nivel, str]:
        return self._catalog.tiers(provider)

    def models(self, provider: ProveedorId) -> list[str]:
        return self._catalog.allowed_models(provider)

    def model(self, selection: ProviderSelection) -> Model:
        selection = self.validate(selection)
        name = _model_name(selection)
        settings = self._settings
        timeout = settings.timeout_for(selection.proveedor)
        match selection.proveedor:
            case "openai":
                openai_client = AsyncOpenAI(
                    api_key=_key(selection, settings.openai_api_key),
                    max_retries=0,
                    http_client=provider_client(timeout),
                )
                return OpenAIChatModel(name, provider=OpenAIProvider(openai_client=openai_client))
            case "anthropic":
                anthropic_client = AsyncAnthropic(
                    api_key=_key(selection, settings.anthropic_api_key),
                    max_retries=0,
                    http_client=provider_client(timeout),
                )
                return AnthropicModel(
                    name, provider=AnthropicProvider(anthropic_client=anthropic_client)
                )
            case "groq":
                groq_client = AsyncGroq(
                    api_key=_key(selection, settings.groq_api_key),
                    max_retries=0,
                    http_client=legacy_provider_client(timeout),
                )
                return GroqModel(name, provider=GroqProvider(groq_client=groq_client))
            case "ollama":
                base_url = str(settings.ollama_base_url).rstrip("/")
                ollama_client = AsyncOpenAI(
                    base_url=f"{base_url}/v1",
                    api_key="ollama",
                    max_retries=0,
                    http_client=provider_client(timeout),
                )
                return OllamaModel(name, provider=OllamaProvider(openai_client=ollama_client))
            case "openai_compatible":
                user_client = AsyncOpenAI(
                    base_url=str(selection.base_url),
                    api_key=_secret(selection.api_key),
                    http_client=self._user_endpoint_client(),
                    max_retries=0,
                )
                return OpenAIChatModel(name, provider=OpenAIProvider(openai_client=user_client))

    def model_settings(self, selection: ProviderSelection) -> ModelSettings:
        selection = self.resolve(selection)
        model_settings = OpenAIChatModelSettings(
            temperature=selection.temperatura,
            max_tokens=selection.max_tokens,
            timeout=self._settings.timeout_for(selection.proveedor),
        )
        entry = self._catalog.entry(selection.proveedor, _model_name(selection))
        if entry is not None and entry.thinking is not None:
            model_settings["thinking"] = entry.thinking
            if entry.thinking is False and selection.proveedor == "ollama":
                # Pydantic AI sends nothing for thinking=False on Ollama; only this field turns
                # Qwen 3 reasoning off on its OpenAI-compatible endpoint (verified in F2b).
                model_settings["openai_reasoning_effort"] = "none"
        return model_settings

    def output_mode(self, selection: ProviderSelection) -> OutputMode:
        selection = self.resolve(selection)
        entry = self._catalog.entry(selection.proveedor, _model_name(selection))
        return entry.output_mode if entry is not None else "tool"

    def cost_usd(
        self, selection: ProviderSelection, tokens_in: int, tokens_out: int
    ) -> float | None:
        selection = self.resolve(selection)
        return self._catalog.cost_usd(
            selection.proveedor, _model_name(selection), tokens_in, tokens_out
        )

    def _default_user_endpoint_client(self) -> httpx2.AsyncClient:
        return guarded_client(
            timeout_seconds=self._settings.timeout_for("openai_compatible"),
            max_response_bytes=self._settings.provider_max_response_bytes,
        )
