import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Coroutine, Mapping, Sequence
from contextlib import AsyncExitStack, suppress
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, cast
from uuid import UUID, uuid4

from criteria.application.credentials import CredentialService
from criteria.application.errors import (
    ConflictError,
    InvalidInputError,
    NotFoundError,
    VersionsExhaustedError,
)
from criteria.application.runs import EsperandoAprobacion, RunOutcome, RunService, Terminada
from criteria.domain.approval import MAX_OTRAS_VERSIONES, RespuestaHumana
from criteria.domain.artifacts import Requerimiento
from criteria.domain.events import (
    AgenteEntrega,
    CorridaFin,
    EventoBase,
    ProveedorId,
    evento_adapter,
    sumar_totales,
)
from criteria.domain.judge import elegir_juez
from criteria.domain.run_config import (
    MAX_RONDAS,
    MAX_TOKENS_MAXIMO,
    MAX_TOKENS_MINIMO,
    ROLES,
    TEMPERATURA_MAXIMA,
    AgentSelections,
    Nivel,
    ProviderSelection,
    RolAgente,
    SelectionError,
    parse_selection,
)
from criteria.ports.agents import AgentSet
from criteria.ports.checkpoint import Checkpointer
from criteria.ports.clock import Clock
from criteria.ports.errors import ErrorReporter
from criteria.ports.events import EventSink
from criteria.ports.models import KeyRequiredError, ModelRouter
from criteria.ports.stores import (
    HistoryStore,
    KeySource,
    ModelPlan,
    RunRecord,
    RunStore,
    SavedRun,
    SettingsStore,
    StreamBusyError,
    UsageGuard,
)

logger = logging.getLogger(__name__)

AgentBuilder = Callable[[AgentSelections], AgentSet]
Action = Callable[[EventSink], Coroutine[Any, Any, RunOutcome]]
INTERNAL_ERROR_MESSAGE = "La corrida se detuvo por un error interno. Intenta de nuevo."


@dataclass(frozen=True)
class RunDefaults:
    provider: ProveedorId
    max_rounds: int
    abandoned_after: timedelta
    heartbeat_seconds: float
    temperature: float = 0.2
    max_tokens: int = 4096


@dataclass(frozen=True)
class AgentParams:
    """What a person tuned for one agent; anything left empty takes the run's default."""

    nivel: Nivel | None = None
    modelo: str | None = None
    temperatura: float | None = None
    max_tokens: int | None = None


@dataclass(frozen=True)
class RunRequest:
    requerimiento: str
    proveedor: ProveedorId | None = None
    nivel: Nivel | None = None
    modelo: str | None = None
    juez: ProveedorId | None = None
    max_rondas: int | None = None
    agentes: Mapping[RolAgente, AgentParams] = field(default_factory=dict)
    guardar_historial: bool | None = None


@dataclass(frozen=True)
class RunCreated:
    run_id: UUID
    generacion: ModelPlan
    juez: ModelPlan
    juez_mismo_proveedor: bool
    costo_estimado_usd: float | None
    costo_servidor_usd: float
    agentes: Mapping[RolAgente, ModelPlan]
    max_rondas: int
    guardar_historial: bool


@dataclass(frozen=True)
class _PlanBase:
    """The provider, tier and model an agent gets before its own tuning."""

    provider: ProveedorId
    tier: Nivel
    model: str | None


class StoreEventSink(EventSink):
    """Persists each event before handing it to the open stream, so a reconnect can replay it."""

    def __init__(
        self,
        run_id: UUID,
        clock: Clock,
        last_seq: int,
        store: RunStore,
        queue: asyncio.Queue[EventoBase],
    ) -> None:
        super().__init__(run_id, clock, last_seq)
        self._store = store
        self._queue = queue

    async def deliver(self, event: EventoBase) -> None:
        payload = event.model_dump(mode="json")
        await self._store.append_event(self.run_id, event.seq, payload["type"], payload)
        if payload["type"] == "en_espera_humano":
            # Before the client sees the event, so an immediate approval is never refused.
            await self._store.set_status(self.run_id, "esperando_aprobacion")
            await self._store.set_approval(self.run_id, None)
        await self._queue.put(event)


