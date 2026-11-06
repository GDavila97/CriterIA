import asyncio
import os
from dataclasses import dataclass, field, replace
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models.function import AgentInfo, FunctionModel

from criteria.adapters.agents.factory import AgentFactory
from criteria.adapters.crypto.aesgcm import AesGcmCipher
from criteria.adapters.llm.catalog import ModelCatalog
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.adapters.memory.checkpointer import MemoryCheckpointer
from criteria.application.credentials import CredentialService
from criteria.application.errors import ConflictError, InvalidInputError, NotFoundError
from criteria.application.run_api import (
    RunApplication,
    RunDefaults,
    RunRequest,
    _saved_run,
    _server_cost,
)
from criteria.application.runs import RunService
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.approval import RespuestaHumana
from criteria.domain.events import EventoBase, evento_adapter
from criteria.domain.run_config import ProviderSelection
from criteria.ports.agents import AgentSet
from criteria.ports.models import KeyRequiredError, ProviderNotAllowedError
from criteria.ports.stores import (
    LimitExceededError,
    ModelPlan,
    RunRecord,
    StreamBusyError,
    UserSettings,
)
from tests import factories as f
from tests.agent_models import ScriptedTeam, make_binding, team
from tests.application.memory_stores import (
    MemoryCredentials,
    MemoryHistory,
    MemoryRuns,
    MemorySettings,
    MemoryUsage,
)
from tests.fakes import FakeClock, FakeKeyValidator

CATALOG = ModelCatalog.load(SERVICE_ROOT / "config" / "models.toml")
USER = "user-1"


def happy() -> ScriptedTeam:
    return team(
        analista=[f.historias(1)],
        qa=[f.entrega_qa(1)],
        revisor=[f.veredicto()],
        evaluador=[f.evaluacion(4)],
    )


@dataclass
class Harness:
    app: RunApplication
    runs: MemoryRuns
    usage: MemoryUsage
    settings: MemorySettings
    history: MemoryHistory
    credentials: CredentialService
    clock: FakeClock
    team: ScriptedTeam = field(default_factory=happy)
    built: list[tuple[ProviderSelection, ProviderSelection]] = field(default_factory=list)
    model: FunctionModel | None = None

    async def collect(self, run_id: UUID, last: int = 0) -> list[EventoBase]:
        stream = await self.app.open_stream(USER, run_id, last)
        return [event async for event in stream if event is not None]


def harness(**settings: Any) -> Harness:
    clock = FakeClock()
    registry = ProviderRegistry(
        Settings.model_validate(
            {
                "app_env": "test",
                "server_key_providers": "groq",
                "groq_api_key": "server-groq-key",
                **settings,
            }
        ),
        CATALOG,
    )
    credentials = CredentialService(
        store=MemoryCredentials(),
        cipher=AesGcmCipher({1: os.urandom(32)}, 1),
        validator=FakeKeyValidator(),
        clock=clock,
        checks_per_hour=10,
    )
    holder: list[Harness] = []

    def build(generation: ProviderSelection, judge: ProviderSelection) -> AgentSet:
        h = holder[0]
        h.built.append((generation, judge))
        factory = AgentFactory(SERVICE_ROOT / "prompts", "v1", "v1", clock)

        def bind(selection: ProviderSelection) -> Any:
            if h.model is not None:
                base = make_binding(h.model.function, selection.proveedor)  # type: ignore[arg-type]
            else:
                base = make_binding(h.team, selection.proveedor, provider=selection.proveedor)
            modelo = selection.modelo or ""
            return replace(
                base, cost_usd=lambda i, o: CATALOG.cost_usd(selection.proveedor, modelo, i, o)
            )

        return factory.build(bind(generation), bind(judge))

    runs, usage, user_settings, history = (
        MemoryRuns(),
        MemoryUsage(),
        MemorySettings(),
        MemoryHistory(),
    )
    checkpointer = MemoryCheckpointer()
    app = RunApplication(
        runs=runs,
        usage=usage,
        credentials=credentials,
        settings=user_settings,
        history=history,
        router=registry,
        build_agents=build,
        service=RunService(checkpointer),
        checkpointer=checkpointer,
        clock=clock,
        defaults=RunDefaults(
            provider="groq",
            max_rounds=2,
            abandoned_after=timedelta(minutes=60),
            heartbeat_seconds=0.01,
        ),
    )
    holder.append(Harness(app, runs, usage, user_settings, history, credentials, clock))
    return holder[0]


def request(**overrides: Any) -> RunRequest:
    return RunRequest(**{"requerimiento": f.REQUERIMIENTO, **overrides})


