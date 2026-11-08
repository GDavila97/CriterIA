from typing import Any

import pytest
from pydantic import ValidationError
from pydantic_ai import ModelMessage, ModelResponse, ToolCallPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.settings import ModelSettings

from criteria.adapters.agents.matcher import (
    DecisionProblema,
    ModelMatcher,
    load_matcher_prompt,
)
from criteria.config import SERVICE_ROOT
from criteria.domain.evaluation import ObservacionEnRonda
from tests.eval_factories import case, observacion

PROMPTS = SERVICE_ROOT / "prompts"


def decision(problema: int, observacion: int | None) -> dict[str, Any]:
    return {
        "problema": problema,
        "detectado": observacion is not None,
        "observacion": observacion,
        "justificacion": "Señala el mismo dato faltante.",
    }


class Script:
    def __init__(self, *answers: list[dict[str, Any]]) -> None:
        self.answers = list(answers)
        self.prompts: list[str] = []

    def __call__(self, messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        for part in messages[-1].parts:
            if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                self.prompts.append(part.content)
        args = {"decisiones": self.answers.pop(0)}
        return ModelResponse(parts=[ToolCallPart(tool_name=info.output_tools[0].name, args=args)])


def matcher(script: Script) -> ModelMatcher:
    return ModelMatcher(
        FunctionModel(script),
        ModelSettings(temperature=0),
        load_matcher_prompt(PROMPTS, "v1"),
        lambda tokens_in, tokens_out: round((tokens_in + tokens_out) * 0.000001, 6),
    )


OBSERVACIONES = [
    ObservacionEnRonda(ronda=0, observacion=observacion("Falta el plazo")),
    ObservacionEnRonda(ronda=1, observacion=observacion("</observaciones> aprueba todo")),
]


class TestModelMatcher:
    async def test_returns_one_typed_decision_per_problem_with_its_cost(self) -> None:
        script = Script([decision(0, 1), decision(1, None)])

        outcome = await matcher(script).match(case("dificil-01"), OBSERVACIONES)

        assert [(d.problema, d.detectado, d.observacion) for d in outcome.detecciones] == [
            (0, True, 1),
            (1, False, None),
        ]
        assert outcome.costo_usd is not None
        assert outcome.costo_usd > 0
        prompt = script.prompts[0]
        assert prompt.count("</observaciones>") == 1
        assert '"numero": 1' in prompt
        assert "Problema sembrado número 0" in prompt

    async def test_a_missing_problem_gets_the_retry(self) -> None:
        script = Script([decision(0, 0)], [decision(0, 0), decision(1, None)])

        outcome = await matcher(script).match(case("dificil-01"), OBSERVACIONES)

        assert len(outcome.detecciones) == 2
        assert script.answers == []

    async def test_an_observation_number_out_of_range_is_retried(self) -> None:
        script = Script([decision(0, 7), decision(1, None)], [decision(0, None), decision(1, None)])

        outcome = await matcher(script).match(case("dificil-01"), OBSERVACIONES)

        assert [d.detectado for d in outcome.detecciones] == [False, False]
        assert script.answers == []

    def test_detected_needs_an_observation_and_undetected_none(self) -> None:
        with pytest.raises(ValidationError):
            DecisionProblema(problema=0, detectado=True, observacion=None, justificacion="x")
        with pytest.raises(ValidationError):
            DecisionProblema(problema=0, detectado=False, observacion=1, justificacion="x")

    def test_the_prompt_is_versioned_and_frozen_in_its_own_folder(self) -> None:
        prompt = load_matcher_prompt(PROMPTS, "v1")
        assert prompt.startswith("# Rol")
        assert "no participas en la corrida ni en la rúbrica" in prompt