def _server_cost(events: Sequence[EventoBase], record: RunRecord) -> float | None:
    """Real cost of the calls paid with server keys; null if any of them had no price."""
    total = 0.0
    for event in events:
        uso = getattr(event, "uso", None)
        if uso is None or getattr(event, "type", "") != "agente_entrega":
            continue
        if record.plan_for(cast(RolAgente, event.agent)).clave != "servidor":
            continue
        if uso.costo_usd is None:
            return None
        total += uso.costo_usd
    return round(total, 6)


def _saved_run(record: RunRecord, events: Sequence[EventoBase]) -> SavedRun | None:
    dumped = [event.model_dump(mode="json") for event in events]
    start = next((e for e in dumped if e["type"] == "corrida_inicia"), None)
    end = next((e for e in reversed(dumped) if e["type"] == "corrida_fin"), None)
    if start is None or end is None:
        return None
    artifacts: dict[str, Any] = {}
    for event in dumped:
        if event["type"] == "agente_entrega":
            entrega = event["artefactos"]
            artifacts[entrega["tipo"]] = {k: v for k, v in entrega.items() if k != "tipo"}
    return SavedRun(
        id=record.id,
        status=end["estado"],
        requirement=record.requirement,
        artifacts=artifacts,
        scores=end["puntajes"],
        provider=record.generation.proveedor,
        model=record.generation.modelo,
        judge_model=start["modelos"]["juez"],
        prompt_version=start["version_prompts"],
        judge_version=start["version_juez"],
        experimental=start["experimental"],
        totals=end["totales"],
        created_at=record.created_at,
    )


