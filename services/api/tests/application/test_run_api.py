import asyncio
import os
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models.function import AgentInfo, FunctionModel

from criteria.adapters.agents.factory import AgentBindings, AgentFactory
from criteria.adapters.crypto.aesgcm import AesGcmCipher
from criteria.adapters.llm.catalog import CatalogEntry, ModelCatalog
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.adapters.memory.checkpointer import MemoryCheckpointer
from criteria.application.credentials import CredentialService
from criteria.application.errors import (
    ConflictError,
    InvalidInputError,
    NotFoundError,
    VersionsExhaustedError,
)
from criteria.application.run_api import (
    INTERNAL_ERROR_MESSAGE,
    AgentParams,
    RunApplication,
    RunDefaults,
    RunRequest,
    _saved_run,
    _server_cost,
)
from criteria.application.runs import RunService
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.approval import RespuestaHumana
from criteria.domain.events import AgenteEntrega, CorridaFin, EventoBase, evento_adapter
from criteria.domain.run_config import AgentSelections, ProviderSelection
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
from tests.agent_models import ScriptedTeam, make_binding, team, with_broken
from tests.application.memory_stores import (
    MemoryCredentials,
    MemoryHistory,
    MemoryRuns,
    MemorySettings,
    MemoryUsage,
)
from tests.fakes import FakeClock, FakeKeyValidator, FakeReporter

