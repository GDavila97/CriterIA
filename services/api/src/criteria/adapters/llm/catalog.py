import tomllib
from pathlib import Path
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from criteria.domain.events import ProveedorId
from criteria.domain.run_config import NombreModelo


class CatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: ProveedorId
    name: NombreModelo
    input_usd_per_million: float | None = Field(default=None, ge=0)
    output_usd_per_million: float | None = Field(default=None, ge=0)
    thinking: bool | None = None

    @model_validator(mode="after")
    def _prices_come_in_pairs(self) -> Self:
        if (self.input_usd_per_million is None) != (self.output_usd_per_million is None):
            raise ValueError(f"{self.provider}:{self.name} needs both prices or neither")
        return self


class ModelCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    models: list[CatalogEntry]

    @classmethod
    def load(cls, path: Path) -> "ModelCatalog":
        with path.open("rb") as handle:
            return cls.model_validate(tomllib.load(handle))

    def entry(self, provider: ProveedorId, name: str) -> CatalogEntry | None:
        return next((m for m in self.models if m.provider == provider and m.name == name), None)

    def allows(self, provider: ProveedorId, name: str) -> bool:
        return provider == "openai_compatible" or self.entry(provider, name) is not None

    def allowed_models(self, provider: ProveedorId) -> list[str]:
        return [m.name for m in self.models if m.provider == provider]

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
