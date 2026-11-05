import json
from itertools import pairwise
from typing import Any
from uuid import uuid4

import httpx2
import pytest
from pydantic import ValidationError
from pydantic_ai import ModelHTTPError

from criteria.adapters.agents.factory import AgentFactory
from criteria.adapters.agents.runner import ModelBinding
from criteria.adapters.llm.catalog import ModelCatalog
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.adapters.llm.ssrf import GuardedTransport
from criteria.adapters.memory.checkpointer import MemoryCheckpointer
from criteria.adapters.memory.events import ListEventSink
from criteria.application.runs import (
    EsperandoAprobacion,
    RunNotWaitingError,
    RunService,
    Terminada,
)
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.approval import RespuestaHumana
from criteria.domain.artifacts import Historias, Requerimiento
from criteria.domain.events import (
    AgenteEntrega,
    AgenteError,
    AgenteInicia,
    ArtefactosPruebas,
    CorridaFin,
    CorridaInicia,
    EnEsperaHumano,
    EventoBase,
    HumanoResponde,
    ProveedorId,
    RevisorObserva,
)
from criteria.domain.run_config import parse_selection
from criteria.ports.agents import AgentSet
from tests import factories as f
from tests.agent_models import ScriptedTeam, Step, make_binding, team
from tests.fakes import FakeClock

PROMPTS = SERVICE_ROOT / "prompts"
APPROVE = RespuestaHumana(decision="aprobado")


def agent_set(binding: ModelBinding) -> AgentSet:
    return AgentFactory(PROMPTS, "v1", "v1", FakeClock()).build(binding, binding)


class Harness:
    def __init__(self, scripted: ScriptedTeam, max_rondas: int = 2) -> None:
        self.team = scripted
        self.agents = agent_set(scripted.binding(price=0.000001))
        self.checkpointer = MemoryCheckpointer()
        self.service = RunService(self.checkpointer)
        self.run_id = uuid4()
        self.clock = FakeClock()
        self.events = ListEventSink(self.run_id, self.clock)
        self.max_rondas = max_rondas

    async def start(self) -> EsperandoAprobacion | Terminada:
        return await self.service.iniciar(
            requerimiento=Requerimiento(texto=f.REQUERIMIENTO),
            agents=self.agents,
            events=self.events,
            max_rondas=self.max_rondas,
        )

    async def resume(self, respuesta: RespuestaHumana = APPROVE) -> EsperandoAprobacion | Terminada:
        return await self.service.reanudar(
            respuesta=respuesta, agents=self.agents, events=self.events
        )

    async def run(self, respuesta: RespuestaHumana = APPROVE) -> Terminada:
        waiting = await self.start()
        assert isinstance(waiting, EsperandoAprobacion)
        done = await self.resume(respuesta)
        assert isinstance(done, Terminada)
        return done

    def types(self) -> list[str]:
        return [f"{e.type}:{e.agent}" for e in self.events.events]  # type: ignore[attr-defined]

    def of[E: EventoBase](self, kind: type[E]) -> list[E]:
        return [e for e in self.events.events if isinstance(e, kind)]


def happy_team(**overrides: list[Step]) -> ScriptedTeam:
    scripts: dict[str, list[Step]] = {
        "analista": [f.historias(1)],
        "qa": [f.entrega_qa(2)],
        "revisor": [f.veredicto()],
        "evaluador": [f.evaluacion(4)],
    }
    scripts.update(overrides)
    return team(**scripts)


