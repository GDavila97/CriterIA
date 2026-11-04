import logging
from collections.abc import Callable
from dataclasses import dataclass

from pydantic_ai import (
    Agent,
    ModelAPIError,
    ModelHTTPError,
    ModelQuotaExceededError,
    ModelRateLimitError,
    ModelTimeoutError,
    UnexpectedModelBehavior,
)
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings

from criteria.adapters.llm.ssrf import EndpointNotAllowedError, ResponseTooLargeError
from criteria.domain.events import CodigoError, Uso
from criteria.ports.agents import AgentResult, AgentRunError
from criteria.ports.clock import Clock

logger = logging.getLogger(__name__)

HTTP_TOO_MANY_REQUESTS = 429
BLOCKED_ENDPOINT_ERRORS = (EndpointNotAllowedError, ResponseTooLargeError)

SAFE_MESSAGES: dict[CodigoError, str] = {
    "salida_invalida": "El agente no produjo una salida válida tras un reintento.",
    "destino_no_permitido": "El servidor del proveedor no está permitido.",
    "cuota_agotada": "El proveedor rechazó la petición por cuota o límite de uso.",
    "tiempo_agotado": "El proveedor tardó demasiado en responder.",
    "proveedor_no_disponible": "El proveedor no está disponible en este momento.",
    "error_interno": "Ocurrió un error interno al ejecutar el agente.",
}


def _causes(error: BaseException) -> list[BaseException]:
    chain: list[BaseException] = []
    current: BaseException | None = error
    while current is not None and current not in chain:
        chain.append(current)
        current = current.__cause__ or current.__context__
    return chain


def _is_rate_limited(error: BaseException) -> bool:
    if isinstance(error, ModelQuotaExceededError | ModelRateLimitError):
        return True
    return isinstance(error, ModelHTTPError) and error.status_code == HTTP_TOO_MANY_REQUESTS


# Checked in order: the first rule matching any exception in the chain decides the code.
_RULES: tuple[tuple[CodigoError, Callable[[BaseException], bool]], ...] = (
    (
        "destino_no_permitido",
        lambda e: isinstance(e, EndpointNotAllowedError | ResponseTooLargeError),
    ),
    ("salida_invalida", lambda e: isinstance(e, UnexpectedModelBehavior)),
    ("cuota_agotada", _is_rate_limited),
    ("tiempo_agotado", lambda e: isinstance(e, ModelTimeoutError | TimeoutError)),
    ("proveedor_no_disponible", lambda e: isinstance(e, ModelAPIError)),
)


def classify_error(error: BaseException) -> CodigoError:
    chain = _causes(error)
    for codigo, matches in _RULES:
        if any(matches(e) for e in chain):
            return codigo
    return "error_interno"


@dataclass(frozen=True)
class ModelBinding:
    model: Model
    label: str
    settings: ModelSettings
    cost_usd: Callable[[int, int], float | None]


class PydanticAgentRunner[Entrada, Salida]:
    def __init__(
        self,
        *,
        rol: str,
        agent: Agent[Entrada, Salida],
        binding: ModelBinding,
        render: Callable[[Entrada], str],
        clock: Clock,
    ) -> None:
        self._rol = rol
        self._agent = agent
        self._binding = binding
        self._render = render
        self._clock = clock

    @property
    def modelo(self) -> str:
        return self._binding.label

    async def run(self, entrada: Entrada) -> AgentResult[Salida]:
        started = self._clock.monotonic()
        failure: CodigoError | None = None
        try:
            result = await self._agent.run(
                self._render(entrada),
                deps=entrada,
                model=self._binding.model,
                model_settings=self._binding.settings,
            )
        except Exception as error:
            failure = classify_error(error)
            # Only the type name is logged: provider messages may echo prompts or credentials.
            logger.warning("agent %s failed: %s (%s)", self._rol, failure, type(error).__name__)
        latencia_ms = round((self._clock.monotonic() - started) * 1000)
        if failure is not None:
            uso = Uso(tokens_entrada=0, tokens_salida=0, latencia_ms=latencia_ms)
            raise AgentRunError(failure, SAFE_MESSAGES[failure], uso)
        usage = result.usage
        return AgentResult(
            salida=result.output,
            uso=Uso(
                tokens_entrada=usage.input_tokens,
                tokens_salida=usage.output_tokens,
                latencia_ms=latencia_ms,
                costo_usd=self._binding.cost_usd(usage.input_tokens, usage.output_tokens),
                reintentos=max(usage.requests - 1, 0),
            ),
        )
