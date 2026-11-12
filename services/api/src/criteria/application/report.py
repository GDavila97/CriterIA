"""The numbers of the evaluation report, computed from the batch files and the human session."""

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from criteria.domain.artifacts import CRITERIOS, Criterio
from criteria.domain.eval_metrics import (
    SCALE,
    Agreement,
    Estimate,
    agreement,
    bootstrap,
    common_keys,
    mean,
    percentile,
)
from criteria.domain.eval_sampling import DetectionReport, detection
from criteria.domain.evaluation import (
    DIFICULTADES,
    CaseResult,
    Dificultad,
    EvalBatch,
    EvalCase,
    HumanSession,
)

REPORT_SEED = 20261108


@dataclass(frozen=True)
class DifficultySummary:
    corridas: int
    completas: int
    puntaje_global: float | None


@dataclass(frozen=True)
class CommonScores:
    """Scores over the cases every batch completed, so models compare on the same ground."""

    casos: int
    puntajes: dict[Criterio, float | None]
    puntaje_global: float | None


@dataclass(frozen=True)
class ModelSummary:
    clave: str
    display_name: str
    proveedor: str
    output_mode: str
    juez_mismo_proveedor: bool
    corridas: int
    completas: int
    errores: dict[str, int]
    puntajes: dict[Criterio, float | None]
    puntaje_global: float | None
    validas: int
    llamadas: int
    rondas_media: float | None
    latencia_p50_ms: float | None
    latencia_p95_ms: float | None
    tokens_por_corrida: float | None
    costo_por_corrida: float | None
    costo_gastado_usd: float
    costo_analisis_usd: float
    por_dificultad: dict[Dificultad, DifficultySummary]
    deteccion: DetectionReport
    comunes: CommonScores
    deteccion_comunes: DetectionReport

    @property
    def tasa_validas(self) -> float | None:
        return self.validas / self.llamadas if self.llamadas else None


def _global(result: CaseResult) -> float | None:
    return mean([float(p.valor) for p in result.puntajes]) if result.calificada else None


def _scores(results: Sequence[CaseResult]) -> list[float]:
    return [g for g in (_global(r) for r in results) if g is not None]


def common_cases(batches: Sequence[EvalBatch]) -> frozenset[str]:
    """Cases every batch completed and the judge scored."""
    return common_keys([c for c, r in b.resultados.items() if r.calificada] for b in batches)


def common_matched(batches: Sequence[EvalBatch]) -> frozenset[str]:
    """Hard cases the matcher read in every batch."""
    return common_keys(b.deteccion for b in batches)


def _criteria_means(results: Sequence[CaseResult]) -> dict[Criterio, float | None]:
    return {
        c: mean([float(v) for r in results if (v := r.puntaje(c)) is not None]) for c in CRITERIOS
    }


def summarize_batch(
    batch: EvalBatch,
    cases: Mapping[str, EvalCase],
    common: frozenset[str] = frozenset(),
    common_hard: frozenset[str] = frozenset(),
) -> ModelSummary:
    results = list(batch.resultados.values())
    shared = [r for r in results if r.case_id in common]
    completas = [r for r in results if r.estado == "completada"]
    graded = [r for r in results if r.calificada]
    costs = [r.costo_usd for r in completas if r.costo_usd is not None]
    by_level: dict[Dificultad, DifficultySummary] = {}
    for level in DIFICULTADES:
        mine = [r for r in results if cases[r.case_id].dificultad == level]
        by_level[level] = DifficultySummary(
            corridas=len(mine),
            completas=sum(r.estado == "completada" for r in mine),
            puntaje_global=mean(_scores(mine)),
        )
    validas = sum(r.validas_a_la_primera[0] for r in results)
    llamadas = sum(r.validas_a_la_primera[1] for r in results)
    return ModelSummary(
        clave=batch.clave,
        display_name=batch.display_name,
        proveedor=batch.proveedor,
        output_mode=batch.output_mode,
        juez_mismo_proveedor=batch.juez_mismo_proveedor,
        corridas=len(results),
        completas=len(completas),
        errores=dict(Counter(r.codigo_error for r in results if r.codigo_error)),
        puntajes=_criteria_means(graded),
        puntaje_global=mean(_scores(graded)),
        validas=validas,
        llamadas=llamadas,
        rondas_media=mean([float(r.rondas) for r in completas]),
        latencia_p50_ms=percentile([float(r.latencia_ms) for r in completas], 0.5),
        latencia_p95_ms=percentile([float(r.latencia_ms) for r in completas], 0.95),
        tokens_por_corrida=mean([float(r.tokens_entrada + r.tokens_salida) for r in completas]),
        costo_por_corrida=mean(costs) if len(costs) == len(completas) else None,
        costo_gastado_usd=batch.costo_gastado_usd,
        costo_analisis_usd=batch.costo_analisis_usd,
        por_dificultad=by_level,
        deteccion=detection(batch, cases),
        comunes=CommonScores(
            casos=len(shared),
            puntajes=_criteria_means(shared),
            puntaje_global=mean(_scores(shared)),
        ),
        deteccion_comunes=detection(batch, cases, only=common_hard),
    )


def summarize(batches: Sequence[EvalBatch], cases: Mapping[str, EvalCase]) -> list[ModelSummary]:
    common, common_hard = common_cases(batches), common_matched(batches)
    return [summarize_batch(b, cases, common, common_hard) for b in batches]


@dataclass(frozen=True)
class JudgeAgreement:
    total: Agreement
    por_criterio: dict[Criterio, Agreement]
    # How many pairs got each value of the scale, to see ceiling effects and offsets.
    distribucion_juez: dict[int, int]
    distribucion_humano: dict[int, int]


def judge_pairs(
    session: HumanSession, batches: Sequence[EvalBatch]
) -> list[tuple[Criterio, int, int]]:
    """(criterion, judge, person) for every sampled run and criterion both scored."""
    by_id = {b.batch_id: b for b in batches}
    pairs: list[tuple[Criterio, int, int]] = []
    for score in session.puntajes:
        result = by_id[score.batch_id].resultados.get(score.case_id)
        judge = None if result is None else result.puntaje(score.criterio)
        if judge is not None:
            pairs.append((score.criterio, judge, score.valor))
    return pairs


def _distribution(values: Iterable[int]) -> dict[int, int]:
    counts = Counter(values)
    return {value: counts[value] for value in SCALE}


def judge_agreement(
    pairs: Sequence[tuple[Criterio, int, int]], seed: int = REPORT_SEED
) -> JudgeAgreement | None:
    if not pairs:
        return None
    # The bootstrap resamples by position; a fixed order gives the same intervals from any source.
    pairs = sorted(pairs)
    return JudgeAgreement(
        distribucion_juez=_distribution(j for _, j, _ in pairs),
        distribucion_humano=_distribution(h for _, _, h in pairs),
        total=agreement([j for _, j, _ in pairs], [h for _, _, h in pairs], seed),
        por_criterio={
            c: agreement(
                [j for k, j, _ in pairs if k == c], [h for k, _, h in pairs if k == c], seed
            )
            for c in CRITERIOS
        },
    )


def matcher_agreement(session: HumanSession, seed: int = REPORT_SEED) -> Estimate | None:
    """Share of the matcher's decisions the person confirmed, with its bootstrap interval."""
    checks = [int(c.acierta) for c in session.emparejamientos]
    if not checks:
        return None
    return bootstrap(
        checks,
        [1] * len(checks),
        lambda a, b: mean([float(x == y) for x, y in zip(a, b, strict=True)]),
        seed,
    )
