import math

import pytest

from criteria.domain.eval_metrics import (
    agreement,
    bootstrap,
    common_keys,
    exact_agreement,
    mean,
    mean_difference,
    percentile,
    quadratic_weighted_kappa,
    spearman,
    within_one,
)

JUDGE = [1, 2, 3, 4, 5]
HUMAN = [1, 2, 3, 4, 4]


class TestHandComputedValues:
    def test_quadratic_weighted_kappa(self) -> None:
        # Observed disagreement 1/16; expected 85/80 from the margins; kappa = 1 - 1/17.
        assert quadratic_weighted_kappa(JUDGE, HUMAN) == pytest.approx(16 / 17)

    def test_kappa_is_one_for_identical_scores_and_undefined_without_spread(self) -> None:
        assert quadratic_weighted_kappa(JUDGE, JUDGE) == pytest.approx(1.0)
        assert quadratic_weighted_kappa([3, 3], [3, 3]) is None
        assert quadratic_weighted_kappa([], []) is None

    def test_kappa_is_negative_when_scores_run_opposite(self) -> None:
        kappa = quadratic_weighted_kappa([1, 5], [5, 1])
        assert kappa is not None
        assert kappa < 0

    def test_spearman_averages_tied_ranks(self) -> None:
        # Ranks of HUMAN are 1, 2, 3, 4.5, 4.5: r = 9.5 / sqrt(10 * 9.5) = sqrt(0.95).
        assert spearman(JUDGE, HUMAN) == pytest.approx(math.sqrt(0.95))
        assert spearman([1, 1], [2, 3]) is None
        assert spearman([1], [1]) is None

    def test_agreement_rates_and_direction(self) -> None:
        assert exact_agreement(JUDGE, HUMAN) == pytest.approx(0.8)
        assert within_one(JUDGE, [3, 2, 3, 4, 5]) == pytest.approx(0.8)
        assert mean_difference(JUDGE, HUMAN) == pytest.approx(0.2)

    def test_percentile_interpolates_like_postgres(self) -> None:
        assert percentile([4, 1, 3, 2], 0.5) == pytest.approx(2.5)
        assert percentile([1, 2, 3, 4], 0.95) == pytest.approx(3.85)
        assert percentile([], 0.5) is None
        assert mean([]) is None


class TestBootstrap:
    def test_a_constant_statistic_has_a_point_interval(self) -> None:
        estimate = bootstrap([1, 2, 3], [1, 2, 3], exact_agreement, seed=7)
        assert (estimate.value, estimate.low, estimate.high) == (1.0, 1.0, 1.0)

    def test_two_pairs_give_the_hand_computed_interval(self) -> None:
        # Differences 0 and 2: resampled means are 0, 1 or 2 with chance 1/4, 1/2 and 1/4,
        # so the 2.5th and 97.5th percentiles land on 0 and 2.
        estimate = bootstrap([1, 3], [1, 1], mean_difference, seed=11)
        assert estimate.value == pytest.approx(1.0)
        assert (estimate.low, estimate.high) == (0.0, 2.0)

    def test_same_seed_same_interval_and_empty_input(self) -> None:
        first = bootstrap(JUDGE, HUMAN, quadratic_weighted_kappa, seed=3)
        assert first == bootstrap(JUDGE, HUMAN, quadratic_weighted_kappa, seed=3)
        assert first.low is not None
        assert first.high is not None
        assert first.low <= (first.value or 0) <= first.high
        assert bootstrap([], [], exact_agreement, seed=3).low is None

    def test_undefined_resamples_leave_no_interval(self) -> None:
        estimate = bootstrap([3, 3], [3, 3], quadratic_weighted_kappa, seed=1, samples=50)
        assert (estimate.value, estimate.low, estimate.high) == (None, None, None)

    def test_agreement_bundles_every_statistic(self) -> None:
        result = agreement(JUDGE, HUMAN, seed=5)
        assert result.pairs == 5
        assert result.kappa.value == pytest.approx(16 / 17)
        assert result.judge_minus_human.value == pytest.approx(0.2)


def test_common_keys_are_those_every_group_has() -> None:
    assert common_keys([{"a", "b"}, ["b", "c", "a"]]) == frozenset({"a", "b"})
    assert common_keys([]) == frozenset()
