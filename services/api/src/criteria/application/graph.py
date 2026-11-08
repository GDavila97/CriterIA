from dataclasses import dataclass
from typing import Any, Literal, TypedDict

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.runtime import Runtime
from langgraph.types import interrupt

from criteria.domain.approval import MAX_OTRAS_VERSIONES, RespuestaHumana
from criteria.domain.artifacts import (
    EntregaQA,
    Historias,
    Observacion,
    Puntaje,
    Requerimiento,
    VeredictoRevisor,
)
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
    EnEsperaHumano,
    HumanoResponde,
    RespaldoSugerido,
    RevisorObserva,
    Uso,
    sumar_totales,
)
from criteria.domain.fallback import respaldo_sugerido
from criteria.domain.rules import (
    CambiosHistorias,
    cambios_historias,
    destino_correccion,
    marcar_origen,
)
from criteria.ports.agents import (
    AgentResult,
    AgentRunError,
    AgentRunner,
    AgentSet,
    EntradaAnalista,
    EntradaEvaluador,
    EntradaQA,
    EntradaRevisor,
)
from criteria.ports.events import EventSink

Rol = Literal["analista", "qa", "revisor", "evaluador"]

APPROVAL_NODE = "aprobacion"

OTRA_VERSION = "Redactando otra versión de las historias"
PROGRESO: dict[Rol, tuple[str, str]] = {
    "analista": ("Redactando historias de usuario", "Corrigiendo historias según el Revisor"),
    "qa": ("Escribiendo criterios y casos de prueba", "Corrigiendo pruebas según el Revisor"),
    "revisor": ("Revisando historias, criterios y casos", "Revisando las correcciones"),
    "evaluador": ("Calificando con la rúbrica", "Calificando con la rúbrica"),
}


class RunState(TypedDict, total=False):
    """Only plain JSON lives here, so checkpoints never hold credentials or live objects."""

    requerimiento: str
    max_rondas: int
    ronda: int
    historias: dict[str, Any]
    entrega: dict[str, Any] | None
    observaciones: list[dict[str, Any]]
    destino: Literal["analista", "qa"] | None
    puntajes: list[dict[str, Any]]
    usos: list[dict[str, Any]]
    estado: Literal["en_curso", "error", "completada"]
    respaldo_sugerido: RespaldoSugerido | None
    ultimo_seq: int
    otras_versiones: int
    pide_otra_version: bool
    nota_usuario: str | None


@dataclass(frozen=True)
class GraphDeps:
    agents: AgentSet
    events: EventSink


def _requerimiento(state: RunState) -> Requerimiento:
    return Requerimiento(texto=state["requerimiento"])


def _historias(state: RunState) -> Historias:
    return Historias.model_validate(state["historias"])


def _entrega(state: RunState) -> EntregaQA | None:
    entrega = state.get("entrega")
    return EntregaQA.model_validate(entrega) if entrega else None


def _observaciones(state: RunState, destino: str | None = None) -> tuple[Observacion, ...]:
    observaciones = (Observacion.model_validate(o) for o in state.get("observaciones", []))
    return tuple(o for o in observaciones if destino is None or o.destino == destino)


def _usos(state: RunState, uso: Uso | None) -> list[dict[str, Any]]:
    previos = list(state.get("usos", []))
    return [*previos, uso.model_dump(mode="json")] if uso else previos


async def _start(deps: GraphDeps, rol: Rol, ronda: int, mensaje: str | None = None) -> None:
    await deps.events.emit(AgenteInicia, agent=rol, ronda=ronda)
    await deps.events.emit(
        AgenteProgreso, agent=rol, mensaje=mensaje or PROGRESO[rol][1 if ronda else 0]
    )


async def _fail(deps: GraphDeps, rol: Rol, state: RunState, error: AgentRunError) -> RunState:
    runner: AgentRunner[Any, Any] = getattr(deps.agents, rol)
    respaldo = respaldo_sugerido(error.codigo, runner.proveedor)
    await deps.events.emit(
        AgenteError,
        agent=rol,
        codigo=error.codigo,
        mensaje=error.mensaje,
        respaldo_sugerido=respaldo,
        uso=error.uso,
    )
    return {"estado": "error", "usos": _usos(state, error.uso), "respaldo_sugerido": respaldo}