class TestCreate:
    async def test_server_runs_reserve_their_estimated_cost(self) -> None:
        h = harness()

        created = await h.app.create(USER, request())

        assert created.generacion.clave == created.juez.clave == "servidor"
        assert created.costo_estimado_usd == created.costo_servidor_usd > 0
        assert h.usage.reserved == [(USER, True, created.costo_servidor_usd)]
        assert h.runs.records[created.run_id].status == "creada"

    @pytest.mark.parametrize(
        "bad",
        [request(requerimiento="corto"), request(max_rondas=6), request(max_rondas=-1)],
    )
    async def test_invalid_requests_never_reserve(self, bad: RunRequest) -> None:
        h = harness()

        with pytest.raises(InvalidInputError):
            await h.app.create(USER, bad)

        assert h.usage.reserved == []

    async def test_limits_refusals_leave_no_run(self) -> None:
        h = harness()
        h.usage.refuse = LimitExceededError("limite_hora")

        with pytest.raises(LimitExceededError):
            await h.app.create(USER, request())

        assert h.runs.records == {}

    async def test_a_provider_without_access_needs_the_users_key(self) -> None:
        with pytest.raises(KeyRequiredError):
            await harness().app.create(USER, request(proveedor="anthropic"))

    async def test_user_keys_make_the_run_free_for_the_server(self) -> None:
        h = harness()
        await h.credentials.save(USER, "anthropic", SecretStr("sk-ant-user-0000"), None)

        created = await h.app.create(USER, request(proveedor="anthropic", juez="anthropic"))

        assert created.costo_servidor_usd == 0
        assert h.usage.reserved == [(USER, False, 0.0)]

    async def test_a_server_judge_is_charged_even_with_a_user_generator(self) -> None:
        h = harness()
        await h.credentials.save(USER, "anthropic", SecretStr("sk-ant-user-0000"), None)

        created = await h.app.create(USER, request(proveedor="anthropic", juez="groq"))

        assert created.juez.clave == "servidor"
        assert created.juez_mismo_proveedor is False
        assert 0 < created.costo_servidor_usd < (created.costo_estimado_usd or 0)

    async def test_preferences_pick_the_provider_tier_and_judge(self) -> None:
        h = harness()
        await h.credentials.save(USER, "openai", SecretStr("sk-user-openai-0000"), None)
        await h.settings.put(
            USER,
            UserSettings(default_provider="openai", default_tier="maximo", judge_provider="groq"),
        )

        created = await h.app.create(USER, request())

        assert created.generacion.modelo == "gpt-6-astra"
        assert created.juez.proveedor == "groq"

    async def test_an_explicit_model_wins_over_the_tier(self) -> None:
        created = await harness().app.create(
            USER, request(modelo="llama-3.3-70b-versatile", nivel="economico")
        )

        assert created.generacion.modelo == "llama-3.3-70b-versatile"

    async def test_unknown_models_are_refused(self) -> None:
        with pytest.raises(ProviderNotAllowedError):
            await harness().app.create(USER, request(modelo="unknown-model"))

    async def test_creating_a_run_cleans_abandoned_ones(self) -> None:
        h = harness()
        old = await h.app.create(USER, request())
        h.runs.touched[old.run_id] -= timedelta(hours=2)

        await h.app.create(USER, request())

        assert old.run_id not in h.runs.records


