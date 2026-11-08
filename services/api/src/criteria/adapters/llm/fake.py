"""Deterministic models for end-to-end tests (MODEL_BACKEND=fake, only with APP_ENV=test).

They answer through the real agents, prompts, validators and graph, so the web sees the same
events as with a provider, but nothing leaves the process. A key containing "nosaldo" behaves
like an account without balance, so the "Usar el gratuito" flow can be exercised. A requirement
that mentions "muchas historias" gets the most stories, so long lists and pagination show up.
"""

import asyncio
import json
import re
from collections.abc import Callable
from typing import Any

from pydantic import SecretStr
from pydantic_ai import ModelHTTPError, ModelMessage, ModelResponse, ToolCallPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from criteria.adapters.agents.factory import AgentBindings, AgentFactory
from criteria.adapters.agents.runner import ModelBinding
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.domain.artifacts import CRITERIOS, MAX_HISTORIAS
from criteria.domain.events import ProveedorId
from criteria.domain.run_config import AgentSelections, ProviderSelection
from criteria.ports.agents import AgentSet
from criteria.ports.keys import KeyCheck

NO_BALANCE_MARKER = "nosaldo"
MANY_STORIES_MARKER = "muchas historias"
CORRECTION_CASE = "CP-90"
ROLE_BY_OUTPUT_FIELD = {
    "historias": "analista",
    "criterios": "qa",
    "aprobado": "revisor",
    "puntajes": "evaluador",
}
_REQUIREMENT = re.compile(r"<requerimiento>\n(.*?)\n</requerimiento>", re.S)


def _prompt(messages: list[ModelMessage]) -> str:
    for part in messages[-1].parts:
        if isinstance(part, UserPromptPart) and isinstance(part.content, str):
            return part.content
    return ""


def _requirement(prompt: str) -> str:
    match = _REQUIREMENT.search(prompt)
    return str(json.loads(match.group(1))) if match else "el sistema"


def _subject(prompt: str) -> str:
    words = re.sub(r"[^\w\s]", "", _requirement(prompt)).split()
    return " ".join(words[:6]).lower() or "el sistema"


def _historia(n: int, quiero: str, prioridad: str = "alta") -> dict[str, Any]:
    return {
        "id": f"HU-{n}",
        "como": "persona usuaria del sistema",
        "quiero": quiero,
        "para": "cumplir el requerimiento sin pasos manuales",
        "prioridad": prioridad,
        "supuestos": ["La persona ya inició sesión"],
    }


def _historias(prompt: str) -> dict[str, Any]:
    subject = _subject(prompt)
    if "otra versión" in prompt:
        return {
            "historias": [
                _historia(1, f"resolver en un solo paso: {subject}"),
                _historia(2, "consultar el estado de mi solicitud", "media"),
            ]
        }
    if MANY_STORIES_MARKER in _requirement(prompt).lower():
        return {
            "historias": [
                _historia(n, f"completar el paso {n} de {subject}", "media")
                for n in range(1, MAX_HISTORIAS + 1)
            ]
        }
    return {
        "historias": [
            _historia(1, f"registrar una solicitud para {subject}"),
            _historia(2, "consultar el estado de mi solicitud", "media"),
            _historia(3, "recibir un aviso cuando cambie el estado", "baja"),
        ]
    }


def _ids(prompt: str, prefix: str) -> list[str]:
    return sorted(set(re.findall(rf'"({prefix}-\d+)"', prompt)), key=lambda i: int(i.split("-")[1]))


def _caso(n: int, historia_id: str, titulo: str) -> dict[str, Any]:
    return {
        "id": f"CP-{n:02d}",
        "historia_id": historia_id,
        "titulo": titulo,
        "pasos": ["Abrir la pantalla principal", "Completar los datos", "Confirmar"],
        "resultado_esperado": "El sistema confirma la operación",
        "gherkin": {
            "escenario": titulo,
            "dado": ["una persona con sesión iniciada"],
            "cuando": ["completa los datos y confirma"],
            "entonces": ["el sistema confirma la operación"],
        },
    }