class TestHappyPath:
    async def test_runs_every_agent_in_order_and_emits_the_full_event_stream(self) -> None:
        harness = Harness(happy_team())

        done = await harness.run()

        assert done.estado == "completada"
        assert [p.valor for p in done.puntajes] == [4, 4, 4, 4]
        assert harness.types() == [
            "corrida_inicia:sistema",
            "agente_inicia:analista",
            "agente_progreso:analista",
            "agente_entrega:analista",
            "en_espera_humano:analista",
            "humano_responde:analista",
            "agente_inicia:qa",
            "agente_progreso:qa",
            "agente_entrega:qa",
            "agente_inicia:revisor",
            "agente_progreso:revisor",
            "agente_entrega:revisor",
            "agente_inicia:evaluador",
            "agente_progreso:evaluador",
            "agente_entrega:evaluador",
            "corrida_fin:sistema",
        ]

    async def test_seq_is_gapless_and_timestamps_increase(self) -> None:
        harness = Harness(happy_team())

        await harness.run()

        events = harness.events.events
        assert [e.seq for e in events] == list(range(1, len(events) + 1))
        assert all(a.ts < b.ts for a, b in pairwise(events))
        assert {e.run_id for e in events} == {harness.run_id}

    async def test_start_event_records_models_prompt_version_and_rounds(self) -> None:
        harness = Harness(happy_team(), max_rondas=1)

        await harness.run()

        start = harness.of(CorridaInicia)[0]
        assert start.proveedor == "ollama"
        assert start.modelos.generacion == start.modelos.juez == "test:team"
        assert (start.version_prompts, start.version_juez) == ("v1", "v1")
        assert start.juez_mismo_proveedor
        assert start.max_rondas == 1
        assert not start.experimental

    async def test_final_event_totals_every_agent_call(self) -> None:
        harness = Harness(happy_team())

        await harness.run()

        deliveries = harness.of(AgenteEntrega)
        fin = harness.of(CorridaFin)[0]
        assert fin.estado == "completada"
        assert len(fin.puntajes) == 4
        assert fin.totales.tokens_entrada == sum(d.uso.tokens_entrada for d in deliveries)
        assert fin.totales.latencia_ms == sum(d.uso.latencia_ms for d in deliveries)
        assert fin.totales.costo_usd is not None

    async def test_finished_runs_leave_no_checkpoint(self) -> None:
        harness = Harness(happy_team())

        await harness.run()

        assert harness.checkpointer.saver().storage == {}  # type: ignore[attr-defined]


class TestCost:
    async def test_run_cost_uses_the_catalog_prices_of_each_model(self) -> None:
        catalog = ModelCatalog.load(SERVICE_ROOT / "config" / "models.toml")
        scripted = happy_team()

        def priced(provider: ProveedorId, name: str) -> ModelBinding:
            base = make_binding(scripted, f"{provider}:{name}", provider=provider)
            return ModelBinding(
                model=base.model,
                provider=provider,
                label=base.label,
                settings=base.settings,
                cost_usd=lambda i, o: catalog.cost_usd(provider, name, i, o),
            )

        agents = AgentFactory(PROMPTS, "v1", "v1", FakeClock()).build(
            priced("openai", "gpt-5.4-mini"), priced("anthropic", "claude-haiku-5-5")
        )
        events = ListEventSink(uuid4(), FakeClock())
        service = RunService(MemoryCheckpointer())
        await service.iniciar(
            requerimiento=Requerimiento(texto=f.REQUERIMIENTO),
            agents=agents,
            events=events,
            max_rondas=2,
        )
        await service.reanudar(respuesta=APPROVE, agents=agents, events=events)

        deliveries = [e for e in events.events if isinstance(e, AgenteEntrega)]
        expected = 0.0
        for delivery in deliveries:
            input_price, output_price = (
                (0.10, 0.50) if delivery.agent == "evaluador" else (0.75, 4.50)
            )
            uso = delivery.uso
            expected_call = (
                uso.tokens_entrada * input_price + uso.tokens_salida * output_price
            ) / 1e6
            assert uso.costo_usd == pytest.approx(expected_call, abs=1e-6)
            expected += expected_call
        start = next(e for e in events.events if isinstance(e, CorridaInicia))
        assert (start.proveedor, start.juez_mismo_proveedor) == ("openai", False)
        fin = next(e for e in events.events if isinstance(e, CorridaFin))
        assert fin.totales.costo_usd is not None
        assert fin.totales.costo_usd == pytest.approx(expected, abs=1e-6)
        assert fin.totales.costo_usd > 0