async def analista(state: RunState, runtime: Runtime[GraphDeps]) -> RunState:
    deps, ronda = runtime.context, state.get("ronda", 0)
    otra_version = state.get("pide_otra_version", False)
    await _start(deps, "analista", ronda, OTRA_VERSION if otra_version else None)
    entrada = EntradaAnalista(requerimiento=_requerimiento(state))
    if otra_version:
        entrada = EntradaAnalista(
            requerimiento=entrada.requerimiento,
            historias_previas=_historias(state),
            otra_version=True,
            nota_usuario=state.get("nota_usuario"),
        )
    elif ronda:
        entrada = EntradaAnalista(
            requerimiento=entrada.requerimiento,
            historias_previas=_historias(state),
            observaciones=_observaciones(state, "analista"),
        )
    try:
        result: AgentResult[Historias] = await deps.agents.analista.run(entrada)
    except AgentRunError as error:
        return await _fail(deps, "analista", state, error)
    await deps.events.emit(
        AgenteEntrega,
        agent="analista",
        ronda=ronda,
        artefactos=ArtefactosHistorias(historias=result.salida.historias),
        uso=result.uso,
    )
    return {
        "historias": result.salida.model_dump(mode="json"),
        "usos": _usos(state, result.uso),
        "pide_otra_version": False,
        "nota_usuario": None,
    }


async def solicitar_aprobacion(state: RunState, runtime: Runtime[GraphDeps]) -> RunState:
    # Kept apart from the approval node: LangGraph reruns that node from its start on resume.
    events = runtime.context.events
    await events.emit(EnEsperaHumano, agent="analista", historias=_historias(state).historias)
    return {"ultimo_seq": events.last_seq}


async def aprobacion(state: RunState, runtime: Runtime[GraphDeps]) -> RunState:
    respuesta = RespuestaHumana.model_validate(interrupt({"solicitud": "aprobar_historias"}))
    events = runtime.context.events
    if respuesta.decision == "otra_version":
        otras = state.get("otras_versiones", 0)
        if otras >= MAX_OTRAS_VERSIONES:
            raise ValueError("no more versions can be requested for this run")
        await events.emit(
            HumanoResponde,
            agent="analista",
            decision="otra_version",
            cambios=CambiosHistorias(agregadas=[], modificadas=[], eliminadas=[]),
        )
        return {
            "otras_versiones": otras + 1,
            "pide_otra_version": True,
            "nota_usuario": respuesta.nota,
        }
    previas = _historias(state)
    nuevas = respuesta.historias or previas
    cambios = cambios_historias(previas, nuevas)
    await events.emit(
        HumanoResponde,
        agent="analista",
        decision="editado" if cambios.hay_cambios() else "aprobado",
        cambios=cambios,
        historias=nuevas.historias,
    )
    return {"historias": nuevas.model_dump(mode="json"), "pide_otra_version": False}


async def qa(state: RunState, runtime: Runtime[GraphDeps]) -> RunState:
    deps, ronda = runtime.context, state.get("ronda", 0)
    await _start(deps, "qa", ronda)
    previa = _entrega(state) if ronda else None
    entrada = EntradaQA(
        historias=_historias(state),
        entrega_previa=previa,
        observaciones=_observaciones(state, "qa") if ronda else (),
    )
    try:
        result: AgentResult[EntregaQA] = await deps.agents.qa.run(entrada)
    except AgentRunError as error:
        return await _fail(deps, "qa", state, error)
    entrega = marcar_origen(result.salida, previa)
    await deps.events.emit(
        AgenteEntrega,
        agent="qa",
        ronda=ronda,
        artefactos=ArtefactosPruebas(criterios=entrega.criterios, casos=entrega.casos),
        uso=result.uso,
    )
    return {"entrega": entrega.model_dump(mode="json"), "usos": _usos(state, result.uso)}


