from collections.abc import Sequence

import pytest

from criteria.application.analysis import MatchOutcome
from criteria.application.stability import (
    judge_input,
    judge_self_agreement,
    matcher_self_agreement,
    measure,
    new_record,
)
from criteria.domain.artifacts import CRITERIOS, Evaluacion, Puntaje
from criteria.domain.eval_sampling import matcher_batch, stability_sample
from criteria.domain.evaluation import (
    Deteccion,
    EvalBatch,
    EvalCase,
    ObservacionEnRonda,
    StabilityRecord,
)
from criteria.domain.events import ProveedorId, Uso
from criteria.ports.agents import AgentResult, EntradaEvaluador
from tests.eval_factories import all_cases, batch, full_batch, observacion, result

HARD = {f"dificil-0{i}": [True, False] for i in range(1, 6)}


class SameJudge:
    """Scores everything 4 except claridad, which it lowers by one on the second ask."""

    def __init__(self) -> None:
        self.inputs: list[EntradaEvaluador] = []

    @property
    def modelo(self) -> str:
        return "anthropic:claude-haiku-5-5"

    @property
    def proveedor(self) -> ProveedorId:
        return "anthropic"

    async def run(self, entrada: EntradaEvaluador) -> AgentResult[Evaluacion]:
        self.inputs.append(entrada)
        return AgentResult(
            salida=Evaluacion(
                puntajes=[
                    Puntaje(criterio=c, valor=3 if c == "claridad" else 4, justificacion="x")
                    for c in CRITERIOS
                ]
            ),
            uso=Uso(tokens_entrada=1, tokens_salida=1, latencia_ms=1, costo_usd=0.001),
        )


class FlippingMatcher:
    async def match(
        self, caso: EvalCase, observaciones: Sequence[ObservacionEnRonda]
    ) -> MatchOutcome:
        return MatchOutcome(
            [
                Deteccion(
                    problema=i,
                    detectado=i == 1,
                    observacion=0 if i == 1 else None,
                    justificacion="x",
                )
                for i in range(len(caso.problemas))
            ],
            0.0005,
        )


class MemoryStore:
    def __init__(self) -> None:
        self.saved: list[StabilityRecord] = []

    def save(self, record: StabilityRecord) -> None:
        self.saved.append(record)


def batches() -> list[EvalBatch]:
    return [
        full_batch("openai", "a").model_copy(
            update={"deteccion": batch(detections=HARD).deteccion}
        ),
        full_batch("groq", "b"),
    ]


class TestSamples:
    def test_the_stability_sample_alternates_models_and_is_seeded(self) -> None:
        first, second = batches()

        sample = stability_sample([first, second], seed=4)

        assert len(sample) == 10
        assert [b for b, _ in sample[:4]] == [second.batch_id, first.batch_id] * 2
        assert len(set(sample)) == 10
        assert sample == stability_sample([second, first], seed=4)

    def test_the_matcher_batch_needs_its_five_hard_runs_matched(self) -> None:
        first, second = batches()
        assert matcher_batch([first, second], seed=1) == first.batch_id
        assert matcher_batch([second], seed=1) is None


class TestMeasure:
    async def test_asks_again_and_resumes_without_repeating(self) -> None:
        all_batches = batches()
        record = new_record(all_batches, seed=2)
        judge, store = SameJudge(), MemoryStore()

        done = await measure(
            record,
            all_batches,
            all_cases(),
            judge=judge,
            matcher=FlippingMatcher(),
            store=store,
        )

        assert len(done.juez) == 10
        assert len(done.emparejador) == 5
        assert done.costo_usd == pytest.approx(10 * 0.001 + 5 * 0.0005)
        assert len(store.saved) == 15

        again = await measure(
            done,
            all_batches,
            all_cases(),
            judge=judge,
            matcher=FlippingMatcher(),
            store=store,
        )
        assert again == done
        assert len(judge.inputs) == 10

        judge_stats = judge_self_agreement(done)
        assert judge_stats is not None
        assert judge_stats.pairs == 40
        # Originals score (4, 4, 3, 5); the second ask gives (3, 4, 4, 4): one of four agrees.
        assert judge_stats.exact.value == pytest.approx(0.25)
        matcher_stats = matcher_self_agreement(done)
        assert matcher_stats is not None
        assert matcher_stats.pairs == 10
        assert matcher_stats.exact.value == pytest.approx(0.0)

    async def test_without_a_matched_batch_only_the_judge_is_measured(self) -> None:
        only_runs = [full_batch("groq", "b")]
        done = await measure(
            new_record(only_runs, seed=2),
            only_runs,
            all_cases(),
            judge=SameJudge(),
            matcher=FlippingMatcher(),
            store=MemoryStore(),
        )
        assert done.emparejador == []
        assert matcher_self_agreement(done) is None
        assert (
            judge_self_agreement(StabilityRecord(semilla=1, muestra_juez=[], lote_emparejador=None))
            is None
        )


def test_the_judge_gets_the_final_artifacts_and_only_pending_observations() -> None:
    run = result("dificil-01", observaciones=0)
    run = run.model_copy(
        update={
            "artefactos": run.artefactos.model_copy(
                update={
                    "observaciones": [
                        ObservacionEnRonda(ronda=0, observacion=observacion("corregida")),
                        ObservacionEnRonda(
                            ronda=1, observacion=observacion("pendiente"), se_corrige=False
                        ),
                    ]
                }
            )
        }
    )

    entrada = judge_input(all_cases()["dificil-01"], run)

    assert entrada.requerimiento.texto == all_cases()["dificil-01"].texto.strip()
    assert [h.id for h in entrada.historias.historias] == ["HU-1"]
    assert len(entrada.entrega.casos) == 1
    assert [o.descripcion for o in entrada.observaciones_pendientes] == ["pendiente"]
