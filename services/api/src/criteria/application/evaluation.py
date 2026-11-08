"""Runs the evaluation set through the real graph, one case at a time, and keeps each result.

The human pause is answered with an approval without changes, so every model works from the stories
its own Analista wrote. A batch is saved after every case, so an interrupted batch resumes where it
stopped.
"""

from collections.abc import Awaitable, Callable, Sequence
from typing import Protocol
from uuid import uuid4

from criteria.application.runs import EsperandoAprobacion, RunService
from criteria.domain.approval import RespuestaHumana
from criteria.domain.artifacts import Requerimiento
from criteria.domain.evaluation import (
    ROLES,
    AgentStats,
    ArtefactosCaso,
    CaseResult,
    EvalBatch,
    EvalCase,
    ObservacionEnRonda,
    RolAgente,
)
from criteria.domain.events import (
    AgenteEntrega,
    AgenteError,
    ArtefactosHistorias,
    ArtefactosPruebas,
    ArtefactosPuntajes,
    CodigoError,
    CorridaFin,
    EventoBase,
    RevisorObserva,
    Uso,
)
from criteria.ports.agents import AgentSet
from criteria.ports.clock import Clock
from criteria.ports.events import EventSink

# Seconds to wait before repeating a case after a provider rate limit (429).
RATE_LIMIT_BACKOFF = (30.0, 60.0, 120.0)
# Failures of the account or the provider's limits, not of the model: the batch stops without
# recording the case, so it runs again when the batch resumes.
STOPPING_CODES: frozenset[CodigoError] = frozenset(
    {"clave_invalida", "sin_saldo", "cupo_gratuito_agotado", "limite_proveedor"}
)


class _Collector(EventSink):
    def __init__(self, clock: Clock) -> None:
        super().__init__(uuid4(), clock)
        self.events: list[EventoBase] = []

    async def deliver(self, event: EventoBase) -> None:
        self.events.append(event)


class BatchStore(Protocol):
    def save(self, batch: EvalBatch) -> None: ...


class BatchStoppedError(RuntimeError):
    def __init__(self, case_id: str, codigo: CodigoError) -> None:
        super().__init__(f"{case_id}: {codigo}")
        self.case_id = case_id
        self.codigo = codigo


def _add(stats: AgentStats, **change: object) -> AgentStats:
    return stats.model_copy(update=change)


def _spent(current: AgentStats, uso: Uso) -> dict[str, object]:
    return {
        "reintentos": current.reintentos + uso.reintentos,
        "latencia_ms": current.latencia_ms + uso.latencia_ms,
        "tokens_entrada": current.tokens_entrada + uso.tokens_entrada,
        "tokens_salida": current.tokens_salida + uso.tokens_salida,
        "costo_usd": None
        if current.costo_usd is None or uso.costo_usd is None
        else round(current.costo_usd + uso.costo_usd, 6),
    }


def _agent_stats(events: Sequence[EventoBase]) -> dict[RolAgente, AgentStats]:
    stats: dict[RolAgente, AgentStats] = {rol: AgentStats() for rol in ROLES}
    for event in events:
        rol = next((r for r in ROLES if r == event.agent), None)
        if rol is None:
            continue
        current = stats[rol]
        if isinstance(event, AgenteEntrega):
            uso = event.uso
            stats[rol] = _add(
                current,
                llamadas=current.llamadas + 1,
                validas_a_la_primera=current.validas_a_la_primera + int(uso.reintentos == 0),
                **_spent(current, uso),
            )
        elif isinstance(event, AgenteError):
            stats[rol] = _add(
                current,
                llamadas=current.llamadas + 1,
                errores=[*current.errores, event.codigo],
                **({} if event.uso is None else _spent(current, event.uso)),
            )
    return stats


def _artifacts(events: Sequence[EventoBase]) -> ArtefactosCaso:
    artefactos = ArtefactosCaso()
    for event in events:
        if isinstance(event, AgenteEntrega):
            entrega = event.artefactos
            if isinstance(entrega, ArtefactosHistorias):
                artefactos = artefactos.model_copy(update={"historias": entrega.historias})
            elif isinstance(entrega, ArtefactosPruebas):
                artefactos = artefactos.model_copy(
                    update={"criterios": entrega.criterios, "casos": entrega.casos}
                )
        elif isinstance(event, RevisorObserva):
            nuevas = [
                ObservacionEnRonda(ronda=event.ronda, observacion=o, se_corrige=event.se_corrige)
                for o in event.observaciones
            ]
            artefactos = artefactos.model_copy(
                update={"observaciones": [*artefactos.observaciones, *nuevas]}
            )
    return artefactos


