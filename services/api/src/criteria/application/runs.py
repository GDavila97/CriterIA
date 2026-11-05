from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from criteria.application.graph import APPROVAL_NODE, GraphDeps, RunState, build_graph
from criteria.domain.approval import RespuestaHumana
from criteria.domain.artifacts import Historias, Puntaje, Requerimiento
from criteria.domain.events import CorridaInicia, ModelosCorrida
from criteria.ports.agents import AgentSet
from criteria.ports.checkpoint import Checkpointer
from criteria.ports.events import EventSink


class RunNotWaitingError(RuntimeError):
    pass


@dataclass(frozen=True)
class EsperandoAprobacion:
    historias: Historias
    ultimo_seq: int


@dataclass(frozen=True)
class Terminada:
    estado: str
    puntajes: list[Puntaje]


RunOutcome = EsperandoAprobacion | Terminada


def _config(run_id: UUID) -> RunnableConfig:
    return {"configurable": {"thread_id": str(run_id)}}


class RunService:
    def __init__(self, checkpointer: Checkpointer) -> None:
        self._checkpointer = checkpointer
        self._graph = build_graph(checkpointer.saver())

    async def iniciar(
        self,
        *,
        requerimiento: Requerimiento,
        agents: AgentSet,
        events: EventSink,
        max_rondas: int,
    ) -> RunOutcome:
        proveedor = agents.analista.proveedor
        await events.emit(
            CorridaInicia,
            agent="sistema",
            proveedor=proveedor,
            modelos=ModelosCorrida(generacion=agents.analista.modelo, juez=agents.evaluador.modelo),
            version_prompts=agents.version_prompts,
            version_juez=agents.version_juez,
            juez_mismo_proveedor=agents.evaluador.proveedor == proveedor,
            experimental=agents.experimental,
            max_rondas=max_rondas,
        )
        state: RunState = {
            "requerimiento": requerimiento.texto,
            "max_rondas": max_rondas,
            "ronda": 0,
            "estado": "en_curso",
            "usos": [],
        }
        return await self._advance(events.run_id, state, agents, events)

    async def reanudar(
        self, *, respuesta: RespuestaHumana, agents: AgentSet, events: EventSink
    ) -> RunOutcome:
        snapshot = await self._graph.aget_state(_config(events.run_id))
        if APPROVAL_NODE not in snapshot.next:
            raise RunNotWaitingError("the run is not waiting for a human answer")
        command: Command[Any] = Command(resume=respuesta.model_dump(mode="json"))
        return await self._advance(events.run_id, command, agents, events)

    async def descartar(self, run_id: UUID) -> None:
        await self._checkpointer.discard(run_id)

    async def _advance(
        self, run_id: UUID, payload: Any, agents: AgentSet, events: EventSink
    ) -> RunOutcome:
        config = _config(run_id)
        await self._graph.ainvoke(payload, config, context=GraphDeps(agents=agents, events=events))
        snapshot = await self._graph.aget_state(config)
        values = cast(RunState, snapshot.values)
        if APPROVAL_NODE in snapshot.next:
            return EsperandoAprobacion(
                historias=Historias.model_validate(values["historias"]),
                ultimo_seq=values["ultimo_seq"],
            )
        await self._checkpointer.discard(run_id)
        return Terminada(
            estado=values.get("estado", "error"),
            puntajes=[Puntaje.model_validate(p) for p in values.get("puntajes", [])],
        )