def _entrega(prompt: str) -> dict[str, Any]:
    historias = _ids(prompt.split("<entrega_previa>", maxsplit=1)[0], "HU") or ["HU-1"]
    criterios = [
        {"id": f"CA-{i}", "historia_id": hid, "texto": "La operación queda registrada"}
        for i, hid in enumerate(historias, start=1)
    ]
    casos = [_caso(i, hid, f"Caso principal de {hid}") for i, hid in enumerate(historias, 1)]
    if "<entrega_previa>" in prompt:
        casos.append(
            _caso(90, historias[0], "Datos incompletos")
            | {"resultado_esperado": "El sistema indica qué dato falta"}
        )
    return {"criterios": criterios, "casos": casos}


def _veredicto(prompt: str) -> dict[str, Any]:
    if f'"{CORRECTION_CASE}"' in prompt:
        return {"aprobado": True, "observaciones": []}
    return {
        "aprobado": False,
        "observaciones": [
            {
                "tipo": "faltante",
                "destino": "qa",
                "referencias": ["HU-1"],
                "descripcion": "No hay un caso para datos incompletos",
                "sugerencia": "Agregar un caso que deje un dato vacío",
            }
        ],
    }


def _evaluacion() -> dict[str, Any]:
    valores = dict(zip(CRITERIOS, (4, 4, 3, 5), strict=True))
    return {
        "puntajes": [
            {"criterio": c, "valor": v, "justificacion": "Calificación simulada"}
            for c, v in valores.items()
        ]
    }


ANSWERS: dict[str, Callable[[str], dict[str, Any]]] = {
    "analista": _historias,
    "qa": _entrega,
    "revisor": _veredicto,
    "evaluador": lambda _prompt: _evaluacion(),
}


def fake_function(
    delay_seconds: float, failing: bool, provider: ProveedorId
) -> Callable[[list[ModelMessage], AgentInfo], Any]:
    async def answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        await asyncio.sleep(delay_seconds)
        if failing:
            raise ModelHTTPError(402, f"fake-{provider}")
        properties = info.output_tools[0].parameters_json_schema.get("properties", {})
        role = next(ROLE_BY_OUTPUT_FIELD[n] for n in properties if n in ROLE_BY_OUTPUT_FIELD)
        args = ANSWERS[role](_prompt(messages))
        return ModelResponse(parts=[ToolCallPart(tool_name=info.output_tools[0].name, args=args)])

    return answer


def _no_balance(selection: ProviderSelection) -> bool:
    key = selection.api_key
    return key is not None and NO_BALANCE_MARKER in key.get_secret_value()


def fake_agent_builder(
    registry: ProviderRegistry, factory: AgentFactory, delay_seconds: float
) -> Callable[[AgentSelections], AgentSet]:
    def binding(selection: ProviderSelection) -> ModelBinding:
        resolved = registry.validate(selection)
        function = fake_function(delay_seconds, _no_balance(selection), resolved.proveedor)
        return ModelBinding(
            model=FunctionModel(function=function, model_name=resolved.etiqueta),
            provider=resolved.proveedor,
            label=resolved.etiqueta,
            settings=registry.model_settings(resolved),
            cost_usd=lambda tokens_in, tokens_out: registry.cost_usd(
                resolved, tokens_in, tokens_out
            ),
        )

    def build(selections: AgentSelections) -> AgentSet:
        return factory.build_for(
            AgentBindings(
                analista=binding(selections.analista),
                qa=binding(selections.qa),
                revisor=binding(selections.revisor),
                evaluador=binding(selections.evaluador),
            )
        )

    return build


class FakeKeyValidator:
    """Accepts any key except those containing "bad" (rejected) or "down" (unverifiable)."""

    async def validate(
        self, proveedor: ProveedorId, api_key: SecretStr, base_url: str | None = None
    ) -> KeyCheck:
        key = api_key.get_secret_value()
        if "bad" in key:
            return KeyCheck(estado="invalida", last4=key[-4:])
        if "down" in key:
            return KeyCheck(estado="no_verificable", last4=key[-4:])
        return KeyCheck(estado="valida", last4=key[-4:])