def summarize(
    case_id: str, events: Sequence[EventoBase], latencia_ms: int, intentos: int, clock: Clock
) -> CaseResult:
    """The result of one run, read from the same events the web receives."""
    fin = next(e for e in reversed(events) if isinstance(e, CorridaFin))
    error = next((e for e in events if isinstance(e, AgenteError)), None)
    puntajes = next(
        (
            e.artefactos.puntajes
            for e in reversed(events)
            if isinstance(e, AgenteEntrega) and isinstance(e.artefactos, ArtefactosPuntajes)
        ),
        fin.puntajes,
    )
    return CaseResult(
        case_id=case_id,
        estado=fin.estado,
        codigo_error=error.codigo if error else fin.codigo,
        rondas=sum(1 for e in events if isinstance(e, RevisorObserva) and e.se_corrige),
        latencia_ms=latencia_ms,
        tokens_entrada=fin.totales.tokens_entrada,
        tokens_salida=fin.totales.tokens_salida,
        costo_usd=fin.totales.costo_usd,
        agentes=_agent_stats(events),
        artefactos=_artifacts(events),
        puntajes=puntajes,
        intentos=intentos,
        terminado_en=clock.now(),
    )


class EvalRunner:
    def __init__(  # noqa: PLR0913  composition point of the batch run
        self,
        *,
        service: RunService,
        agents: AgentSet,
        clock: Clock,
        store: BatchStore,
        sleep: Callable[[float], Awaitable[None]],
        max_rondas: int,
        backoff: Sequence[float] = RATE_LIMIT_BACKOFF,
    ) -> None:
        self._service = service
        self._agents = agents
        self._clock = clock
        self._store = store
        self._sleep = sleep
        self._max_rondas = max_rondas
        self._backoff = tuple(backoff)

    async def run(
        self,
        batch: EvalBatch,
        cases: Sequence[EvalCase],
        progress: Callable[[str], None] = lambda _message: None,
    ) -> EvalBatch:
        for case in cases:
            if case.id in batch.resultados:
                progress(f"{case.id}: ya estaba completo, se salta")
                continue
            result, spent = await self._run_case(case, progress)
            batch = batch.model_copy(
                update={
                    "resultados": {**batch.resultados, case.id: result},
                    "costo_gastado_usd": round(batch.costo_gastado_usd + spent, 6),
                }
            )
            self._store.save(batch)
            progress(
                f"{case.id}: {result.estado}"
                + (f" ({result.codigo_error})" if result.codigo_error else "")
                + f" · {result.latencia_ms / 1000:.1f} s · costo acumulado "
                f"US$ {batch.costo_gastado_usd:.4f}"
            )
        return batch

    async def _run_case(
        self, case: EvalCase, progress: Callable[[str], None]
    ) -> tuple[CaseResult, float]:
        spent = 0.0
        for intento in range(1, len(self._backoff) + 2):
            events = _Collector(self._clock)
            started = self._clock.monotonic()
            outcome = await self._service.iniciar(
                requerimiento=Requerimiento(texto=case.texto),
                agents=self._agents,
                events=events,
                max_rondas=self._max_rondas,
            )
            while isinstance(outcome, EsperandoAprobacion):
                outcome = await self._service.reanudar(
                    respuesta=RespuestaHumana(decision="aprobado"),
                    agents=self._agents,
                    events=events,
                )
            latencia_ms = round((self._clock.monotonic() - started) * 1000)
            result = summarize(case.id, events.events, latencia_ms, intento, self._clock)
            spent += result.costo_usd or 0.0
            if result.codigo_error == "limite_proveedor" and intento <= len(self._backoff):
                wait = self._backoff[intento - 1]
                progress(f"{case.id}: límite del proveedor (429); se repite en {wait:.0f} s")
                await self._sleep(wait)
                continue
            if result.codigo_error in STOPPING_CODES:
                raise BatchStoppedError(case.id, result.codigo_error)
            return result, spent
        raise AssertionError(
            "unreachable: the last attempt always returns or stops"
        )  # pragma: no cover