class TestRetries:
    async def test_invalid_output_fixed_by_the_retry_keeps_the_run_going(self) -> None:
        harness = Harness(happy_team(analista=[{"historias": []}, f.historias(1)]))

        done = await harness.run()

        assert done.estado == "completada"
        analista = harness.of(AgenteEntrega)[0]
        assert analista.agent == "analista"
        assert analista.uso.reintentos == 1

    async def test_invalid_output_twice_ends_the_run_cleanly_with_an_error(self) -> None:
        harness = Harness(happy_team(qa=[{"criterios": []}, {"casos": "x"}]))

        done = await harness.run()

        assert done.estado == "error"
        assert done.puntajes == []
        error = harness.of(AgenteError)[0]
        assert (error.agent, error.codigo) == ("qa", "salida_invalida")
        assert harness.types()[-2:] == ["agente_error:qa", "corrida_fin:sistema"]
        assert harness.of(CorridaFin)[0].estado == "error"
        assert "revisor" not in harness.team.calls
        assert harness.checkpointer.saver().storage == {}  # type: ignore[attr-defined]

    @pytest.mark.parametrize("rol", ["revisor", "evaluador"])
    async def test_reviewer_or_evaluator_failure_ends_the_run(self, rol: str) -> None:
        steps: list[Step] = [TimeoutError()]
        harness = Harness(happy_team(**{rol: steps}))

        done = await harness.run()

        assert done.estado == "error"
        assert (harness.of(AgenteError)[0].agent, harness.of(AgenteError)[0].codigo) == (
            rol,
            "proveedor_no_disponible",
        )
        assert harness.types()[-1] == "corrida_fin:sistema"
        assert harness.of(CorridaFin)[0].puntajes == []

    async def test_analyst_failure_ends_before_the_human_pause(self) -> None:
        harness = Harness(happy_team(analista=[{"historias": []}]))

        done = await harness.start()

        assert isinstance(done, Terminada)
        assert done.estado == "error"
        assert not harness.of(EnEsperaHumano)


class TestNoAutomaticFallback:
    @pytest.mark.parametrize(
        ("provider", "status", "codigo", "respaldo"),
        [
            ("anthropic", 401, "clave_invalida", "groq"),
            ("openai", 402, "sin_saldo", "groq"),
            ("openai", 429, "limite_proveedor", "groq"),
            ("groq", 429, "limite_proveedor", None),
            ("openai", 503, "proveedor_no_disponible", None),
        ],
    )
    async def test_account_failures_end_the_run_and_only_suggest_the_free_provider(
        self, provider: ProveedorId, status: int, codigo: str, respaldo: str | None
    ) -> None:
        scripted = happy_team(analista=[ModelHTTPError(status, "m")])
        events = ListEventSink(uuid4(), FakeClock())

        done = await RunService(MemoryCheckpointer()).iniciar(
            requerimiento=Requerimiento(texto=f.REQUERIMIENTO),
            agents=agent_set(make_binding(scripted, f"{provider}:m", provider=provider)),
            events=events,
            max_rondas=2,
        )

        assert isinstance(done, Terminada)
        assert done.estado == "error"
        error = next(e for e in events.events if isinstance(e, AgenteError))
        fin = next(e for e in events.events if isinstance(e, CorridaFin))
        assert (error.codigo, error.respaldo_sugerido, fin.respaldo_sugerido) == (
            codigo,
            respaldo,
            respaldo,
        )
        assert scripted.calls == {"analista": 1}

    async def test_judge_failures_suggest_by_the_judges_provider(self) -> None:
        scripted = happy_team(evaluador=[ModelHTTPError(401, "m")])
        harness = Harness(scripted)
        harness.agents = AgentFactory(PROMPTS, "v1", "v1", FakeClock()).build(
            make_binding(scripted, "groq:g", provider="groq"),
            make_binding(scripted, "anthropic:a", provider="anthropic"),
        )

        await harness.run()

        error = harness.of(AgenteError)[0]
        assert (error.agent, error.respaldo_sugerido) == ("evaluador", "groq")
        assert harness.of(CorridaFin)[0].respaldo_sugerido == "groq"


