"""Seeded samples for the human checks and the detection rates of seeded problems."""

import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from criteria.domain.artifacts import TipoObservacion
from criteria.domain.evaluation import DIFICULTADES, Dificultad, EvalBatch, EvalCase

RUNS_PER_MODEL = 2
MATCH_CHECKS = 10
STABILITY_RUNS = 10
CASES_PER_DIFFICULTY = 5


def _difficulty(case_id: str) -> Dificultad:
    return next(d for d in DIFICULTADES if case_id.startswith(d))


def judge_sample(
    batches: Sequence[EvalBatch], seed: int, per_model: int = RUNS_PER_MODEL
) -> list[tuple[UUID, str]]:
    """Graded runs to score by hand: per_model per batch, spread over the difficulties.

    Each model walks a seeded cycle of the three difficulties, so its runs never share one and
    the whole sample stays balanced. Cases already taken by another model are avoided when
    possible, and the final order is shuffled so the person cannot tell models apart.
    """
    rng = random.Random(seed)  # noqa: S311  reproducible sample, not security
    cycle = list(DIFICULTADES)
    rng.shuffle(cycle)
    taken: set[str] = set()
    sample: list[tuple[UUID, str]] = []
    position = 0
    for batch in sorted(batches, key=lambda b: b.clave):
        graded = sorted(cid for cid, r in batch.resultados.items() if r.calificada)
        mine: list[str] = []
        for _ in range(per_model):
            wanted = cycle[position % len(cycle)]
            position += 1
            pool = [c for c in graded if c not in mine and _difficulty(c) == wanted] or [
                c for c in graded if c not in mine
            ]
            fresh = [c for c in pool if c not in taken] or pool
            if not fresh:
                break
            choice = rng.choice(fresh)
            mine.append(choice)
            taken.add(choice)
            sample.append((batch.batch_id, choice))
    rng.shuffle(sample)
    return sample


def match_sample(
    batches: Sequence[EvalBatch], seed: int, size: int = MATCH_CHECKS
) -> list[tuple[UUID, str, int]]:
    """Matcher decisions to check by hand, drawn without regard to the model."""
    population = sorted(
        (batch.batch_id, case_id, d.problema)
        for batch in batches
        for case_id, deteccion in batch.deteccion.items()
        for d in deteccion.detecciones
    )
    rng = random.Random(seed)  # noqa: S311  reproducible sample, not security
    return rng.sample(population, min(size, len(population)))


@dataclass(frozen=True)
class DetectionRate:
    detected: int
    total: int

    @property
    def rate(self) -> float | None:
        return self.detected / self.total if self.total else None


@dataclass(frozen=True)
class DetectionReport:
    total: DetectionRate
    by_type: dict[TipoObservacion, DetectionRate]


def detection(batch: EvalBatch, cases: Mapping[str, EvalCase]) -> DetectionReport:
    counts: dict[TipoObservacion, list[int]] = {
        "ambiguedad": [0, 0],
        "inconsistencia": [0, 0],
        "faltante": [0, 0],
    }
    for case_id, deteccion in batch.deteccion.items():
        problemas = cases[case_id].problemas
        for d in deteccion.detecciones:
            tipo = problemas[d.problema].tipo
            counts[tipo][1] += 1
            counts[tipo][0] += int(d.detectado)
    by_type = {tipo: DetectionRate(found, total) for tipo, (found, total) in counts.items()}
    return DetectionReport(
        total=DetectionRate(
            sum(r.detected for r in by_type.values()), sum(r.total for r in by_type.values())
        ),
        by_type=by_type,
    )


def never_detected(batches: Sequence[EvalBatch]) -> list[tuple[str, int]]:
    """Seeded problems that no batch's reviewer caught, among those every batch was matched on."""
    seen: dict[tuple[str, int], list[bool]] = {}
    for batch in batches:
        for case_id, deteccion in batch.deteccion.items():
            for d in deteccion.detecciones:
                seen.setdefault((case_id, d.problema), []).append(d.detectado)
    return sorted(key for key, found in seen.items() if not any(found))


def stability_sample(
    batches: Sequence[EvalBatch], seed: int, size: int = STABILITY_RUNS
) -> list[tuple[UUID, str]]:
    """Graded runs to score again, taken from each batch in turn so every model is represented."""
    rng = random.Random(seed)  # noqa: S311  reproducible sample, not security
    pools: list[tuple[UUID, list[str]]] = []
    for batch in sorted(batches, key=lambda b: b.clave):
        graded = sorted(cid for cid, r in batch.resultados.items() if r.calificada)
        rng.shuffle(graded)
        pools.append((batch.batch_id, graded))
    sample: list[tuple[UUID, str]] = []
    while len(sample) < size and any(pool for _, pool in pools):
        for batch_id, pool in pools:
            if pool and len(sample) < size:
                sample.append((batch_id, pool.pop()))
    return sample


def matcher_batch(batches: Sequence[EvalBatch], seed: int) -> UUID | None:
    """A batch whose five hard runs were all matched, chosen with the seed."""
    complete = sorted(
        (b for b in batches if len(b.deteccion) == CASES_PER_DIFFICULTY), key=lambda b: b.clave
    )
    if not complete:
        return None
    return random.Random(seed).choice(complete).batch_id  # noqa: S311  reproducible choice
