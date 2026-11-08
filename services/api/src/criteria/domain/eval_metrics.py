"""Statistics for the evaluation report, written out so each one can be checked by hand."""

import math
import random
from collections.abc import Callable, Sequence
from dataclasses import dataclass

SCALE = (1, 2, 3, 4, 5)
BOOTSTRAP_SAMPLES = 2000


def mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def percentile(values: Sequence[float], q: float) -> float | None:
    """Linear interpolation between closest ranks, like Postgres percentile_cont."""
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low = math.floor(position)
    high = math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def quadratic_weighted_kappa(
    a: Sequence[int], b: Sequence[int], scale: Sequence[int] = SCALE
) -> float | None:
    """Cohen's kappa with quadratic weights; None when chance agreement explains everything."""
    if len(a) != len(b) or not a:
        return None
    k = len(scale)
    index = {value: i for i, value in enumerate(scale)}
    observed = [[0.0] * k for _ in range(k)]
    for x, y in zip(a, b, strict=True):
        observed[index[x]][index[y]] += 1
    n = len(a)
    rows = [sum(row) for row in observed]
    cols = [sum(observed[i][j] for i in range(k)) for j in range(k)]
    disagreement = expected = 0.0
    for i in range(k):
        for j in range(k):
            weight = (i - j) ** 2 / (k - 1) ** 2
            disagreement += weight * observed[i][j]
            expected += weight * rows[i] * cols[j] / n
    if expected == 0:
        return None
    return 1 - disagreement / expected


def _ranks(values: Sequence[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start
        while end + 1 < len(order) and values[order[end + 1]] == values[order[start]]:
            end += 1
        average = (start + end) / 2 + 1
        for position in range(start, end + 1):
            ranks[order[position]] = average
        start = end + 1
    return ranks


def pearson(a: Sequence[float], b: Sequence[float]) -> float | None:
    if len(a) != len(b) or len(a) < 2:  # noqa: PLR2004
        return None
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b, strict=True))
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va == 0 or vb == 0:
        return None
    return cov / math.sqrt(va * vb)


def spearman(a: Sequence[float], b: Sequence[float]) -> float | None:
    """Pearson correlation of the average ranks, so ties are handled."""
    return pearson(_ranks(a), _ranks(b))


def exact_agreement(a: Sequence[int], b: Sequence[int]) -> float | None:
    return mean([1.0 if x == y else 0.0 for x, y in zip(a, b, strict=True)])


def within_one(a: Sequence[int], b: Sequence[int]) -> float | None:
    return mean([1.0 if abs(x - y) <= 1 else 0.0 for x, y in zip(a, b, strict=True)])


def mean_difference(judge: Sequence[int], human: Sequence[int]) -> float | None:
    """Positive when the judge scores higher than the person."""
    return mean([float(j - h) for j, h in zip(judge, human, strict=True)])


@dataclass(frozen=True)
class Estimate:
    value: float | None
    low: float | None
    high: float | None


Statistic = Callable[[Sequence[int], Sequence[int]], float | None]


def bootstrap(
    a: Sequence[int],
    b: Sequence[int],
    statistic: Statistic,
    seed: int,
    samples: int = BOOTSTRAP_SAMPLES,
) -> Estimate:
    """Percentile 95 % interval from resampling the pairs; undefined resamples are skipped."""
    value = statistic(a, b)
    if not a:
        return Estimate(value, None, None)
    rng = random.Random(seed)  # noqa: S311  reproducible resampling, not security
    n = len(a)
    results: list[float] = []
    for _ in range(samples):
        picks = [rng.randrange(n) for _ in range(n)]
        result = statistic([a[i] for i in picks], [b[i] for i in picks])
        if result is not None:
            results.append(result)
    if not results:
        return Estimate(value, None, None)
    return Estimate(value, percentile(results, 0.025), percentile(results, 0.975))


@dataclass(frozen=True)
class Agreement:
    pairs: int
    kappa: Estimate
    spearman: Estimate
    exact: Estimate
    within_one: Estimate
    judge_minus_human: Estimate


def agreement(judge: Sequence[int], human: Sequence[int], seed: int) -> Agreement:
    return Agreement(
        pairs=len(judge),
        kappa=bootstrap(judge, human, quadratic_weighted_kappa, seed),
        spearman=bootstrap(judge, human, spearman, seed),
        exact=bootstrap(judge, human, exact_agreement, seed),
        within_one=bootstrap(judge, human, within_one, seed),
        judge_minus_human=bootstrap(judge, human, mean_difference, seed),
    )
