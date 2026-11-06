"""Request and response bodies of the HTTP API; with the events they form the web contract."""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, SecretStr, StringConstraints

from criteria.domain.events import ProveedorId
from criteria.domain.run_config import Nivel, NombreModelo

KeySource = Literal["usuario", "servidor"]


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class ErrorBody(Body):
    code: str
    message: str


class HealthBody(Body):
    status: Literal["ok"]
    version: str


class RunCreateBody(Body):
    requerimiento: Annotated[str, StringConstraints(max_length=2000)]
    proveedor: ProveedorId | None = None
    nivel: Nivel | None = None
    modelo: NombreModelo | None = None
    juez: ProveedorId | None = None
    max_rondas: int | None = Field(default=None, ge=0, le=5)


class ModelPlanBody(Body):
    proveedor: ProveedorId
    modelo: str
    clave: KeySource


class RunCreatedBody(Body):
    run_id: UUID
    generacion: ModelPlanBody
    juez: ModelPlanBody
    juez_mismo_proveedor: bool
    costo_estimado_usd: float | None
    costo_servidor_usd: float


class CredentialPutBody(Body):
    api_key: Annotated[SecretStr, Field(min_length=1, max_length=512)]
    base_url: HttpUrl | None = None


class CredentialBody(Body):
    proveedor: ProveedorId
    last4: str
    validated_at: datetime
    base_url: str | None


class SettingsBody(Body):
    save_history: bool = False
    default_provider: ProveedorId | None = None
    default_tier: Nivel | None = None
    judge_provider: ProveedorId | None = None


class CatalogTierBody(Body):
    nivel: Nivel
    modelo: str
    costo_estimado_usd: float | None


class CatalogProviderBody(Body):
    proveedor: ProveedorId
    disponible: bool
    clave: KeySource | None
    acepta_clave_propia: bool
    niveles: list[CatalogTierBody]
    modelos: list[str]


class CatalogBody(Body):
    proveedores: list[CatalogProviderBody]
    proveedor_predeterminado: ProveedorId
    juez_predeterminado: ProveedorId


class HistorySummaryBody(Body):
    id: UUID
    status: str
    provider: str
    model: str
    created_at: datetime
    scores: list[dict[str, Any]]


class HistoryItemBody(Body):
    id: UUID
    status: str
    requirement: str
    artifacts: dict[str, Any]
    scores: list[dict[str, Any]]
    provider: str
    model: str
    judge_model: str
    prompt_version: str
    judge_version: str
    experimental: bool
    totals: dict[str, Any]
    created_at: datetime | None


class HistoryDeletedBody(Body):
    deleted: int


class EvaluationBatchBody(Body):
    id: UUID
    created_at: datetime
    provider: str
    model: str
    prompt_version: str
    judge_model: str
    judge_version: str
    output_mode: str
    cases: int
    valid_rate: float | None
    latency_p50_ms: float | None
    latency_p95_ms: float | None
    cost_usd_avg: float | None


class EvaluationBody(Body):
    lotes: list[EvaluationBatchBody]
