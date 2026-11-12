import pytest

from criteria.application.report import (
    judge_agreement,
    judge_pairs,
    matcher_agreement,
    same_order,
    sample_by_model,
    summarize,
    summarize_batch,
)
from criteria.domain.artifacts import Criterio
from criteria.domain.evaluation import HumanScore, HumanSession, MatchCheck
from tests.eval_factories import all_cases, batch, result


def test_a_batch_summary_counts_runs_scores_operation_and_detection() -> None:
    summary = summarize_batch(
        batch(
            results=[
                result("facil-01", scores=(4, 4, 4, 4), latencia_ms=10_000, costo=0.002),
                result("medio-01", scores=(2, 2, 2, 2), latencia_ms=30_000, costo=0.004, rondas=2),
                result(
                    "dificil-01", estado="error", scores=None, validas=2, llamadas=4, costo=None
                ),
            ],
            detections={"dificil-02": [True, False]},
        ),
        all_cases(),
    )

    assert (summary.corridas, summary.completas) == (3, 2)
    assert summary.errores == {"salida_invalida": 1}
    assert summary.puntaje_global == pytest.approx(3.0)
    assert summary.puntajes["claridad"] == pytest.approx(3.0)
    assert (summary.validas, summary.llamadas) == (10, 12)
    assert summary.tasa_validas == pytest.approx(10 / 12)
    assert summary.rondas_media == pytest.approx(1.5)
    assert summary.latencia_p50_ms == pytest.approx(20_000)
    assert summary.costo_por_corrida == pytest.approx(0.003)
    assert summary.tokens_por_corrida == pytest.approx(1200)
    assert summary.por_dificultad["dificil"].completas == 0
    assert summary.por_dificultad["facil"].puntaje_global == pytest.approx(4.0)
    assert summary.deteccion.total.detected == 1


def test_models_also_compare_on_the_cases_every_batch_completed() -> None:
    complete = batch(
        "anthropic",
        "haiku",
        [result("facil-01", scores=(4, 4, 4, 4)), result("medio-01", scores=(2, 2, 2, 2))],
        detections={"dificil-01": [True, True], "dificil-02": [True, False]},
    )
    partial = batch(
        "ollama",
        "llama",
        [
            result("facil-01", scores=(3, 3, 3, 3)),
            result("medio-01", estado="error", scores=None),
        ],
        detections={"dificil-01": [False, True]},
    )

    first, second = summarize([complete, partial], all_cases())

    assert (first.puntaje_global, first.comunes.puntaje_global) == (3.0, 4.0)
    assert (first.comunes.casos, second.comunes.casos) == (1, 1)
    assert second.comunes.puntajes["claridad"] == 3.0
    assert (first.deteccion.total.detected, first.deteccion.total.total) == (3, 4)
    assert (first.deteccion_comunes.total.detected, first.deteccion_comunes.casos) == (2, 1)
    assert (second.deteccion.casos, second.deteccion_comunes.total.detected) == (1, 1)
    assert summarize_batch(complete, all_cases()).comunes.puntaje_global is None


def test_the_agreement_does_not_depend_on_the_order_of_the_pairs() -> None:
    pairs: list[tuple[Criterio, int, int]] = [
        ("claridad", 2, 4),
        ("completitud", 3, 5),
        ("claridad", 3, 4),
        ("consistencia", 2, 5),
        ("verificabilidad", 4, 4),
    ]

    assert judge_agreement(pairs) == judge_agreement(list(reversed(pairs)))


def test_the_sample_compares_judge_and_person_per_model_and_their_order() -> None:
    high = batch("anthropic", "a", [result("facil-01", scores=(4, 4, 4, 4))])
    low = batch(
        "groq",
        "b",
        [result("medio-01", scores=(2, 2, 2, 2)), result("facil-02", scores=None)],
    )
    session = HumanSession(
        semilla=1,
        puntajes=[
            HumanScore(batch_id=high.batch_id, case_id="facil-01", criterio="claridad", valor=3),
            HumanScore(batch_id=low.batch_id, case_id="medio-01", criterio="claridad", valor=5),
            HumanScore(batch_id=low.batch_id, case_id="facil-02", criterio="claridad", valor=5),
        ],
    )

    first, second = sample_by_model(session, [high, low])

    assert (first.clave, first.corridas, first.juez, first.persona) == ("anthropic:a", 1, 4.0, 3.0)
    assert (second.corridas, second.juez, second.persona) == (1, 2.0, 5.0)
    assert not same_order([first, second])
    assert same_order([first])


def test_an_unpriced_completed_run_leaves_the_cost_per_run_unknown() -> None:
    summary = summarize_batch(batch(results=[result("facil-01", costo=None)]), all_cases())
    assert summary.costo_por_corrida is None


def test_judge_agreement_pairs_the_person_with_the_judge_per_criterion() -> None:
    b = batch(results=[result("facil-01", scores=(4, 4, 3, 5))])
    session = HumanSession(
        semilla=1,
        puntajes=[
            HumanScore(batch_id=b.batch_id, case_id="facil-01", criterio="claridad", valor=4),
            HumanScore(batch_id=b.batch_id, case_id="facil-01", criterio="completitud", valor=2),
            HumanScore(batch_id=b.batch_id, case_id="medio-09", criterio="claridad", valor=2),
        ],
    )

    pairs = judge_pairs(session, [b])

    assert pairs == [("claridad", 4, 4), ("completitud", 3, 2)]
    agreement = judge_agreement(pairs)
    assert agreement is not None
    assert agreement.total.pairs == 2
    assert agreement.total.exact.value == pytest.approx(0.5)
    assert agreement.total.judge_minus_human.value == pytest.approx(0.5)
    assert agreement.por_criterio["claridad"].pairs == 1
    assert judge_agreement([]) is None


def test_matcher_agreement_is_the_share_the_person_confirmed() -> None:
    b = batch()
    checks = [
        MatchCheck(batch_id=b.batch_id, case_id="dificil-01", problema=i, acierta=i != 0)
        for i in range(4)
    ]

    estimate = matcher_agreement(HumanSession(semilla=1, emparejamientos=checks))

    assert estimate is not None
    assert estimate.value == pytest.approx(0.75)
    assert matcher_agreement(HumanSession(semilla=1)) is None
