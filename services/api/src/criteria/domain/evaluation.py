"""The evaluation set, the result of one run per case and a batch of them (F5).

Everything here is plain data validated by Pydantic, so a batch file can be written, read back and
published without the code that produced it.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid5

from pydantic import Field, StringConstraints, model_validator

from criteria.domain.artifacts import (
    CRITERIOS,
    CasoPrueba,
    Criterio,
    CriterioAceptacion,
    Esquema,
    HistoriaUsuario,
    Observacion,
    Puntaje,
    TipoObservacion,
)
from criteria.domain.events import CodigoError, ProveedorId

Dificultad = Literal["facil", "medio", "dificil"]
DIFICULTADES: tuple[Dificultad, ...] = ("facil", "medio", "dificil")
RolAgente = Literal["analista", "qa", "revisor", "evaluador"]
ROLES: tuple[RolAgente, ...] = ("analista", "qa", "revisor", "evaluador")
CaseId = Annotated[str, StringConstraints(pattern=r"^(facil|medio|dificil)-\d{2}$")]

# Fixed namespace so a case or a batch row keeps its id across publications (idempotency).
EVAL_NAMESPACE = UUID("6f2a1a48-3c0e-4c1b-9a59-0d6a8b2f7e11")


def case_uuid(case_id: str) -> UUID:
    return uuid5(EVAL_NAMESPACE, f"case:{case_id}")


def row_uuid(batch_id: UUID, *parts: str) -> UUID:
    return uuid5(EVAL_NAMESPACE, ":".join([str(batch_id), *parts]))


class ProblemaSembrado(Esquema):
    tipo: TipoObservacion
    descripcion: Annotated[str, StringConstraints(min_length=10, max_length=300)]


class EvalCase(Esquema):
    id: CaseId
    titulo: Annotated[str, StringConstraints(min_length=3, max_length=80)]
    dificultad: Dificultad
    dominio: Annotated[str, StringConstraints(min_length=3, max_length=60)]
    texto: Annotated[str, StringConstraints(min_length=200, max_length=1500)]
    problemas: list[ProblemaSembrado] = Field(default_factory=list)

    @model_validator(mode="after")
    def _only_hard_cases_seed_problems(self) -> "EvalCase":
        if (self.dificultad == "dificil") != bool(self.problemas):
            raise ValueError(f"{self.id}: only the hard cases carry seeded problems")
        if not self.id.startswith(self.dificultad):
            raise ValueError(f"{self.id}: the id must start with its difficulty")
        return self


class AgentStats(Esquema):
    """Every call of one agent in a run, the retries and errors included."""

    llamadas: int = Field(default=0, ge=0)
    validas_a_la_primera: int = Field(default=0, ge=0)
    reintentos: int = Field(default=0, ge=0)
    errores: list[CodigoError] = Field(default_factory=list)
    latencia_ms: int = Field(default=0, ge=0)
    tokens_entrada: int = Field(default=0, ge=0)
    tokens_salida: int = Field(default=0, ge=0)
    costo_usd: float | None = Field(default=0.0, ge=0)


class ObservacionEnRonda(Esquema):
    ronda: int = Field(ge=0)
    observacion: Observacion
    # False when the round limit was reached: the judge saw it as pending.
    se_corrige: bool = True


class ArtefactosCaso(Esquema):
    historias: list[HistoriaUsuario] = Field(default_factory=list)
    criterios: list[CriterioAceptacion] = Field(default_factory=list)
    casos: list[CasoPrueba] = Field(default_factory=list)
    observaciones: list[ObservacionEnRonda] = Field(default_factory=list)


class CaseResult(Esquema):
    case_id: CaseId
    estado: Literal["completada", "error"]
    codigo_error: CodigoError | None = None
    rondas: int = Field(ge=0)
    latencia_ms: int = Field(ge=0)
    tokens_entrada: int = Field(ge=0)
    tokens_salida: int = Field(ge=0)
    costo_usd: float | None = Field(ge=0)
    agentes: dict[RolAgente, AgentStats]
    artefactos: ArtefactosCaso
    puntajes: list[Puntaje] = Field(default_factory=list)
    # Runs repeated after a provider rate limit; their cost is in the batch's spent total.
    intentos: int = Field(default=1, ge=1)
    terminado_en: datetime

    @property
    def validas_a_la_primera(self) -> tuple[int, int]:
        llamadas = sum(a.llamadas for a in self.agentes.values())
        validas = sum(a.validas_a_la_primera for a in self.agentes.values())
        return validas, llamadas

    def puntaje(self, criterio: Criterio) -> int | None:
        return next((p.valor for p in self.puntajes if p.criterio == criterio), None)

    @property
    def calificada(self) -> bool:
        return {p.criterio for p in self.puntajes} == set(CRITERIOS)


class Deteccion(Esquema):
    """The matcher's decision for one seeded problem (post-hoc analysis, not part of the run)."""

    problema: int = Field(ge=0)
    detectado: bool
    observacion: int | None = Field(default=None, ge=0)
    justificacion: str


class DeteccionCaso(Esquema):
    case_id: CaseId
    matcher_model: str
    matcher_version: str
    detecciones: list[Deteccion]


class OllamaConfig(Esquema):
    version: str
    context_length: int = Field(ge=1)
    flash_attention: bool
    kv_cache_type: str
    gpu_percent: float = Field(ge=0, le=100)


class EvalBatch(Esquema):
    batch_id: UUID
    creado_en: datetime
    proveedor: ProveedorId
    modelo: str
    display_name: str
    output_mode: str
    version_prompts: str
    juez_proveedor: ProveedorId
    juez_modelo: str
    version_juez: str
    juez_mismo_proveedor: bool
    git_sha: str
    temperatura: float
    temperatura_juez: float
    max_rondas: int = Field(ge=0)
    aprobacion: Literal["automatica_sin_cambios"] = "automatica_sin_cambios"
    ollama: OllamaConfig | None = None
    resultados: dict[str, CaseResult] = Field(default_factory=dict)
    # Everything the providers billed, failed attempts included.
    costo_gastado_usd: float = Field(default=0.0, ge=0)
    deteccion: dict[str, DeteccionCaso] = Field(default_factory=dict)
    # The matcher is post-hoc analysis, so its cost is kept apart from the runs'.
    costo_analisis_usd: float = Field(default=0.0, ge=0)

    @property
    def clave(self) -> str:
        return f"{self.proveedor}:{self.modelo}"

    @property
    def etiqueta_juez(self) -> str:
        return f"{self.juez_proveedor}:{self.juez_modelo}"


class HumanScore(Esquema):
    batch_id: UUID
    case_id: CaseId
    criterio: Criterio
    valor: int = Field(ge=1, le=5)


class MatchCheck(Esquema):
    batch_id: UUID
    case_id: CaseId
    problema: int = Field(ge=0)
    acierta: bool


class HumanSession(Esquema):
    """Gus's blind scores and checks of the matcher, kept next to the batches."""

    semilla: int
    muestra: list[tuple[UUID, CaseId]] = Field(default_factory=list)
    revisiones_emparejador: list[tuple[UUID, CaseId, int]] = Field(default_factory=list)
    puntajes: list[HumanScore] = Field(default_factory=list)
    emparejamientos: list[MatchCheck] = Field(default_factory=list)
