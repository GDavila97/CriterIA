from collections import Counter

import pytest

from criteria.domain.eval_sampling import (
    detection,
    judge_sample,
    match_sample,
    never_detected,
)
from criteria.domain.evaluation import EvalBatch
from criteria.domain.events import ProveedorId
from tests.eval_factories import all_cases, batch, case, full_batch, result

MODELS: list[tuple[ProveedorId, str]] = [
    ("openai", "gpt-6-luna"),
    ("anthropic", "claude-haiku-5-5"),
    ("groq", "openai/gpt-oss-20b"),
    ("ollama", "llama3.1:8b"),
]


def four_batches() -> list[EvalBatch]:
    return [full_batch(p, m) for p, m in MODELS]


class TestJudgeSample:
    def test_four_models_get_two_runs_each_spread_over_difficulties(self) -> None:
        batches = four_batches()

        sample = judge_sample(batches, seed=42)

        assert len(sample) == 8
        per_batch = Counter(batch_id for batch_id, _ in sample)
        assert sorted(per_batch.values()) == [2, 2, 2, 2]
        for batch_id in per_batch:
            levels = [c.split("-")[0] for b, c in sample if b == batch_id]
            assert len(set(levels)) == 2
        assert sorted(Counter(c.split("-")[0] for _, c in sample).values()) == [2, 3, 3]

    def test_eight_runs_split_three_three_two_among_three_models(self) -> None:
        batches = four_batches()[1:]

        sample = judge_sample(batches, seed=20261108)

        assert len(sample) == 8
        per_batch = Counter(batch_id for batch_id, _ in sample)
        assert sorted(per_batch.values()) == [2, 3, 3]
        for batch_id, count in per_batch.items():
            levels = [c.split("-")[0] for b, c in sample if b == batch_id]
            assert len(set(levels)) == count
        assert sorted(Counter(c.split("-")[0] for _, c in sample).values()) == [2, 3, 3]
        smaller = {
            next(
                b for b, n in Counter(b for b, _ in judge_sample(batches, seed=s)).items() if n == 2
            )
            for s in range(10)
        }
        assert len(smaller) > 1

    def test_the_same_seed_gives_the_same_sample(self) -> None:
        batches = four_batches()
        assert judge_sample(batches, seed=7) == judge_sample(list(reversed(batches)), seed=7)
        assert judge_sample(batches, seed=7) != judge_sample(batches, seed=8)

    def test_only_graded_runs_are_sampled_and_difficulty_falls_back(self) -> None:
        only_easy = batch(
            results=[result("facil-01"), result("facil-02"), result("medio-01", scores=None)]
        )

        sample = judge_sample([only_easy], seed=1)

        assert sorted(c for _, c in sample) == ["facil-01", "facil-02"]

    def test_a_batch_without_graded_runs_adds_nothing(self) -> None:
        assert judge_sample([batch(results=[result("facil-01", scores=None)])], seed=1) == []
        assert judge_sample([], seed=1) == []


class TestDetection:
    def test_rates_overall_and_by_type(self) -> None:
        cases = all_cases() | {"dificil-01": case("dificil-01", problems=3)}
        b = batch(detections={"dificil-01": [True, False, True], "dificil-02": [False, True]})

        report = detection(b, cases)

        assert (report.total.detected, report.total.total) == (3, 5)
        assert report.total.rate == pytest.approx(0.6)
        assert (report.by_type["ambiguedad"].detected, report.by_type["ambiguedad"].total) == (1, 2)
        assert (
            report.by_type["inconsistencia"].detected,
            report.by_type["inconsistencia"].total,
        ) == (1, 2)
        assert (report.by_type["faltante"].detected, report.by_type["faltante"].total) == (1, 1)
        assert detection(batch(), cases).total.rate is None

    def test_coverage_marks_a_batch_matched_on_fewer_hard_cases_and_can_narrow_to_some(
        self,
    ) -> None:
        cases = all_cases()
        b = batch(detections={"dificil-01": [True, False], "dificil-03": [False, False]})

        report = detection(b, cases)
        narrowed = detection(b, cases, only={"dificil-01"})

        assert (report.casos, report.casos_dificiles, report.comparable) == (2, 5, False)
        assert (narrowed.casos, narrowed.total.detected, narrowed.total.total) == (1, 1, 2)
        every = batch(detections={f"dificil-0{i}": [True] for i in range(1, 6)})
        assert detection(every, cases).comparable

    def test_problems_no_model_detected(self) -> None:
        first = batch("openai", "a", detections={"dificil-01": [True, False]})
        second = batch("groq", "b", detections={"dificil-01": [False, False]})

        assert never_detected([first, second]) == [("dificil-01", 1)]

    def test_match_sample_is_seeded_and_capped(self) -> None:
        first = batch(
            "openai", "a", detections={f"dificil-0{i}": [True, False] for i in range(1, 6)}
        )
        second = batch("groq", "b", detections={"dificil-01": [False, True]})

        sample = match_sample([first, second], seed=3)

        assert len(sample) == 10
        assert len(set(sample)) == 10
        assert sample == match_sample([second, first], seed=3)
        assert len(match_sample([second], seed=3)) == 2
