import pytest
from pydantic_ai import ModelHTTPError

from criteria.adapters.agents.factory import AgentFactory
from criteria.adapters.memory.checkpointer import MemoryCheckpointer
from criteria.application.evaluation import BatchStoppedError, EvalRunner
from criteria.application.runs import RunService
from criteria.config import SERVICE_ROOT
from criteria.domain.evaluation import EvalBatch
from tests import factories as f
from tests.agent_models import ScriptedTeam, Step, team
from tests.eval_factories import batch, case, result
from tests.fakes import FakeClock

PROMPTS = SERVICE_ROOT / "prompts"


class MemoryStore:
    def __init__(self) -> None:
        self.saved: list[EvalBatch] = []

    def save(self, batch: EvalBatch) -> None:
        self.saved.append(batch)


def scripted(**overrides: list[Step]) -> ScriptedTeam:
    scripts: dict[str, list[Step]] = {
        "analista": [f.historias(1)],
        "qa": [f.entrega_qa(2)],
        "revisor": [f.veredicto(f.observacion()), f.veredicto()],
        "evaluador": [f.evaluacion(4)],
    }
    scripts.update(overrides)
    return team(**scripts)


class Recorder:
    def __init__(self) -> None:
        self.waits: list[float] = []

    async def sleep(self, seconds: float) -> None:
        self.waits.append(seconds)


def runner(model: ScriptedTeam, store: MemoryStore, sleeper: Recorder) -> EvalRunner:
    clock = FakeClock()
    binding = model.binding(price=0.000001)
    agents = AgentFactory(PROMPTS, "v1", "v1", clock).build(binding, binding)
    return EvalRunner(
        service=RunService(MemoryCheckpointer()),
        agents=agents,
        clock=clock,
        store=store,
        sleep=sleeper.sleep,
        max_rondas=2,
        backoff=(1.0, 2.0),
    )


class TestEvalRunner:
    async def test_runs_each_case_through_the_graph_with_automatic_approval(self) -> None:
        store, sleeper = MemoryStore(), Recorder()
        model = scripted()

        done = await runner(model, store, sleeper).run(batch(), [case("facil-01")])

        outcome = done.resultados["facil-01"]
        assert outcome.estado == "completada"
        assert outcome.rondas == 1
        assert [p.valor for p in outcome.puntajes] == [4, 4, 4, 4]
        assert outcome.agentes["qa"].llamadas == 2
        assert outcome.agentes["revisor"].llamadas == 2
        assert outcome.validas_a_la_primera == (6, 6)
        assert [o.se_corrige for o in outcome.artefactos.observaciones] == [True]
        assert len(outcome.artefactos.historias) == 1
        assert len(outcome.artefactos.casos) == 2
        assert outcome.costo_usd is not None
        assert done.costo_gastado_usd == pytest.approx(outcome.costo_usd)
        assert store.saved[-1] == done
        assert f.REQUERIMIENTO not in model.prompts["analista"][0]

    async def test_resuming_skips_the_cases_already_done(self) -> None:
        store, sleeper = MemoryStore(), Recorder()
        model = scripted()
        started = batch(results=[result("facil-01")])
        messages: list[str] = []

        done = await runner(model, store, sleeper).run(
            started, [case("facil-01"), case("facil-02")], messages.append
        )

        assert sorted(done.resultados) == ["facil-01", "facil-02"]
        assert done.resultados["facil-01"] == started.resultados["facil-01"]
        assert model.calls["analista"] == 1
        assert len(store.saved) == 1
        assert messages[0] == "facil-01: ya estaba completo, se salta"

    async def test_a_rate_limit_waits_and_repeats_the_whole_case(self) -> None:
        store, sleeper = MemoryStore(), Recorder()
        model = scripted(analista=[ModelHTTPError(429, "m"), f.historias(1)])

        done = await runner(model, store, sleeper).run(batch(), [case("facil-01")])

        assert sleeper.waits == [1.0]
        assert done.resultados["facil-01"].intentos == 2
        assert done.resultados["facil-01"].estado == "completada"

    async def test_a_lasting_rate_limit_stops_without_recording_the_case(self) -> None:
        store, sleeper = MemoryStore(), Recorder()
        model = scripted(analista=[ModelHTTPError(429, "m")])

        with pytest.raises(BatchStoppedError) as stopped:
            await runner(model, store, sleeper).run(batch(), [case("facil-01")])

        assert (stopped.value.case_id, stopped.value.codigo) == ("facil-01", "limite_proveedor")
        assert sleeper.waits == [1.0, 2.0]
        assert store.saved == []

    async def test_account_failures_stop_at_once(self) -> None:
        store, sleeper = MemoryStore(), Recorder()
        model = scripted(analista=[ModelHTTPError(401, "m")])

        with pytest.raises(BatchStoppedError, match="clave_invalida"):
            await runner(model, store, sleeper).run(batch(), [case("facil-01")])

        assert sleeper.waits == []

    async def test_model_failures_are_results_of_the_batch(self) -> None:
        store, sleeper = MemoryStore(), Recorder()
        invalid = {"historias": [f.historia(id="US-1")]}
        model = scripted(analista=[invalid, invalid])

        done = await runner(model, store, sleeper).run(batch(), [case("medio-01")])

        outcome = done.resultados["medio-01"]
        assert (outcome.estado, outcome.codigo_error) == ("error", "salida_invalida")
        assert outcome.agentes["analista"].errores == ["salida_invalida"]
        assert outcome.validas_a_la_primera == (0, 1)
        assert outcome.agentes["analista"].tokens_entrada > 0
        assert outcome.costo_usd is not None
        assert outcome.costo_usd > 0
        assert done.costo_gastado_usd == pytest.approx(outcome.costo_usd)
        assert outcome.puntajes == []
