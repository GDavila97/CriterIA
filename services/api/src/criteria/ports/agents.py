from dataclasses import dataclass, field
from typing import Protocol

from criteria.domain.artifacts import (
    EntregaQA,
    Evaluacion,
    Historias,
    Observacion,
    Requerimiento,
    VeredictoRevisor,
)
from criteria.domain.events import CodigoError, ProveedorId, Uso


@dataclass(frozen=True)
class EntradaAnalista:
    requerimiento: Requerimiento
    historias_previas: Historias | None = None
    observaciones: tuple[Observacion, ...] = ()


@dataclass(frozen=True)
class EntradaQA:
    historias: Historias
    entrega_previa: EntregaQA | None = None
    observaciones: tuple[Observacion, ...] = ()


@dataclass(frozen=True)
class EntradaRevisor:
    requerimiento: Requerimiento
    historias: Historias
    entrega: EntregaQA


@dataclass(frozen=True)
class EntradaEvaluador:
    requerimiento: Requerimiento
    historias: Historias
    entrega: EntregaQA
    observaciones_pendientes: tuple[Observacion, ...] = ()


@dataclass(frozen=True)
class AgentResult[Salida]:
    salida: Salida
    uso: Uso


class AgentRunError(Exception):
    """Raised by a runner when the agent cannot deliver; the message is safe to show and log."""

    def __init__(self, codigo: CodigoError, mensaje: str, uso: Uso | None = None) -> None:
        super().__init__(mensaje)
        self.codigo: CodigoError = codigo
        self.mensaje = mensaje
        self.uso = uso


class AgentRunner[Entrada, Salida](Protocol):
    @property
    def modelo(self) -> str: ...

    @property
    def proveedor(self) -> ProveedorId: ...

    async def run(self, entrada: Entrada) -> AgentResult[Salida]: ...


@dataclass(frozen=True)
class AgentSet:
    analista: AgentRunner[EntradaAnalista, Historias]
    qa: AgentRunner[EntradaQA, EntregaQA]
    revisor: AgentRunner[EntradaRevisor, VeredictoRevisor]
    evaluador: AgentRunner[EntradaEvaluador, Evaluacion]
    version_prompts: str
    version_juez: str
    experimental: bool = field(default=False)
