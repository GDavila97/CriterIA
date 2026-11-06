import logging
from collections.abc import Callable
from dataclasses import dataclass

from pydantic_ai import (
    Agent,
    ModelAPIError,
    ModelAuthenticationError,
    ModelHTTPError,
    ModelQuotaExceededError,
    ModelRateLimitError,
    UnexpectedModelBehavior,
)
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings

from criteria.adapters.llm.ssrf import EndpointNotAllowedError, ResponseTooLargeError
from criteria.domain.events import CodigoError, ProveedorId, Uso
from criteria.domain.run_config import OutputMode
from criteria.ports.agents import AgentResult, AgentRunError
from criteria.ports.clock import Clock

logger = logging.getLogger(__name__)

HTTP_UNAUTHORIZED, HTTP_PAYMENT_REQUIRED, HTTP_FORBIDDEN, HTTP_TOO_MANY_REQUESTS = (
    401,
    402,
    403,
    429,
)
BLOCKED_ENDPOINT_ERRORS = (EndpointNotAllowedError, ResponseTooLargeError)

SAFE_MESSAGES: dict[CodigoError, str] = {
    "salida_invalida": "El agente no produjo una salida válida tras un reintento.",
    "clave_invalida": "El proveedor rechazó la clave de API.",
    "sin_saldo": "La cuenta del proveedor no tiene saldo o cuota disponible.",
    "limite_proveedor": "El proveedor alcanzó su límite de peticiones; intenta más tarde.",
    "destino_no_permitido": "El servidor del proveedor no está permitido.",
    "proveedor_no_disponible": "El proveedor no está disponible o tardó demasiado en responder.",
    "error_interno": "Ocurrió un error interno al ejecutar el agente.",
}


def _causes(error: BaseException) -> list[BaseException]:
    chain: list[BaseException] = []
    current: BaseException | None = error
    while current is not None and current not in chain:
        chain.append(current)
        current = current.__cause__ or current.__context__
    return chain


def _status(error: BaseException, *codes: int) -> bool:
    return isinstance(error, ModelHTTPError) and error.status_code in codes


def _bad_key(error: BaseException) -> bool:
    return isinstance(error, ModelAuthenticationError) or _status(
        error, HTTP_UNAUTHORIZED, HTTP_FORBIDDEN
    )


def _no_balance(error: BaseException) -> bool:
    return isinstance(error, ModelQuotaExceededError) or _status(error, HTTP_PAYMENT_REQUIRED)


def _rate_limited(error: BaseException) -> bool:
    return isinstance(error, ModelRateLimitError) or _status(error, HTTP_TOO_MANY_REQUESTS)


# Checked in order: the first rule matching any exception in the chain decides the code.
# Balance comes before rate limit because OpenAI reports an exhausted balance as a 429.
_RULES: tuple[tuple[CodigoError, Callable[[BaseException], bool]], ...] = (
    ("destino_no_permitido", lambda e: isinstance(e, BLOCKED_ENDPOINT_ERRORS)),
    ("salida_invalida", lambda e: isinstance(e, UnexpectedModelBehavior)),
    ("clave_invalida", _bad_key),
    ("sin_saldo", _no_balance),
    ("limite_proveedor", _rate_limited),
    ("proveedor_no_disponible", lambda e: isinstance(e, ModelAPIError | TimeoutError)),
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
    provider: ProveedorId
    label: str
    settings: ModelSettings
    cost_usd: Callable[[int, int], float | None]
    output_mode: OutputMode = "tool"


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

    @property
    def proveedor(self) -> ProveedorId:
        return self._binding.provider

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
