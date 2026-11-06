import tomllib
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from criteria.domain.events import ProveedorId
from criteria.domain.run_config import Nivel, NombreModelo, OutputMode

RolAgente = Literal["analista", "qa", "revisor", "evaluador"]
GENERATION_ROLES: tuple[RolAgente, ...] = ("analista", "qa", "revisor")


class TierNotAvailableError(LookupError):
    pass


class CatalogError(RuntimeError):
    pass


class CatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: ProveedorId
    name: NombreModelo
    input_usd_per_million: float | None = Field(default=None, ge=0)
    output_usd_per_million: float | None = Field(default=None, ge=0)
    nivel: Nivel | None = None
    thinking: bool | None = None
    output_mode: OutputMode = "tool"

    @model_validator(mode="after")
    def _prices_come_in_pairs(self) -> Self:
        if (self.input_usd_per_million is None) != (self.output_usd_per_million is None):
            raise ValueError(f"{self.provider}:{self.name} needs both prices or neither")
        return self


class TokenProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


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

    def allows(self, provider: ProveedorId, name: str) -> bool:
        return provider == "openai_compatible" or self.entry(provider, name) is not None

    def allowed_models(self, provider: ProveedorId) -> list[str]:
        return [m.name for m in self.models if m.provider == provider]

    def resolve(self, provider: ProveedorId, nivel: Nivel) -> str:
        for entry in self.models:
            if entry.provider == provider and entry.nivel == nivel:
                return entry.name
        raise TierNotAvailableError(f"{provider} has no model for the {nivel} tier")

    def estimate_run_cost(
        self, generacion: tuple[ProveedorId, str], juez: tuple[ProveedorId, str]
    ) -> float | None:
        """Typical cost of one run from the consumption profile; null if a price is missing."""
        total = 0.0
        for rol in (*GENERATION_ROLES, "evaluador"):
            profile = self.consumption_profile.get(rol)
            provider, name = juez if rol == "evaluador" else generacion
            cost = (
                self.cost_usd(provider, name, profile.input_tokens, profile.output_tokens)
                if profile
                else None
            )
            if cost is None:
                return None
            total += cost
        return round(total, 6)

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