class RunApplication:
    def __init__(  # noqa: PLR0913  composition point of the run use cases
        self,
        *,
        runs: RunStore,
        usage: UsageGuard,
        credentials: CredentialService,
        settings: SettingsStore,
        history: HistoryStore,
        router: ModelRouter,
        build_agents: AgentBuilder,
        service: RunService,
        checkpointer: Checkpointer,
        clock: Clock,
        defaults: RunDefaults,
        reporter: ErrorReporter,
    ) -> None:
        self._runs = runs
        self._usage = usage
        self._credentials = credentials
        self._settings = settings
        self._history = history
        self._router = router
        self._build_agents = build_agents
        self._service = service
        self._checkpointer = checkpointer
        self._clock = clock
        self._defaults = defaults
        self._reporter = reporter

    async def create(self, user_id: str, request: RunRequest) -> RunCreated:
        try:
            requerimiento = Requerimiento(texto=request.requerimiento)
        except ValueError:
            raise InvalidInputError(
                "the requirement needs 20 to 2,000 characters without control characters"
            ) from None
        max_rounds = self._defaults.max_rounds if request.max_rondas is None else request.max_rondas
        if not 0 <= max_rounds <= MAX_RONDAS:
            raise InvalidInputError(f"max_rondas must be between 0 and {MAX_RONDAS}")
        preferences = await self._settings.get(user_id)
        user_keys = await self._credentials.providers(user_id)
        provider = request.proveedor or preferences.default_provider or self._defaults.provider
        tier = request.nivel or (
            preferences.default_tier if provider == preferences.default_provider else None
        )
        judge_provider = (
            request.juez or preferences.judge_provider or self._judge_for(user_keys, provider)
        )
        plans: dict[RolAgente, ModelPlan] = {}
        costs: dict[RolAgente, float | None] = {}
        for rol in ROLES:
            judging = rol == "evaluador"
            base = (
                _PlanBase(judge_provider, "economico", None)
                if judging
                else _PlanBase(provider, tier or "economico", request.modelo)
            )
            plan, selection = await self._plan(
                user_id, user_keys, base, request.agentes.get(rol, AgentParams())
            )
            plans[rol], costs[rol] = plan, self._router.estimate_agent(rol, selection)
        known = [cost for cost in costs.values() if cost is not None]
        estimate = round(sum(known), 6) if len(known) == len(costs) else None
        server_cost = round(
            sum(cost or 0.0 for rol, cost in costs.items() if plans[rol].clave == "servidor"), 6
        )
        now = self._clock.now()
        await self.cleanup()
        await self._usage.reserve(
            user_id,
            now,
            uses_server_key=any(plan.clave == "servidor" for plan in plans.values()),
            server_cost_usd=server_cost,
        )
        save_history = (
            preferences.save_history
            if request.guardar_historial is None
            else request.guardar_historial
        )
        record = RunRecord(
            id=uuid4(),
            user_id=user_id,
            status="creada",
            requirement=requerimiento.texto,
            generation=plans["analista"],
            judge=plans["evaluador"],
            max_rounds=max_rounds,
            server_cost_reserved_usd=server_cost,
            estimated_cost_usd=estimate,
            created_at=now,
            agent_plans=plans,
            save_history=save_history,
        )
        await self._runs.create(record)
        return RunCreated(
            run_id=record.id,
            generacion=record.generation,
            juez=record.judge,
            juez_mismo_proveedor=judge_provider == provider,
            costo_estimado_usd=estimate,
            costo_servidor_usd=server_cost,
            agentes=plans,
            max_rondas=max_rounds,
            guardar_historial=save_history,
        )

    async def approve(self, user_id: str, run_id: UUID, respuesta: RespuestaHumana) -> None:
        record = await self._runs.get(run_id, user_id)
        if record is None:
            raise NotFoundError("run not found")
        if record.status != "esperando_aprobacion":
            raise ConflictError("the run is not waiting for an approval")
        if respuesta.decision == "otra_version":
            await self._book_another_version(record)
        if not await self._runs.set_approval(run_id, respuesta.model_dump(mode="json")):
            raise ConflictError("the run is not waiting for an approval")

    async def _book_another_version(self, record: RunRecord) -> None:
        events = await self._runs.events_after(record.id, 0)
        asked = sum(
            1 for e in events if e["type"] == "humano_responde" and e["decision"] == "otra_version"
        )
        if asked >= MAX_OTRAS_VERSIONES:
            raise VersionsExhaustedError("no more versions can be requested for this run")
        plan = record.plan_for("analista")
        # openai_compatible never runs on a server key, so only priced catalog models reach here.
        if plan.clave != "servidor":
            return
        # The extra Analista call does not cost another run, but its dollars count.
        selection = ProviderSelection(
            proveedor=plan.proveedor,
            modelo=plan.modelo,
            temperatura=plan.temperatura,
            max_tokens=plan.max_tokens,
        )
        cost = self._router.estimate_agent("analista", selection)
        if cost:
            await self._usage.reserve_extra(
                record.id, record.user_id, record.created_at.date(), cost
            )

    async def open_stream(
        self, user_id: str, run_id: UUID, last_event_id: int
    ) -> AsyncIterator[EventoBase | None]:
        """Takes the stream lock and prepares the run; yields events and None as a heartbeat."""
        record = await self._runs.get(run_id, user_id)
        if record is None:
            raise NotFoundError("run not found")
        stack = AsyncExitStack()
        await stack.enter_async_context(self._runs.stream_lock(run_id))
        try:
            replay = [
                evento_adapter.validate_python(payload)
                for payload in await self._runs.events_after(run_id, last_event_id)
            ]
            action = await self._action(record)
        except BaseException:
            await stack.aclose()
            raise
        return self._events(stack, record, replay, action)

    async def cleanup(self) -> int:
        """Opportunistic: runs nobody touched for a while fail and give back the unused quota."""
        cutoff = self._clock.now() - self._defaults.abandoned_after
        cleaned = 0
        for record in await self._runs.stale(cutoff):
            try:
                async with self._runs.stream_lock(record.id):
                    # Checked again under the lock: a stream may have touched it in between.
                    if not await self._runs.fail_if_stale(record.id, cutoff):
                        continue
                    await self._settle(record, await self._stored_events(record.id))
                    await self._checkpointer.discard(record.id)
                    await self._runs.delete(record.id)
                    cleaned += 1
            except StreamBusyError:
                continue
        cleaned += await self._checkpointer.discard_orphans()
        if cleaned:
            logger.info("abandoned runs cleaned", extra={"runs": cleaned})
        return cleaned

    def _judge_for(self, user_keys: set[ProveedorId], generation: ProveedorId) -> ProveedorId:
        candidates = [
            p for p in self._router.available(user_keys) if self._router.has_tier(p, "economico")
        ]
        return elegir_juez(candidates, generation).proveedor

    async def _plan(
        self, user_id: str, user_keys: set[ProveedorId], base: _PlanBase, params: AgentParams
    ) -> tuple[ModelPlan, ProviderSelection]:
        provider, tier, model = base.provider, base.tier, base.model
        source: KeySource
        if provider in user_keys:
            source = "usuario"
        elif self._router.server_access(provider):
            source = "servidor"
        else:
            raise KeyRequiredError(f"{provider} needs the user's own API key")
        temperature = (
            self._defaults.temperature if params.temperatura is None else params.temperatura
        )
        max_tokens = self._defaults.max_tokens if params.max_tokens is None else params.max_tokens
        if not 0 <= temperature <= TEMPERATURA_MAXIMA:
            raise InvalidInputError(f"temperatura must be between 0 and {TEMPERATURA_MAXIMA}")
        if not MAX_TOKENS_MINIMO <= max_tokens <= MAX_TOKENS_MAXIMO:
            raise InvalidInputError(
                f"max_tokens must be between {MAX_TOKENS_MINIMO} and {MAX_TOKENS_MAXIMO}"
            )
        # The agent's own model or tier wins over the run's.
        if params.modelo or params.nivel:
            model, tier = params.modelo, params.nivel or tier
        selection = await self._selection(
            user_id,
            ModelPlan(
                proveedor=provider,
                modelo=model or "",
                temperatura=temperature,
                max_tokens=max_tokens,
                clave=source,
            ),
            tier=None if model else tier,
        )
        selection = self._router.validate(selection)
        plan = ModelPlan(
            proveedor=provider,
            modelo=selection.modelo or "",
            temperatura=selection.temperatura,
            max_tokens=selection.max_tokens,
            clave=source,
        )
        return plan, selection

    async def _selection(
        self, user_id: str, plan: ModelPlan, tier: Nivel | None = None
    ) -> ProviderSelection:
        data: dict[str, object] = {
            "proveedor": plan.proveedor,
            "modelo": plan.modelo or None,
            "nivel": tier,
            "temperatura": plan.temperatura,
            "max_tokens": plan.max_tokens,
        }
        if plan.clave == "usuario":
            resolved = await self._credentials.resolve(user_id, plan.proveedor)
            if resolved is None:
                raise KeyRequiredError(f"the {plan.proveedor} key is no longer available")
            data["api_key"] = resolved.api_key.get_secret_value()
            if plan.proveedor == "openai_compatible":
                data["base_url"] = resolved.base_url
        try:
            return parse_selection(data)
        except SelectionError as error:
            raise InvalidInputError(f"invalid model selection: {error}") from None

    async def _action(self, record: RunRecord) -> Action | None:
        if record.status == "esperando_aprobacion" and record.approval is None:
            return None
        last = await self._runs.events_after(record.id, await self._runs.last_seq(record.id) - 1)
        if last and last[-1]["type"] == "corrida_fin":
            # The instance stopped after the end: only the closing work is left, never a rerun.
            ended = Terminada(estado=last[-1]["estado"], puntajes=[])

            async def closed(_sink: EventSink) -> RunOutcome:
                return ended

            return closed
        selections = {
            rol: await self._selection(record.user_id, record.plan_for(rol)) for rol in ROLES
        }
        agents = self._build_agents(AgentSelections(**selections))
        requerimiento = Requerimiento(texto=record.requirement)
        service = self._service
        if record.status == "creada":
            await self._runs.set_status(record.id, "en_curso")
            return lambda sink: service.iniciar(
                requerimiento=requerimiento,
                agents=agents,
                events=sink,
                max_rondas=record.max_rounds,
            )
        if record.status == "en_curso":
            return lambda sink: service.continuar(
                requerimiento=requerimiento,
                agents=agents,
                events=sink,
                max_rondas=record.max_rounds,
            )
        respuesta = RespuestaHumana.model_validate(record.approval)
        await self._runs.set_status(record.id, "en_curso")
        return lambda sink: service.reanudar(respuesta=respuesta, agents=agents, events=sink)

    async def _events(
        self,
        stack: AsyncExitStack,
        record: RunRecord,
        replay: Sequence[EventoBase],
        action: Action | None,
    ) -> AsyncIterator[EventoBase | None]:
        async with stack:
            for event in replay:
                yield event
            if action is None:
                return
            queue: asyncio.Queue[EventoBase] = asyncio.Queue()
            sink = StoreEventSink(
                record.id, self._clock, await self._runs.last_seq(record.id), self._runs, queue
            )
            task: asyncio.Task[RunOutcome] = asyncio.create_task(action(sink))
            try:
                while not (task.done() and queue.empty()):
                    getter = asyncio.ensure_future(queue.get())
                    done, _ = await asyncio.wait(
                        {getter, task},
                        timeout=self._defaults.heartbeat_seconds,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if getter in done:
                        yield getter.result()
                        continue
                    getter.cancel()
                    if not done:
                        yield None
                failure = task.exception()
                if failure is None:
                    await self._finish(record, task.result())
                elif isinstance(failure, Exception):
                    await self._fail(record, sink, failure)
                    while not queue.empty():
                        yield queue.get_nowait()
                else:
                    raise failure
            finally:
                if not task.done():
                    # The client left: the run stays at its last checkpoint for the next stream.
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task

    async def _finish(self, record: RunRecord, outcome: RunOutcome) -> None:
        if isinstance(outcome, EsperandoAprobacion):
            return
        assert isinstance(outcome, Terminada)  # noqa: S101  RunOutcome has two variants
        await self._close(record)
        logger.info("run finished", extra={"run_id": str(record.id), "estado": outcome.estado})

    async def _fail(self, record: RunRecord, sink: EventSink, error: Exception) -> None:
        """An unexpected failure ends the run like an agent error, without exposing details."""
        self._reporter.report(error, record.id)
        logger.error("run failed", extra={"run_id": str(record.id), "error": type(error).__name__})
        events = await self._stored_events(record.id)
        await sink.emit(
            CorridaFin,
            agent="sistema",
            estado="error",
            puntajes=[],
            totales=sumar_totales([e.uso for e in events if isinstance(e, AgenteEntrega)]),
            codigo="error_interno",
            mensaje=INTERNAL_ERROR_MESSAGE,
        )
        # Only after corrida_fin is stored: until then the next stream can still recover the run.
        await self._runs.set_status(record.id, "fallida")
        await self._close(record)

    async def _stored_events(self, run_id: UUID) -> list[EventoBase]:
        return [
            evento_adapter.validate_python(payload)
            for payload in await self._runs.events_after(run_id, 0)
        ]

    async def _settle(self, record: RunRecord, events: Sequence[EventoBase]) -> None:
        await self._usage.settle(
            record.id,
            record.user_id,
            record.created_at.date(),
            record.server_cost_reserved_usd,
            _server_cost(events, record),
        )

    async def _close(self, record: RunRecord) -> None:
        events = await self._stored_events(record.id)
        await self._settle(record, events)
        if record.save_history:
            saved = _saved_run(record, events)
            if saved is not None:
                await self._history.save(record.user_id, saved)
        await self._checkpointer.discard(record.id)
        await self._runs.delete(record.id)