class TestStream:
    async def test_a_full_run_settles_and_cleans_up(self) -> None:
        h = harness()
        await h.settings.put(USER, UserSettings(save_history=True))
        run_id = (await h.app.create(USER, request())).run_id

        first = await h.collect(run_id)
        await h.app.approve(USER, run_id, RespuestaHumana(decision="aprobado"))
        second = await h.collect(run_id, first[-1].seq)

        assert first[-1].type == "en_espera_humano"  # type: ignore[attr-defined]
        assert second[-1].type == "corrida_fin"  # type: ignore[attr-defined]
        assert run_id not in h.runs.records
        [(_, _, reserved, actual)] = h.usage.settled
        assert actual is not None
        assert 0 < actual != reserved
        assert [r.id for r in h.history.runs[USER]] == [run_id]

    async def test_waiting_runs_only_replay_until_approved(self) -> None:
        h = harness()
        run_id = (await h.app.create(USER, request())).run_id
        first = await h.collect(run_id)

        again = await h.collect(run_id, 0)

        assert [e.seq for e in again] == [e.seq for e in first]
        assert h.team.calls["analista"] == 1

    async def test_streams_need_the_owner_and_a_free_lock(self) -> None:
        h = harness()
        run_id = (await h.app.create(USER, request())).run_id

        with pytest.raises(NotFoundError):
            await h.app.open_stream("intruder", run_id, 0)
        async with h.runs.stream_lock(run_id):
            with pytest.raises(StreamBusyError):
                await h.app.open_stream(USER, run_id, 0)

    async def test_a_failure_while_preparing_releases_the_lock(self) -> None:
        h = harness()
        await h.credentials.save(USER, "openai", SecretStr("sk-user-openai-0000"), None)
        run_id = (await h.app.create(USER, request(proveedor="openai", juez="openai"))).run_id
        await h.credentials.delete(USER, "openai")

        with pytest.raises(KeyRequiredError):
            await h.app.open_stream(USER, run_id, 0)

        assert h.runs.locked == set()

    async def test_slow_agents_produce_heartbeats(self) -> None:
        h = harness()

        async def slow(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
            await asyncio.sleep(0.05)
            return h.team(messages, info)

        h.model = FunctionModel(function=slow)
        run_id = (await h.app.create(USER, request())).run_id
        stream = await h.app.open_stream(USER, run_id, 0)

        items = [item async for item in stream]

        assert None in items
        assert items[-1] is not None

    async def test_leaving_mid_run_cancels_the_work_and_keeps_the_run(self) -> None:
        h = harness()
        run_id = (await h.app.create(USER, request())).run_id
        stream = await h.app.open_stream(USER, run_id, 0)

        async for event in stream:
            if event is not None and event.type == "agente_inicia":  # type: ignore[attr-defined]
                break
        await stream.aclose()  # type: ignore[attr-defined]

        assert h.runs.records[run_id].status == "en_curso"
        assert h.runs.locked == set()
        rest = await h.collect(run_id, h.runs.events[run_id][-1]["seq"])
        assert rest[-1].type == "en_espera_humano"  # type: ignore[attr-defined]


class TestApprove:
    async def test_approvals_need_a_waiting_run_of_the_owner(self) -> None:
        h = harness()
        run_id = (await h.app.create(USER, request())).run_id
        respuesta = RespuestaHumana(decision="aprobado")

        with pytest.raises(NotFoundError):
            await h.app.approve(USER, uuid4(), respuesta)
        with pytest.raises(ConflictError):
            await h.app.approve(USER, run_id, respuesta)

    async def test_a_second_approval_after_resuming_is_refused(self) -> None:
        h = harness()
        run_id = (await h.app.create(USER, request())).run_id
        await h.collect(run_id)
        await h.app.approve(USER, run_id, RespuestaHumana(decision="aprobado"))
        record = h.runs.records[run_id]
        h.runs.records[run_id] = replace(record, status="en_curso")

        with pytest.raises(ConflictError):
            await h.app.approve(USER, run_id, RespuestaHumana(decision="aprobado"))


def _events(*payloads: dict[str, Any]) -> list[EventoBase]:
    return [evento_adapter.validate_python(p) for p in payloads]


def _entrega(agent: str, cost: float | None) -> dict[str, Any]:
    return {
        "type": "agente_entrega",
        "run_id": str(uuid4()),
        "seq": 1,
        "ts": "2026-11-05T12:00:00Z",
        "agent": agent,
        "ronda": 1,
        "artefactos": {"tipo": "historias", "historias": [f.historia(1)]},
        "uso": {
            "tokens_entrada": 10,
            "tokens_salida": 10,
            "latencia_ms": 5,
            "costo_usd": cost,
        },
    }


SERVER = ModelPlan(proveedor="groq", modelo="m", temperatura=0.2, max_tokens=4096, clave="servidor")
OWN = replace(SERVER, clave="usuario")


class TestServerCost:
    def test_only_server_paid_calls_count(self) -> None:
        events = _events(_entrega("analista", 0.01), _entrega("evaluador", 0.02))

        assert _server_cost(events, SERVER, SERVER) == 0.03
        assert _server_cost(events, OWN, SERVER) == 0.02
        assert _server_cost(events, OWN, OWN) == 0.0

    def test_an_unpriced_server_call_makes_the_cost_unknown(self) -> None:
        events = _events(_entrega("analista", None))

        assert _server_cost(events, SERVER, SERVER) is None
        assert _server_cost(events, OWN, SERVER) == 0.0

    def test_runs_without_start_or_end_are_not_saved(self) -> None:
        events = _events(_entrega("analista", 0.01))

        assert _saved_run(_record(), events) is None


def _record() -> RunRecord:
    return RunRecord(
        id=uuid4(),
        user_id=USER,
        status="en_curso",
        requirement=f.REQUERIMIENTO,
        generation=SERVER,
        judge=SERVER,
        max_rounds=1,
        server_cost_reserved_usd=0.0,
        estimated_cost_usd=None,
        created_at=FakeClock().now(),
    )