SHIPPED = ModelCatalog.load(SERVICE_ROOT / "config" / "models.toml")
# A second, pricier Groq model without a tier, so explicit models can be told apart.
GROQ_EXTRA = "groq-sin-nivel"
CATALOG = SHIPPED.model_copy(
    update={
        "models": [
            *SHIPPED.models,
            CatalogEntry(
                provider="groq",
                name=GROQ_EXTRA,
                display_name="Groq sin nivel",
                input_usd_per_million=0.59,
                output_usd_per_million=0.79,
            ),
        ]
    }
)
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
    built: list[AgentSelections] = field(default_factory=list)
    model: FunctionModel | None = None
    reporter: FakeReporter = field(default_factory=FakeReporter)
    broken: dict[str, BaseException] = field(default_factory=dict)

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

    def build(selections: AgentSelections) -> AgentSet:
        h = holder[0]
        h.built.append(selections)
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

        bindings = AgentBindings(
            analista=bind(selections.analista),
            qa=bind(selections.qa),
            revisor=bind(selections.revisor),
            evaluador=bind(selections.evaluador),
        )
        return with_broken(factory.build_for(bindings), h.broken)

    runs, usage, user_settings, history = (
        MemoryRuns(),
        MemoryUsage(),
        MemorySettings(),
        MemoryHistory(),
    )
    checkpointer = MemoryCheckpointer()
    reporter = FakeReporter()
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
        reporter=reporter,
    )
    holder.append(
        Harness(app, runs, usage, user_settings, history, credentials, clock, reporter=reporter)
    )
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

    async def test_a_failing_cleanup_is_reported_and_the_run_is_created(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        h = harness()
        closed = ConnectionError("server closed the connection")

        async def broken() -> int:
            raise closed

        monkeypatch.setattr(h.app, "cleanup", broken)

        created = await h.app.create(USER, request())

        assert created.run_id in h.runs.records
        assert h.reporter.reported == [(closed, None)]

    async def test_a_run_that_cannot_be_stored_gives_its_quota_back(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        h = harness()
        lost = ConnectionError("server closed the connection")

        async def broken(_record: RunRecord) -> None:
            raise lost

        monkeypatch.setattr(h.runs, "create", broken)

        with pytest.raises(ConnectionError):
            await h.app.create(USER, request())

        assert h.usage.reserved == []
        assert [r.user_id for r in h.usage.released] == [USER]

    async def test_a_failed_release_is_reported_and_the_original_error_raised(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        h = harness()
        lost, release_lost = ConnectionError("insert"), ConnectionError("release")

        async def broken_create(_record: RunRecord) -> None:
            raise lost

        async def broken_release(_reservation: object) -> None:
            raise release_lost

        monkeypatch.setattr(h.runs, "create", broken_create)
        monkeypatch.setattr(h.usage, "release", broken_release)

        with pytest.raises(ConnectionError) as raised:
            await h.app.create(USER, request())

        assert raised.value is lost
        assert h.reporter.reported == [(release_lost, None)]

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
        created = await harness().app.create(USER, request(modelo=GROQ_EXTRA, nivel="economico"))

        assert created.generacion.modelo == GROQ_EXTRA

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


class TestUnexpectedFailures:
    async def _cut_after_the_analista(self, h: Harness, run_id: UUID) -> None:
        stream = await h.app.open_stream(USER, run_id, 0)
        async for event in stream:
            if event is not None and event.type == "en_espera_humano":  # type: ignore[attr-defined]
                break
        await stream.aclose()  # type: ignore[attr-defined]

    async def test_an_error_in_a_node_ends_the_run_with_a_safe_corrida_fin(self) -> None:
        h = harness()
        await h.settings.put(USER, UserSettings(save_history=True))
        boom = RuntimeError("detalle con el texto del requerimiento")
        h.broken = {"qa": boom}
        created = await h.app.create(USER, request())
        first = await h.collect(created.run_id)
        await h.app.approve(USER, created.run_id, RespuestaHumana(decision="aprobado"))

        second = await h.collect(created.run_id, first[-1].seq)

        end = second[-1]
        assert isinstance(end, CorridaFin)
        assert (end.estado, end.codigo, end.mensaje) == (
            "error",
            "error_interno",
            INTERNAL_ERROR_MESSAGE,
        )
        assert end.totales.tokens_entrada > 0
        assert all("requerimiento" not in e.model_dump_json() for e in second)
        assert [e.seq for e in first + second] == list(range(1, len(first + second) + 1))
        assert h.reporter.reported == [(boom, created.run_id)]
        assert created.run_id not in h.runs.records
        analista = next(e for e in first if isinstance(e, AgenteEntrega))
        [(_, _, reserved, actual)] = h.usage.settled
        assert reserved == created.costo_servidor_usd
        assert actual == pytest.approx(analista.uso.costo_usd, abs=1e-6)
        assert [r.status for r in h.history.runs[USER]] == ["error"]

    async def test_a_run_whose_close_was_cut_is_closed_once_without_running_again(
        self,
    ) -> None:
        h = harness()
        await h.settings.put(USER, UserSettings(save_history=True))
        run_id = (await h.app.create(USER, request())).run_id
        first = await h.collect(run_id)
        await h.app.approve(USER, run_id, RespuestaHumana(decision="aprobado"))
        delete, calls = h.runs.delete, dict(h.team.calls)

        async def crash_once(target: UUID) -> None:
            h.runs.delete = delete  # type: ignore[method-assign]
            raise ConnectionError("instance lost")

        h.runs.delete = crash_once  # type: ignore[method-assign,assignment]
        with pytest.raises(ConnectionError):
            await h.collect(run_id, first[-1].seq)
        calls_after_end = dict(h.team.calls)

        assert h.runs.events[run_id][-1]["type"] == "corrida_fin"
        assert await h.collect(run_id, h.runs.events[run_id][-1]["seq"]) == []
        assert run_id not in h.runs.records
        assert h.team.calls == calls_after_end != calls
        assert len(h.usage.settled) == 1
        assert len(h.history.runs[USER]) == 1

    async def test_an_orphan_older_than_the_ttl_fails_and_returns_the_unused_quota(
        self,
    ) -> None:
        h = harness()
        created = await h.app.create(USER, request())
        await self._cut_after_the_analista(h, created.run_id)
        spent = sum(
            e["uso"]["costo_usd"]
            for e in h.runs.events[created.run_id]
            if e["type"] == "agente_entrega"
        )
        failed: list[UUID] = []
        fail_if_stale = h.runs.fail_if_stale

        async def spy(run_id: UUID, updated_before: datetime) -> bool:
            failed.append(run_id)
            return await fail_if_stale(run_id, updated_before)

        h.runs.fail_if_stale = spy  # type: ignore[method-assign]
        h.runs.touched[created.run_id] -= timedelta(hours=2)

        await h.app.create(USER, request())

        assert created.run_id not in h.runs.records
        assert failed == [created.run_id]
        [(user, _, reserved, actual)] = h.usage.settled
        assert (user, reserved) == (USER, created.costo_servidor_usd)
        assert actual == pytest.approx(spent, abs=1e-6)

    async def test_an_orphan_with_an_open_stream_is_left_alone(self) -> None:
        h = harness()
        run_id = (await h.app.create(USER, request())).run_id
        h.runs.touched[run_id] -= timedelta(hours=2)

        async with h.runs.stream_lock(run_id):
            await h.app.create(USER, request())

        assert run_id in h.runs.records
        assert h.usage.settled == []


class TestAgentParams:
    async def test_each_agent_gets_its_own_model_and_tuning(self) -> None:
        h = harness()
        created = await h.app.create(
            USER,
            request(
                agentes={
                    "qa": AgentParams(modelo=GROQ_EXTRA, temperatura=0.9),
                    "revisor": AgentParams(max_tokens=2048),
                }
            ),
        )
        await h.collect(created.run_id)

        [selections] = h.built
        assert selections.qa.modelo == GROQ_EXTRA
        assert selections.qa.temperatura == 0.9
        assert selections.revisor.max_tokens == 2048
        assert selections.analista.modelo == "openai/gpt-oss-20b"
        assert created.agentes["qa"].modelo == GROQ_EXTRA

    async def test_the_estimate_adds_each_agents_own_price(self) -> None:
        h = harness()
        cheap = await h.app.create(USER, request())
        bigger = await h.app.create(USER, request(agentes={"qa": AgentParams(modelo=GROQ_EXTRA)}))

        assert bigger.costo_estimado_usd is not None
        assert cheap.costo_estimado_usd is not None
        assert bigger.costo_estimado_usd > cheap.costo_estimado_usd
        assert bigger.costo_servidor_usd == bigger.costo_estimado_usd

    @pytest.mark.parametrize(
        "params",
        [
            AgentParams(temperatura=1.5),
            AgentParams(temperatura=-0.1),
            AgentParams(max_tokens=100),
            AgentParams(max_tokens=17000),
        ],
    )
    async def test_out_of_range_tuning_is_refused(self, params: AgentParams) -> None:
        with pytest.raises(InvalidInputError):
            await harness().app.create(USER, request(agentes={"analista": params}))

    async def test_an_agent_cannot_leave_its_provider_catalog(self) -> None:
        with pytest.raises(ProviderNotAllowedError):
            await harness().app.create(
                USER, request(agentes={"qa": AgentParams(modelo="claude-haiku-5-5")})
            )

    async def test_review_rounds_go_up_to_three(self) -> None:
        h = harness()

        created = await h.app.create(USER, request(max_rondas=3))

        assert created.max_rondas == 3
        with pytest.raises(InvalidInputError):
            await h.app.create(USER, request(max_rondas=4))


class TestHistoryChoice:
    @pytest.mark.parametrize(
        ("setting", "choice", "saved"),
        [(False, None, False), (True, None, True), (True, False, False), (False, True, True)],
    )
    async def test_the_choice_is_fixed_when_the_run_is_created(
        self, setting: bool, choice: bool | None, saved: bool
    ) -> None:
        h = harness()
        await h.settings.put(USER, UserSettings(save_history=setting))
        created = await h.app.create(USER, request(guardar_historial=choice))
        await h.settings.put(USER, UserSettings(save_history=not saved))
        first = await h.collect(created.run_id)
        await h.app.approve(USER, created.run_id, RespuestaHumana(decision="aprobado"))

        await h.collect(created.run_id, first[-1].seq)

        assert created.guardar_historial is saved
        assert bool(h.history.runs.get(USER)) is saved


class TestAnotherVersion:
    async def test_the_analista_writes_again_without_another_run_from_the_quota(self) -> None:
        h = harness()
        h.team.scripts["analista"] = [f.historias(1), f.historias(2)]
        created = await h.app.create(USER, request())
        first = await h.collect(created.run_id)

        await h.app.approve(
            USER, created.run_id, RespuestaHumana(decision="otra_version", nota="Más corto")
        )
        second = await h.collect(created.run_id, first[-1].seq)

        assert second[0].type == "humano_responde"  # type: ignore[attr-defined]
        assert second[-1].type == "en_espera_humano"  # type: ignore[attr-defined]
        assert len(h.usage.reserved) == 1
        [(run_id, extra)] = h.usage.extra
        assert run_id == created.run_id
        assert extra > 0

    async def test_a_third_version_is_refused_before_it_is_stored(self) -> None:
        h = harness()
        h.team.scripts["analista"] = [f.historias(1)] * 3
        run_id = (await h.app.create(USER, request())).run_id
        last = (await h.collect(run_id))[-1].seq
        for _ in range(2):
            await h.app.approve(USER, run_id, RespuestaHumana(decision="otra_version"))
            last = (await h.collect(run_id, last))[-1].seq

        with pytest.raises(VersionsExhaustedError):
            await h.app.approve(USER, run_id, RespuestaHumana(decision="otra_version"))

        assert h.runs.records[run_id].approval is None
        await h.app.approve(USER, run_id, RespuestaHumana(decision="aprobado"))

    async def test_runs_on_the_users_key_reserve_nothing_extra(self) -> None:
        h = harness()
        await h.credentials.save(USER, "anthropic", SecretStr("sk-ant-user-0000"), None)
        h.team.scripts["analista"] = [f.historias(1), f.historias(1)]
        run_id = (await h.app.create(USER, request(proveedor="anthropic", juez="anthropic"))).run_id
        await h.collect(run_id)

        await h.app.approve(USER, run_id, RespuestaHumana(decision="otra_version"))

        assert h.usage.extra == []

    async def test_a_full_free_quota_refuses_another_version(self) -> None:
        h = harness()
        run_id = (await h.app.create(USER, request())).run_id
        await h.collect(run_id)
        h.usage.refuse = LimitExceededError("cupo_gratuito_agotado")

        with pytest.raises(LimitExceededError):
            await h.app.approve(USER, run_id, RespuestaHumana(decision="otra_version"))

        assert h.runs.records[run_id].approval is None


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

        assert _server_cost(events, _record(SERVER, SERVER)) == 0.03
        assert _server_cost(events, _record(OWN, SERVER)) == 0.02
        assert _server_cost(events, _record(OWN, OWN)) == 0.0

    def test_failed_calls_are_billed_too(self) -> None:
        failed = {
            **{k: v for k, v in _entrega("qa", 0.004).items() if k not in {"ronda", "artefactos"}},
            "type": "agente_error",
            "codigo": "salida_invalida",
            "mensaje": "El agente no produjo una salida válida tras un reintento.",
        }
        events = _events(_entrega("analista", 0.01), failed)

        assert _server_cost(events, _record(SERVER, SERVER)) == 0.014

    def test_an_unpriced_server_call_makes_the_cost_unknown(self) -> None:
        events = _events(_entrega("analista", None))

        assert _server_cost(events, _record(SERVER, SERVER)) is None
        assert _server_cost(events, _record(OWN, SERVER)) == 0.0

    def test_each_agent_is_charged_with_its_own_plan(self) -> None:
        events = _events(_entrega("analista", 0.01), _entrega("qa", 0.02))
        record = replace(_record(SERVER, SERVER), agent_plans={"qa": OWN})

        assert _server_cost(events, record) == 0.01

    def test_runs_without_start_or_end_are_not_saved(self) -> None:
        events = _events(_entrega("analista", 0.01))

        assert _saved_run(_record(), events) is None


def _record(generation: ModelPlan = SERVER, judge: ModelPlan = SERVER) -> RunRecord:
    return RunRecord(
        id=uuid4(),
        user_id=USER,
        status="en_curso",
        requirement=f.REQUERIMIENTO,
        generation=generation,
        judge=judge,
        max_rounds=1,
        server_cost_reserved_usd=0.0,
        estimated_cost_usd=None,
        created_at=FakeClock().now(),
    )
