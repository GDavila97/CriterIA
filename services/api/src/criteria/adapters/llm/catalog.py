import tomllib
from pathlib import Path
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from criteria.domain.events import ProveedorId
from criteria.domain.run_config import GENERATION_ROLES, Nivel, NombreModelo, OutputMode, RolAgente


class TierNotAvailableError(LookupError):
    pass


class CatalogError(RuntimeError):
    pass


class TokenProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class CatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: ProveedorId
    name: NombreModelo
    display_name: str = Field(min_length=1, max_length=60)
    input_usd_per_million: float | None = Field(default=None, ge=0)
    output_usd_per_million: float | None = Field(default=None, ge=0)
    nivel: Nivel | None = None
    thinking: bool | None = None
    output_mode: OutputMode = "tool"
    # Overrides the catalog's general profile for models that spend very differently.
    consumption_profile: dict[RolAgente, TokenProfile] | None = None

    @model_validator(mode="after")
    def _prices_come_in_pairs(self) -> Self:
        if (self.input_usd_per_million is None) != (self.output_usd_per_million is None):
            raise ValueError(f"{self.provider}:{self.name} needs both prices or neither")
        return self


class ModelCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    models: list[CatalogEntry]
    consumption_profile: dict[RolAgente, TokenProfile] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _one_model_per_tier(self) -> Self:
        seen: dict[tuple[ProveedorId, Nivel], str] = {}
        for entry in self.models:
            if entry.nivel is None:
                continue
            key = (entry.provider, entry.nivel)
            if key in seen:
                raise ValueError(
                    f"{entry.provider} has two models for the {entry.nivel} tier: "
                    f"{seen[key]} and {entry.name}"
                )
            seen[key] = entry.name
        return self

    @classmethod
    def load(cls, path: Path) -> "ModelCatalog":
        with path.open("rb") as handle:
            data = tomllib.load(handle)
        try:
            return cls.model_validate(data)
        except ValidationError as error:
            problems = "; ".join(issue["msg"] for issue in error.errors())
        raise CatalogError(f"Invalid model catalog {path.name}: {problems}")

    def entry(self, provider: ProveedorId, name: str) -> CatalogEntry | None:
        return next((m for m in self.models if m.provider == provider and m.name == name), None)

    def display_name(self, provider: ProveedorId, name: str) -> str:
        """The readable name of a model; a model outside the catalog keeps its own name."""
        entry = self.entry(provider, name)
        return entry.display_name if entry else name

    def allows(self, provider: ProveedorId, name: str) -> bool:
        return provider == "openai_compatible" or self.entry(provider, name) is not None

    def allowed_models(self, provider: ProveedorId) -> list[str]:
        return [m.name for m in self.models if m.provider == provider]

    def resolve(self, provider: ProveedorId, nivel: Nivel) -> str:
        for entry in self.models:
            if entry.provider == provider and entry.nivel == nivel:
                return entry.name
        raise TierNotAvailableError(f"{provider} has no model for the {nivel} tier")

    def tiers(self, provider: ProveedorId) -> dict[Nivel, str]:
        return {m.nivel: m.name for m in self.models if m.provider == provider and m.nivel}

    def profile_for(self, provider: ProveedorId, name: str) -> dict[RolAgente, TokenProfile]:
        entry = self.entry(provider, name)
        if entry is not None and entry.consumption_profile is not None:
            return {**self.consumption_profile, **entry.consumption_profile}
        return self.consumption_profile

    def _profile_cost(
        self, roles: tuple[RolAgente, ...], model: tuple[ProveedorId, str]
    ) -> float | None:
        profiles = self.profile_for(*model)
        total = 0.0
        for rol in roles:
            profile = profiles.get(rol)
            cost = (
                self.cost_usd(*model, profile.input_tokens, profile.output_tokens)
                if profile
                else None
            )
            if cost is None:
                return None
            total += cost
        return total

    def estimate_parts(
        self, generacion: tuple[ProveedorId, str], juez: tuple[ProveedorId, str]
    ) -> tuple[float | None, float | None]:
        gen = self._profile_cost(GENERATION_ROLES, generacion)
        judge = self._profile_cost(("evaluador",), juez)
        return (
            None if gen is None else round(gen, 6),
            None if judge is None else round(judge, 6),
        )

    def estimate_agent(self, rol: RolAgente, model: tuple[ProveedorId, str]) -> float | None:
        cost = self._profile_cost((rol,), model)
        return None if cost is None else round(cost, 6)

    def estimate_run_cost(
        self, generacion: tuple[ProveedorId, str], juez: tuple[ProveedorId, str]
    ) -> float | None:
        """Typical cost of one run from the consumption profile; null if a price is missing."""
        gen, judge = self.estimate_parts(generacion, juez)
        return None if gen is None or judge is None else round(gen + judge, 6)

    def cost_usd(
        self, provider: ProveedorId, name: str, tokens_in: int, tokens_out: int
    ) -> float | None:
        entry = self.entry(provider, name)
        if (
            entry is None
            or entry.input_usd_per_million is None
            or entry.output_usd_per_million is None
        ):
            return None
        cost = (
            tokens_in * entry.input_usd_per_million + tokens_out * entry.output_usd_per_million
        ) / 1_000_000
        # Nanodollar precision per call; the run total is rounded once, so errors do not add up.
        return round(cost, 9)
