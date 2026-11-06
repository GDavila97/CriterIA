from dataclasses import dataclass
from uuid import UUID

from criteria.application.credentials import CredentialService
from criteria.application.errors import InvalidInputError, NotFoundError
from criteria.domain.events import ProveedorId
from criteria.domain.judge import elegir_juez
from criteria.domain.run_config import USER_KEY_PROVIDERS, Nivel, ProviderSelection
from criteria.ports.models import ModelRouter
from criteria.ports.stores import (
    HistoryStore,
    KeySource,
    SavedRun,
    SavedRunSummary,
    SettingsStore,
    UserSettings,
)

PROVIDERS: tuple[ProveedorId, ...] = ("openai", "anthropic", "groq", "ollama", "openai_compatible")
HISTORY_PAGE = 50


@dataclass(frozen=True)
class CatalogTier:
    nivel: Nivel
    modelo: str
    costo_estimado_usd: float | None


@dataclass(frozen=True)
class CatalogProvider:
    proveedor: ProveedorId
    disponible: bool
    clave: KeySource | None
    acepta_clave_propia: bool
    niveles: list[CatalogTier]
    modelos: list[str]


@dataclass(frozen=True)
class Catalog:
    proveedores: list[CatalogProvider]
    proveedor_predeterminado: ProveedorId
    juez_predeterminado: ProveedorId


class AccountService:
    def __init__(
        self,
        *,
        settings: SettingsStore,
        history: HistoryStore,
        credentials: CredentialService,
        router: ModelRouter,
        default_provider: ProveedorId,
    ) -> None:
        self._settings = settings
        self._history = history
        self._credentials = credentials
        self._router = router
        self._default_provider = default_provider

    async def settings(self, user_id: str) -> UserSettings:
        return await self._settings.get(user_id)

    async def update_settings(self, user_id: str, settings: UserSettings) -> UserSettings:
        for provider in (settings.default_provider, settings.judge_provider):
            if provider is not None and provider not in PROVIDERS:
                raise InvalidInputError("unknown provider")
        if settings.default_tier is not None and settings.default_provider is None:
            raise InvalidInputError("a default tier needs a default provider")
        await self._settings.put(user_id, settings)
        return settings

    async def history(self, user_id: str) -> list[SavedRunSummary]:
        return await self._history.list(user_id, HISTORY_PAGE)

    async def history_item(self, user_id: str, run_id: UUID) -> SavedRun:
        item = await self._history.get(user_id, run_id)
        if item is None:
            raise NotFoundError("run not found")
        return item

    async def clear_history(self, user_id: str) -> int:
        return await self._history.delete_all(user_id)

    async def catalog(self, user_id: str) -> Catalog:
        user_keys = await self._credentials.providers(user_id)
        preferences = await self._settings.get(user_id)
        default = preferences.default_provider or self._default_provider
        candidates = [
            p for p in self._router.available(user_keys) if self._router.has_tier(p, "economico")
        ]
        judge = preferences.judge_provider or elegir_juez(candidates, default).proveedor
        judge_tiers = self._router.tiers(judge)
        judge_model = judge_tiers.get("economico")
        providers = []
        for provider in PROVIDERS:
            source: KeySource | None = (
                "usuario"
                if provider in user_keys
                else "servidor"
                if self._router.server_access(provider)
                else None
            )
            tiers = [
                CatalogTier(
                    nivel=nivel,
                    modelo=model,
                    costo_estimado_usd=self._estimate(provider, model, judge, judge_model),
                )
                for nivel, model in self._router.tiers(provider).items()
            ]
            providers.append(
                CatalogProvider(
                    proveedor=provider,
                    disponible=source is not None,
                    clave=source,
                    acepta_clave_propia=provider in USER_KEY_PROVIDERS,
                    niveles=tiers,
                    modelos=self._router.models(provider),
                )
            )
        return Catalog(
            proveedores=providers, proveedor_predeterminado=default, juez_predeterminado=judge
        )

    def _estimate(
        self, provider: ProveedorId, model: str, judge: ProveedorId, judge_model: str | None
    ) -> float | None:
        generation = ProviderSelection(proveedor=provider, modelo=model)
        judged = (
            ProviderSelection(proveedor=judge, modelo=judge_model) if judge_model else generation
        )
        gen_cost, judge_cost = self._router.estimate_parts(generation, judged)
        return None if gen_cost is None or judge_cost is None else round(gen_cost + judge_cost, 6)