async def revisor(state: RunState, runtime: Runtime[GraphDeps]) -> RunState:
    deps, ronda = runtime.context, state.get("ronda", 0)
    await _start(deps, "revisor", ronda)
    entrega = _entrega(state)
    if entrega is None:
        raise RuntimeError("the reviewer needs a QA delivery")
    entrada = EntradaRevisor(
        requerimiento=_requerimiento(state), historias=_historias(state), entrega=entrega
    )
    try:
        result: AgentResult[VeredictoRevisor] = await deps.agents.revisor.run(entrada)
    except AgentRunError as error:
        return await _fail(deps, "revisor", state, error)
    veredicto = result.salida
    await deps.events.emit(
        AgenteEntrega,
        agent="revisor",
        ronda=ronda,
        artefactos=ArtefactosRevision(veredicto=veredicto),
        uso=result.uso,
    )
    update: RunState = {
        "observaciones": [o.model_dump(mode="json") for o in veredicto.observaciones],
        "destino": None,
        "usos": _usos(state, result.uso),
    }
    if veredicto.aprobado:
        return update
    se_corrige = ronda < state["max_rondas"]
    await deps.events.emit(
        RevisorObserva,
        agent="revisor",
        ronda=ronda,
        observaciones=veredicto.observaciones,
        se_corrige=se_corrige,
    )
    if se_corrige:
        update["destino"] = destino_correccion(veredicto)
        update["ronda"] = ronda + 1
    return update


async def evaluador(state: RunState, runtime: Runtime[GraphDeps]) -> RunState:
    deps, ronda = runtime.context, state.get("ronda", 0)
    await _start(deps, "evaluador", ronda)
    entrega = _entrega(state)
    if entrega is None:
        raise RuntimeError("the evaluator needs a QA delivery")
    entrada = EntradaEvaluador(
        requerimiento=_requerimiento(state),
        historias=_historias(state),
        entrega=entrega,
        observaciones_pendientes=_observaciones(state),
    )
    try:
        result = await deps.agents.evaluador.run(entrada)
    except AgentRunError as error:
        return await _fail(deps, "evaluador", state, error)
    await deps.events.emit(
        AgenteEntrega,
        agent="evaluador",
        ronda=ronda,
        artefactos=ArtefactosPuntajes(puntajes=result.salida.puntajes),
        uso=result.uso,
    )
    return {
        "puntajes": [p.model_dump(mode="json") for p in result.salida.puntajes],
        "usos": _usos(state, result.uso),
    }


async def cierre(state: RunState, runtime: Runtime[GraphDeps]) -> RunState:
    estado: Literal["completada", "error"] = (
        "error" if state.get("estado") == "error" else "completada"
    )
    await runtime.context.events.emit(
        CorridaFin,
        agent="sistema",
        estado=estado,
        puntajes=[Puntaje.model_validate(p) for p in state.get("puntajes", [])],
        totales=sumar_totales([Uso.model_validate(u) for u in state.get("usos", [])]),
        respaldo_sugerido=state.get("respaldo_sugerido"),
    )
    return {"estado": estado}


def _failed(state: RunState) -> bool:
    return state.get("estado") == "error"


def after_analista(state: RunState) -> str:
    if _failed(state):
        return "cierre"
    return "qa" if state.get("ronda", 0) else "solicitar_aprobacion"


def after_aprobacion(state: RunState) -> str:
    return "analista" if state.get("pide_otra_version") else "qa"


def after_qa(state: RunState) -> str:
    return "cierre" if _failed(state) else "revisor"


def after_revisor(state: RunState) -> str:
    if _failed(state):
        return "cierre"
    return state.get("destino") or "evaluador"


def build_graph(saver: BaseCheckpointSaver[str]) -> CompiledStateGraph[Any, Any, Any, Any]:
    graph = StateGraph(RunState, context_schema=GraphDeps)
    graph.add_node("analista", analista)
    graph.add_node("solicitar_aprobacion", solicitar_aprobacion)
    graph.add_node(APPROVAL_NODE, aprobacion)
    graph.add_node("qa", qa)
    graph.add_node("revisor", revisor)
    graph.add_node("evaluador", evaluador)
    graph.add_node("cierre", cierre)
    graph.add_edge(START, "analista")
    graph.add_conditional_edges(
        "analista", after_analista, ["cierre", "qa", "solicitar_aprobacion"]
    )
    graph.add_edge("solicitar_aprobacion", APPROVAL_NODE)
    graph.add_conditional_edges(APPROVAL_NODE, after_aprobacion, ["analista", "qa"])
    graph.add_conditional_edges("qa", after_qa, ["cierre", "revisor"])
    graph.add_conditional_edges("revisor", after_revisor, ["cierre", "analista", "qa", "evaluador"])
    graph.add_edge("evaluador", "cierre")
    graph.add_edge("cierre", END)
    return graph.compile(checkpointer=saver)
