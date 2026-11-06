from collections.abc import Callable
from pathlib import Path

import pydantic_ai
from pydantic_ai import Agent, ModelRetry, NativeOutput, RunContext
from pydantic_ai.output import OutputSpec

from criteria.adapters.agents.blocks import data_block
from criteria.adapters.agents.prompts import RolAgente, load_prompt
from criteria.adapters.agents.runner import ModelBinding, PydanticAgentRunner
from criteria.domain.artifacts import EntregaQA, Evaluacion, Historias, VeredictoRevisor
from criteria.domain.rules import historias_desconocidas, referencias_desconocidas
from criteria.ports.agents import (
    AgentSet,
    EntradaAnalista,
    EntradaEvaluador,
    EntradaQA,
    EntradaRevisor,
)
from criteria.ports.clock import Clock

# The startup banner goes to stdout and would corrupt the CLI's JSON-lines output.
pydantic_ai.BANNER_ENABLED = False

OUTPUT_RETRIES = 1


def render_analista(entrada: EntradaAnalista) -> str:
    bloques = [data_block("requerimiento", entrada.requerimiento.texto)]
    if entrada.historias_previas is None:
        return "Tarea: redacta las historias de usuario.\n\n" + bloques[0]
    bloques.append(data_block("historias", entrada.historias_previas))
    bloques.append(data_block("observaciones", list(entrada.observaciones)))
    return "Tarea: corrige las historias según las observaciones.\n\n" + "\n\n".join(bloques)


def render_qa(entrada: EntradaQA) -> str:
    bloques = [data_block("historias", entrada.historias)]
    if entrada.entrega_previa is None:
        return "Tarea: escribe criterios de aceptación y casos de prueba.\n\n" + bloques[0]
    bloques.append(data_block("entrega_previa", entrada.entrega_previa))
    bloques.append(data_block("observaciones", list(entrada.observaciones)))
    return "Tarea: corrige la entrega según las observaciones.\n\n" + "\n\n".join(bloques)


def render_revisor(entrada: EntradaRevisor) -> str:
    return "Tarea: revisa los artefactos.\n\n" + "\n\n".join(
        [
            data_block("requerimiento", entrada.requerimiento.texto),
            data_block("historias", entrada.historias),
            data_block("entrega", entrada.entrega),
        ]
    )


def render_evaluador(entrada: EntradaEvaluador) -> str:
    return "Tarea: califica los artefactos con la rúbrica.\n\n" + "\n\n".join(
        [
            data_block("requerimiento", entrada.requerimiento.texto),
            data_block("historias", entrada.historias),
            data_block("entrega", entrada.entrega),
            data_block("observaciones_pendientes", list(entrada.observaciones_pendientes)),
        ]
    )


def _check_qa(ctx: RunContext[EntradaQA], entrega: EntregaQA) -> EntregaQA:
    desconocidas = historias_desconocidas(entrega, ctx.deps.historias)
    if desconocidas:
        raise ModelRetry(f"Hay artefactos para historias que no existen: {', '.join(desconocidas)}")
    sin_pruebas = sorted(ctx.deps.historias.ids() - {caso.historia_id for caso in entrega.casos})
    if sin_pruebas:
        raise ModelRetry(f"Faltan casos de prueba para: {', '.join(sin_pruebas)}")
    return entrega


def _check_revisor(
    ctx: RunContext[EntradaRevisor], veredicto: VeredictoRevisor
) -> VeredictoRevisor:
    desconocidas = referencias_desconocidas(veredicto, ctx.deps.historias, ctx.deps.entrega)
    if desconocidas:
        raise ModelRetry(f"Las observaciones citan ids que no existen: {', '.join(desconocidas)}")
    return veredicto


class AgentFactory:
    def __init__(self, prompts_dir: Path, version: str, judge_version: str, clock: Clock) -> None:
        self._prompts_dir = prompts_dir
        self._version = version
        self._judge_version = judge_version
        self._clock = clock

    def build(
        self, generacion: ModelBinding, juez: ModelBinding, experimental: bool = False
    ) -> AgentSet:
        analista = self._agent("analista", EntradaAnalista, Historias, generacion)
        qa = self._agent("qa", EntradaQA, EntregaQA, generacion)
        qa.output_validator(_check_qa)
        revisor = self._agent("revisor", EntradaRevisor, VeredictoRevisor, generacion)
        revisor.output_validator(_check_revisor)
        evaluador = self._agent(
            "evaluador", EntradaEvaluador, Evaluacion, juez, self._judge_version
        )
        return AgentSet(
            analista=self._runner("analista", analista, generacion, render_analista),
            qa=self._runner("qa", qa, generacion, render_qa),
            revisor=self._runner("revisor", revisor, generacion, render_revisor),
            evaluador=self._runner("evaluador", evaluador, juez, render_evaluador),
            version_prompts=self._version,
            version_juez=self._judge_version,
            experimental=experimental,
        )

    def _agent[Entrada, Salida](
        self,
        rol: RolAgente,
        deps: type[Entrada],
        output: type[Salida],
        binding: ModelBinding,
        version: str | None = None,
    ) -> Agent[Entrada, Salida]:
        output_type: OutputSpec[Salida] = (
            NativeOutput(output) if binding.output_mode == "native" else output
        )
        return Agent(
            output_type=output_type,
            deps_type=deps,
            instructions=load_prompt(self._prompts_dir, version or self._version, rol),
            retries={"output": OUTPUT_RETRIES, "tools": 0},
            name=rol,
            defer_model_check=True,
        )

    def _runner[Entrada, Salida](
        self,
        rol: RolAgente,
        agent: Agent[Entrada, Salida],
        binding: ModelBinding,
        render: Callable[[Entrada], str],
    ) -> PydanticAgentRunner[Entrada, Salida]:
        return PydanticAgentRunner(
            rol=rol,
            agent=agent,
            binding=binding,
            render=render,
            clock=self._clock,
        )
