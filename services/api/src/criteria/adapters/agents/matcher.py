"""The matcher of seeded problems: post-hoc analysis of a finished run, never part of it."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from pydantic import Field, model_validator
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings

from criteria.adapters.agents.blocks import data_block
from criteria.application.analysis import MatchOutcome
from criteria.domain.artifacts import Esquema, Observacion, TipoObservacion
from criteria.domain.evaluation import Deteccion, EvalCase, ObservacionEnRonda
from criteria.domain.text import Justificacion

MATCHER_DIR = "analisis"
OUTPUT_RETRIES = 1


class DecisionProblema(Esquema):
    problema: int = Field(ge=0)
    detectado: bool
    observacion: int | None = Field(default=None, ge=0)
    justificacion: Justificacion

    @model_validator(mode="after")
    def _observation_only_when_detected(self) -> Self:
        if self.detectado != (self.observacion is not None):
            raise ValueError("a detected problem names one observation; an undetected one none")
        return self


class Emparejamiento(Esquema):
    decisiones: list[DecisionProblema]


@dataclass(frozen=True)
class EntradaEmparejador:
    caso: EvalCase
    observaciones: Sequence[ObservacionEnRonda]


def load_matcher_prompt(prompts_dir: Path, version: str) -> str:
    path = prompts_dir / MATCHER_DIR / version / "emparejador.md"
    return path.read_text(encoding="utf-8").strip()


class ProblemaNumerado(Esquema):
    numero: int
    tipo: TipoObservacion
    descripcion: str


class ObservacionNumerada(Esquema):
    numero: int
    ronda: int
    observacion: Observacion


def render(entrada: EntradaEmparejador) -> str:
    problemas = [
        ProblemaNumerado(numero=i, tipo=p.tipo, descripcion=p.descripcion)
        for i, p in enumerate(entrada.caso.problemas)
    ]
    observaciones = [
        ObservacionNumerada(numero=i, ronda=o.ronda, observacion=o.observacion)
        for i, o in enumerate(entrada.observaciones)
    ]
    return "Tarea: decide qué problemas sembrados detectó el Revisor.\n\n" + "\n\n".join(
        [
            data_block("requerimiento", entrada.caso.texto),
            data_block("problemas", list(problemas)),
            data_block("observaciones", list(observaciones)),
        ]
    )


def _check(ctx: RunContext[EntradaEmparejador], salida: Emparejamiento) -> Emparejamiento:
    esperados = list(range(len(ctx.deps.caso.problemas)))
    if [d.problema for d in salida.decisiones] != esperados:
        raise ModelRetry(f"Devuelve una decisión por problema, en orden: {esperados}.")
    total = len(ctx.deps.observaciones)
    fuera = [
        d.observacion
        for d in salida.decisiones
        if d.observacion is not None and d.observacion >= total
    ]
    if fuera:
        raise ModelRetry(f"Solo hay {total} observaciones; no existen las número {fuera}.")
    return salida


class ModelMatcher:
    def __init__(
        self,
        model: Model,
        settings: ModelSettings,
        prompt: str,
        cost_usd: Callable[[int, int], float | None],
    ) -> None:
        self._model = model
        self._settings = settings
        self._cost_usd = cost_usd
        self._agent: Agent[EntradaEmparejador, Emparejamiento] = Agent(
            output_type=Emparejamiento,
            deps_type=EntradaEmparejador,
            instructions=prompt,
            retries={"output": OUTPUT_RETRIES, "tools": 0},
            name="emparejador",
            defer_model_check=True,
        )
        self._agent.output_validator(_check)

    async def match(
        self, caso: EvalCase, observaciones: Sequence[ObservacionEnRonda]
    ) -> MatchOutcome:
        entrada = EntradaEmparejador(caso=caso, observaciones=observaciones)
        result = await self._agent.run(
            render(entrada), deps=entrada, model=self._model, model_settings=self._settings
        )
        usage = result.usage
        return MatchOutcome(
            detecciones=[
                Deteccion(
                    problema=d.problema,
                    detectado=d.detectado,
                    observacion=d.observacion,
                    justificacion=d.justificacion,
                )
                for d in result.output.decisiones
            ],
            costo_usd=self._cost_usd(usage.input_tokens or 0, usage.output_tokens or 0),
        )