class TestHumanPause:
    async def test_run_pauses_after_the_analyst_with_the_stories_to_approve(self) -> None:
        harness = Harness(happy_team(analista=[f.historias(2)]))

        waiting = await harness.start()

        assert isinstance(waiting, EsperandoAprobacion)
        assert [h.id for h in waiting.historias.historias] == ["HU-1", "HU-2"]
        assert waiting.ultimo_seq == harness.events.last_seq
        assert harness.types()[-1] == "en_espera_humano:analista"
        assert "qa" not in harness.team.calls

    async def test_resume_with_edited_stories_feeds_them_to_qa(self) -> None:
        harness = Harness(happy_team(analista=[f.historias(2)]))
        await harness.start()
        editadas = Historias.model_validate(
            {"historias": [f.historia(1, quiero="reservar con fecha límite"), f.historia(3)]}
        )

        await harness.resume(RespuestaHumana(decision="editado", historias=editadas))

        respuesta = harness.of(HumanoResponde)[0]
        assert respuesta.decision == "editado"
        assert respuesta.cambios.model_dump() == {
            "agregadas": ["HU-3"],
            "modificadas": ["HU-1"],
            "eliminadas": ["HU-2"],
        }
        qa_prompt = harness.team.prompts["qa"][0]
        assert "reservar con fecha límite" in qa_prompt
        assert '"HU-2"' not in qa_prompt

    async def test_edit_without_changes_counts_as_an_approval(self) -> None:
        harness = Harness(happy_team())
        waiting = await harness.start()
        assert isinstance(waiting, EsperandoAprobacion)

        await harness.resume(RespuestaHumana(decision="editado", historias=waiting.historias))

        assert harness.of(HumanoResponde)[0].decision == "aprobado"

    async def test_resume_from_a_new_sink_continues_the_sequence(self) -> None:
        harness = Harness(happy_team())
        waiting = await harness.start()
        assert isinstance(waiting, EsperandoAprobacion)
        before = list(harness.events.events)
        harness.events = ListEventSink(harness.run_id, harness.clock, last_seq=waiting.ultimo_seq)

        await harness.resume()

        seqs = [e.seq for e in [*before, *harness.events.events]]
        assert seqs == list(range(1, len(seqs) + 1))

    def test_invalid_edits_are_rejected_by_the_schema(self) -> None:
        with pytest.raises(ValidationError):
            RespuestaHumana.model_validate({"decision": "editado", "historias": {"historias": []}})
        with pytest.raises(ValidationError, match="must include"):
            RespuestaHumana(decision="editado")
        with pytest.raises(ValidationError, match="must not include"):
            RespuestaHumana.model_validate({"decision": "aprobado", "historias": f.historias(1)})

    async def test_resuming_a_run_that_is_not_waiting_fails(self) -> None:
        harness = Harness(happy_team())

        with pytest.raises(RunNotWaitingError):
            await harness.resume()


class TestReviewRounds:
    async def test_reviewer_sends_work_to_the_analyst_then_straight_to_qa(self) -> None:
        harness = Harness(
            happy_team(
                revisor=[
                    f.veredicto(f.observacion("analista", referencias=["HU-1"])),
                    f.veredicto(),
                ]
            )
        )

        done = await harness.run()

        assert done.estado == "completada"
        assert harness.types()[11:22] == [
            "agente_entrega:revisor",
            "revisor_observa:revisor",
            "agente_inicia:analista",
            "agente_progreso:analista",
            "agente_entrega:analista",
            "agente_inicia:qa",
            "agente_progreso:qa",
            "agente_entrega:qa",
            "agente_inicia:revisor",
            "agente_progreso:revisor",
            "agente_entrega:revisor",
        ]
        assert len(harness.of(EnEsperaHumano)) == 1
        assert [e.ronda for e in harness.of(AgenteInicia) if e.agent == "analista"] == [0, 1]
        correction = harness.team.prompts["analista"][1]
        assert correction.startswith("Tarea: corrige")
        assert "No hay caso para un libro ya reservado" in correction

    async def test_rounds_stop_at_the_maximum_and_go_to_the_evaluator(self) -> None:
        rechazo = f.veredicto(f.observacion("qa", descripcion="Falta un caso de error"))
        harness = Harness(happy_team(revisor=[rechazo]), max_rondas=2)

        done = await harness.run()

        assert done.estado == "completada"
        assert harness.team.calls["qa"] == 3
        assert harness.team.calls["revisor"] == 3
        observa = harness.of(RevisorObserva)
        assert [(o.ronda, o.se_corrige) for o in observa] == [(0, True), (1, True), (2, False)]
        assert "Falta un caso de error" in harness.team.prompts["evaluador"][0]

    async def test_zero_rounds_never_loops(self) -> None:
        harness = Harness(happy_team(revisor=[f.veredicto(f.observacion("qa"))]), max_rondas=0)

        await harness.run()

        assert harness.team.calls["qa"] == 1
        assert harness.of(RevisorObserva)[0].se_corrige is False

    async def test_cases_added_after_a_review_are_marked_as_reviewer_cases(self) -> None:
        first = f.entrega_qa(2)
        first["casos"][1]["origen"] = "revisor"
        harness = Harness(
            happy_team(
                qa=[first, f.entrega_qa(3)],
                revisor=[f.veredicto(f.observacion("qa")), f.veredicto()],
            )
        )

        await harness.run()

        entregas = [
            e.artefactos
            for e in harness.of(AgenteEntrega)
            if isinstance(e.artefactos, ArtefactosPruebas)
        ]
        assert [c.origen for c in entregas[0].casos] == ["qa", "qa"]
        assert {c.id: c.origen for c in entregas[1].casos} == {
            "CP-01": "qa",
            "CP-02": "qa",
            "CP-03": "revisor",
        }


