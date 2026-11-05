from collections.abc import Callable
from typing import TextIO
from uuid import UUID

from criteria.domain.artifacts import HistoriaUsuario
from criteria.domain.events import (
    AgenteEntrega,
    AgenteError,
    AgenteInicia,
    AgenteProgreso,
    ArtefactosHistorias,
    ArtefactosPruebas,
    ArtefactosPuntajes,
    ArtefactosRevision,
    CorridaFin,
    CorridaInicia,
    EnEsperaHumano,
    EventoBase,
    HumanoResponde,
    RevisorObserva,
    Uso,
)
from criteria.ports.clock import Clock
from criteria.ports.events import EventSink


def _costo(costo: float | None) -> str:
    return "costo n/d" if costo is None else f"US$ {costo:.6f}"


def _uso(uso: Uso) -> str:
    return (
        f"{uso.tokens_entrada}/{uso.tokens_salida} tokens · {uso.latencia_ms / 1000:.1f} s · "
        f"{_costo(uso.costo_usd)} · reintentos {uso.reintentos}"
    )


def format_historia(historia: HistoriaUsuario) -> list[str]:
    lines = [
        f"{historia.id} [{historia.prioridad}] Como {historia.como}, quiero {historia.quiero}, "
        f"para {historia.para}."
    ]
    lines += [f"  supuesto: {supuesto}" for supuesto in historia.supuestos]
    return lines


def _artefactos(event: AgenteEntrega) -> list[str]:
    match event.artefactos:
        case ArtefactosHistorias(historias=historias):
            return [line for h in historias for line in format_historia(h)]
        case ArtefactosPruebas(criterios=criterios, casos=casos):
            lines = [f"{c.id} ({c.historia_id}) {c.texto}" for c in criterios]
            for caso in casos:
                g = caso.gherkin
                lines.append(f"{caso.id} ({caso.historia_id}, {caso.origen}) {caso.titulo}")
                lines += [f"  paso {n}: {paso}" for n, paso in enumerate(caso.pasos, start=1)]
                lines.append(f"  esperado: {caso.resultado_esperado}")
                lines.append(f"  Escenario: {g.escenario}")
                lines += [f"    Dado {t}" for t in g.dado]
                lines += [f"    Cuando {t}" for t in g.cuando]
                lines += [f"    Entonces {t}" for t in g.entonces]
            return lines
        case ArtefactosRevision(veredicto=veredicto):
            return ["aprobado"] if veredicto.aprobado else []
        case ArtefactosPuntajes(puntajes=puntajes):
            return [f"{p.criterio}: {p.valor}/5 · {p.justificacion}" for p in puntajes]
    return []


def _resumen(event: EventoBase) -> tuple[str, list[str]]:  # noqa: PLR0911
    match event:
        case CorridaInicia():
            mismo = " (mismo proveedor)" if event.juez_mismo_proveedor else ""
            return (
                f"corrida {event.run_id} · {event.proveedor}"
                f" · generación {event.modelos.generacion} · juez {event.modelos.juez}{mismo}"
                f" · prompts {event.version_prompts} · juez {event.version_juez}"
                f" · rondas {event.max_rondas}",
                [],
            )
        case AgenteInicia():
            return f"inicia (ronda {event.ronda})", []
        case AgenteProgreso():
            return event.mensaje, []
        case AgenteEntrega():
            return f"entrega (ronda {event.ronda}) · {_uso(event.uso)}", _artefactos(event)
        case EnEsperaHumano():
            return "espera tu aprobación de las historias", []
        case HumanoResponde():
            cambios = event.cambios
            return (
                f"{event.decision} · agregadas {cambios.agregadas or '-'} · modificadas "
                f"{cambios.modificadas or '-'} · eliminadas {cambios.eliminadas or '-'}",
                [],
            )
        case RevisorObserva():
            accion = "se corrige" if event.se_corrige else "sin más rondas"
            return (
                f"{len(event.observaciones)} observaciones (ronda {event.ronda}, {accion})",
                [
                    f"{o.tipo} → {o.destino} {o.referencias}: {o.descripcion} Sugerencia: "
                    f"{o.sugerencia}"
                    for o in event.observaciones
                ],
            )
        case AgenteError():
            sugerencia = (
                f" Puedes usar el gratuito ({event.respaldo_sugerido})."
                if event.respaldo_sugerido
                else ""
            )
            return f"error {event.codigo}: {event.mensaje}{sugerencia}", []
        case CorridaFin():
            t = event.totales
            return (
                f"fin · {event.estado} · {t.tokens_entrada}/{t.tokens_salida} tokens · "
                f"{t.latencia_ms / 1000:.1f} s · {_costo(t.costo_usd)}",
                [],
            )
    return type(event).__name__, []


def format_event(event: EventoBase) -> str:
    titulo, detalle = _resumen(event)
    lines = [f"[{event.seq:02d}] {event.agent:<9} · {titulo}"]
    lines += [f"       {line}" for line in detalle]
    return "\n".join(lines)


class PrintingEventSink(EventSink):
    def __init__(
        self,
        run_id: UUID,
        clock: Clock,
        out: TextIO,
        as_json: bool = False,
        last_seq: int = 0,
    ) -> None:
        super().__init__(run_id, clock, last_seq)
        self._out = out
        self._format: Callable[[EventoBase], str] = (
            (lambda event: event.model_dump_json()) if as_json else format_event
        )

    async def deliver(self, event: EventoBase) -> None:
        print(self._format(event), file=self._out, flush=True)
