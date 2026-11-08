from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, StringConstraints, TypeAdapter

from criteria.domain.artifacts import (
    CasoPrueba,
    CriterioAceptacion,
    Esquema,
    HistoriaUsuario,
    Observacion,
    Puntaje,
    VeredictoRevisor,
)
from criteria.domain.rules import CambiosHistorias
from criteria.domain.text import TextoCorto

AgenteId = Literal["analista", "qa", "revisor", "evaluador", "sistema"]
ProveedorId = Literal["openai", "anthropic", "groq", "ollama", "openai_compatible"]
CodigoError = Literal[
    "salida_invalida",
    "clave_invalida",
    "sin_saldo",
    "limite_proveedor",
    "proveedor_no_disponible",
    "destino_no_permitido",
    "error_interno",
]
RespaldoSugerido = Literal["groq"]
MensajeProgreso = Annotated[str, StringConstraints(min_length=1, max_length=80)]
MensajeSeguro = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class Uso(Esquema):
    tokens_entrada: int = Field(ge=0)
    tokens_salida: int = Field(ge=0)
    latencia_ms: int = Field(ge=0)
    costo_usd: float | None = Field(default=None, ge=0)
    reintentos: int = Field(default=0, ge=0)


class ModelosCorrida(Esquema):
    generacion: TextoCorto
    juez: TextoCorto


class ArtefactosHistorias(Esquema):
    tipo: Literal["historias"] = "historias"
    historias: list[HistoriaUsuario]


class ArtefactosPruebas(Esquema):
    tipo: Literal["pruebas"] = "pruebas"
    criterios: list[CriterioAceptacion]
    casos: list[CasoPrueba]


class ArtefactosRevision(Esquema):
    tipo: Literal["revision"] = "revision"
    veredicto: VeredictoRevisor


class ArtefactosPuntajes(Esquema):
    tipo: Literal["puntajes"] = "puntajes"
    puntajes: list[Puntaje]


Artefactos = Annotated[
    ArtefactosHistorias | ArtefactosPruebas | ArtefactosRevision | ArtefactosPuntajes,
    Field(discriminator="tipo"),
]


class EventoBase(Esquema):
    run_id: UUID
    seq: int = Field(ge=1)
    ts: AwareDatetime
    agent: AgenteId


class CorridaInicia(EventoBase):
    type: Literal["corrida_inicia"] = "corrida_inicia"
    proveedor: ProveedorId
    modelos: ModelosCorrida
    version_prompts: Annotated[str, StringConstraints(pattern=r"^v\d+$")]
    version_juez: Annotated[str, StringConstraints(pattern=r"^v\d+$")]
    juez_mismo_proveedor: bool
    experimental: bool
    max_rondas: int = Field(ge=0)


class AgenteInicia(EventoBase):
    type: Literal["agente_inicia"] = "agente_inicia"
    ronda: int = Field(ge=0)


class AgenteProgreso(EventoBase):
    type: Literal["agente_progreso"] = "agente_progreso"
    mensaje: MensajeProgreso


class AgenteEntrega(EventoBase):
    type: Literal["agente_entrega"] = "agente_entrega"
    ronda: int = Field(ge=0)
    artefactos: Artefactos
    uso: Uso


class EnEsperaHumano(EventoBase):
    type: Literal["en_espera_humano"] = "en_espera_humano"
    solicitud: Literal["aprobar_historias"] = "aprobar_historias"
    historias: list[HistoriaUsuario]


class HumanoResponde(EventoBase):
    type: Literal["humano_responde"] = "humano_responde"
    decision: Literal["aprobado", "editado", "otra_version"]
    cambios: CambiosHistorias
    # The stories QA will work with; null when the person asked for another version.
    historias: list[HistoriaUsuario] | None = None


class RevisorObserva(EventoBase):
    type: Literal["revisor_observa"] = "revisor_observa"
    ronda: int = Field(ge=0)
    observaciones: list[Observacion] = Field(min_length=1)
    se_corrige: bool


class AgenteError(EventoBase):
    type: Literal["agente_error"] = "agente_error"
    codigo: CodigoError
    mensaje: MensajeSeguro
    respaldo_sugerido: RespaldoSugerido | None = None


class Totales(Esquema):
    tokens_entrada: int = Field(ge=0)
    tokens_salida: int = Field(ge=0)
    latencia_ms: int = Field(ge=0)
    costo_usd: float | None = Field(default=None, ge=0)


class CorridaFin(EventoBase):
    type: Literal["corrida_fin"] = "corrida_fin"
    estado: Literal["completada", "error"]
    puntajes: list[Puntaje]
    totales: Totales
    respaldo_sugerido: RespaldoSugerido | None = None
    # Only when the run stopped outside an agent; agent failures carry theirs in agente_error.
    codigo: CodigoError | None = None
    mensaje: MensajeSeguro | None = None


Evento = Annotated[
    CorridaInicia
    | AgenteInicia
    | AgenteProgreso
    | AgenteEntrega
    | EnEsperaHumano
    | HumanoResponde
    | RevisorObserva
    | AgenteError
    | CorridaFin,
    Field(discriminator="type"),
]

evento_adapter: TypeAdapter[Evento] = TypeAdapter(Evento)


def sumar_totales(usos: list[Uso]) -> Totales:
    """Cost is reported only when every call has a known price; a partial sum would mislead."""
    costos = [uso.costo_usd for uso in usos]
    return Totales(
        tokens_entrada=sum(uso.tokens_entrada for uso in usos),
        tokens_salida=sum(uso.tokens_salida for uso in usos),
        latencia_ms=sum(uso.latencia_ms for uso in usos),
        costo_usd=None
        if any(costo is None for costo in costos)
        else round(sum(c for c in costos if c is not None), 6),
    )
