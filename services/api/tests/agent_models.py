from collections.abc import Callable
from dataclasses import dataclass, field, replace
from typing import Any

from pydantic_ai import ModelMessage, ModelResponse, ToolCallPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.settings import ModelSettings

from criteria.adapters.agents.runner import ModelBinding
from criteria.domain.events import ProveedorId
from criteria.ports.agents import AgentResult, AgentSet

Step = dict[str, Any] | BaseException | Callable[[list[ModelMessage]], dict[str, Any]]
ModelFunction = Callable[[list[ModelMessage], AgentInfo], ModelResponse]


def make_binding(
    function: ModelFunction,
    label: str,
    price: float | None = None,
    provider: ProveedorId = "ollama",
) -> ModelBinding:
    def cost(tokens_in: int, tokens_out: int) -> float | None:
        return None if price is None else round((tokens_in + tokens_out) * price, 6)

    return ModelBinding(
        model=FunctionModel(function, model_name=label),
        provider=provider,
        label=label,
        settings=ModelSettings(temperature=0),
        cost_usd=cost,
    )


@dataclass
class ScriptedModel:
    """Answers each model request with the next scripted output, or raises it if it is an error."""

    steps: list[Step]
    prompts: list[str] = field(default_factory=list)
    calls: int = 0

    def __call__(self, messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        for part in messages[-1].parts:
            if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                self.prompts.append(part.content)
        step = self.steps[min(self.calls, len(self.steps) - 1)]
        self.calls += 1
        if isinstance(step, BaseException):
            raise step
        args = step(messages) if callable(step) else step
        return ModelResponse(parts=[ToolCallPart(tool_name=info.output_tools[0].name, args=args)])

    def binding(self, label: str = "test:scripted", price: float | None = None) -> ModelBinding:
        return make_binding(self, label, price)


def scripted(*steps: Step) -> ScriptedModel:
    return ScriptedModel(list(steps))


ROLE_BY_OUTPUT_FIELD = {
    "historias": "analista",
    "criterios": "qa",
    "aprobado": "revisor",
    "puntajes": "evaluador",
}


@dataclass
class ScriptedTeam:
    """One model for every agent; it recognizes the caller by the output schema it asks for."""

    scripts: dict[str, list[Step]]
    prompts: dict[str, list[str]] = field(default_factory=dict)
    calls: dict[str, int] = field(default_factory=dict)

    def __call__(self, messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        properties = info.output_tools[0].parameters_json_schema.get("properties", {})
        role = next(
            ROLE_BY_OUTPUT_FIELD[name] for name in properties if name in ROLE_BY_OUTPUT_FIELD
        )
        for part in messages[-1].parts:
            if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                self.prompts.setdefault(role, []).append(part.content)
        script = self.scripts[role]
        index = self.calls.get(role, 0)
        self.calls[role] = index + 1
        step = script[min(index, len(script) - 1)]
        if isinstance(step, BaseException):
            raise step
        args = step(messages) if callable(step) else step
        return ModelResponse(parts=[ToolCallPart(tool_name=info.output_tools[0].name, args=args)])

    def binding(self, label: str = "test:team", price: float | None = None) -> ModelBinding:
        return make_binding(self, label, price)


def team(**scripts: list[Step]) -> ScriptedTeam:
    return ScriptedTeam(scripts)


@dataclass(frozen=True)
class BrokenRunner:
    """A runner that fails with an error no agent wrapper would catch, like a bug in a node."""

    error: BaseException
    proveedor: ProveedorId = "ollama"
    modelo: str = "broken"

    async def run(self, entrada: object) -> AgentResult[Any]:
        raise self.error


def with_broken(agents: AgentSet, broken: dict[str, BaseException]) -> AgentSet:
    runners = {
        rol: BrokenRunner(error, getattr(agents, rol).proveedor, getattr(agents, rol).modelo)
        for rol, error in broken.items()
    }
    return replace(agents, **runners)  # type: ignore[arg-type]