class TestUserKeyStaysOutForEveryProvider:
    @pytest.mark.parametrize("provider", ["openai", "anthropic", "groq", "openai_compatible"])
    async def test_provider_errors_echoing_the_key_never_reach_events_or_checkpoints(
        self, provider: str
    ) -> None:
        key = f"sk-{provider}-5555-secret"
        data: dict[str, object] = {"proveedor": provider, "modelo": "m-1", "api_key": key}
        if provider == "openai_compatible":
            data["base_url"] = "https://llm.example.com/v1"
        selection = parse_selection(data)
        echo = ModelHTTPError(401, selection.etiqueta, body={"error": f"bad key {key}"})
        scripted = happy_team(analista=[echo])
        checkpointer = MemoryCheckpointer()
        events = ListEventSink(uuid4(), FakeClock())

        done = await RunService(checkpointer).iniciar(
            requerimiento=Requerimiento(texto=f.REQUERIMIENTO),
            agents=agent_set(
                make_binding(scripted, selection.etiqueta, provider=selection.proveedor)
            ),
            events=events,
            max_rondas=2,
        )

        assert isinstance(done, Terminada)
        assert done.estado == "error"
        dumped = json.dumps([e.model_dump(mode="json") for e in events.events])
        assert key not in dumped
        assert key not in repr(selection)
        assert key not in repr(checkpointer.saver().storage)  # type: ignore[attr-defined]


class TestUserKeyStaysOut:
    async def test_events_and_checkpoints_never_hold_the_user_key(self) -> None:
        key = "sk-user-2222-keep-out-of-events"

        def echo(request: httpx2.Request) -> httpx2.Response:
            return httpx2.Response(401, json={"error": request.headers["authorization"]})

        registry = ProviderRegistry(
            Settings(app_env="test"),
            ModelCatalog(models=[]),
            user_endpoint_client=lambda: httpx2.AsyncClient(
                transport=GuardedTransport(httpx2.MockTransport(echo), max_response_bytes=65536)
            ),
        )
        selection = parse_selection(
            {
                "proveedor": "openai_compatible",
                "modelo": "any-model",
                "api_key": key,
                "base_url": "https://llm.example.com/v1",
            }
        )
        binding = ModelBinding(
            model=registry.model(selection),
            provider=selection.proveedor,
            label=selection.etiqueta,
            settings=registry.model_settings(selection),
            cost_usd=lambda i, o: registry.cost_usd(selection, i, o),
        )
        checkpointer = MemoryCheckpointer()
        events = ListEventSink(uuid4(), FakeClock())

        done = await RunService(checkpointer).iniciar(
            requerimiento=Requerimiento(texto=f.REQUERIMIENTO),
            agents=agent_set(binding),
            events=events,
            max_rondas=2,
        )

        assert isinstance(done, Terminada)
        assert done.estado == "error"
        dumped: list[Any] = [e.model_dump(mode="json") for e in events.events]
        assert key not in json.dumps(dumped)
        assert key not in repr(checkpointer.saver().storage)  # type: ignore[attr-defined]
