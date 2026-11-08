"""Asks the judge and the matcher again on inputs they already scored, to measure their stability.

The judge model does not accept a temperature, so its answers can vary between calls; this turns
that limitation into a number.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from criteria.application.analysis import Matcher
from criteria.domain.artifacts import EntregaQA, Evaluacion, Historias, Puntaje, Requerimiento
from criteria.domain.eval_metrics import (
    Estimate,
    bootstrap,
    exact_agreement,
    quadratic_weighted_kappa,
)
from criteria.domain.eval_sampling import matcher_batch, stability_sample
from criteria.domain.evaluation import (
    CaseResult,
    EvalBatch,
    EvalCase,
    RepeticionEmparejador,
    RepeticionJuez,
    StabilityRecord,
)
from criteria.ports.agents import AgentRunner, EntradaEvaluador

REPORT_SEED = 20261108


class StabilityStore(Protocol):
    def save(self, record: StabilityRecord) -> None: ...


def judge_input(case: EvalCase, result: CaseResult) -> EntradaEvaluador:
    """The same input the judge received at the end of the run."""
    a = result.artefactos
    return EntradaEvaluador(
        requerimiento=Requerimiento(texto=case.texto),
        historias=Historias(historias=a.historias),
        entrega=EntregaQA(criterios=a.criterios, casos=a.casos),
        observaciones_pendientes=tuple(o.observacion for o in a.observaciones if not o.se_corrige),
    )


def new_record(batches: Sequence[EvalBatch], seed: int) -> StabilityRecord:
    return StabilityRecord(
        semilla=seed,
        muestra_juez=stability_sample(batches, seed),
        lote_emparejador=matcher_batch(batches, seed),
    )


async def measure(  # noqa: PLR0913  the measurement needs each of these
    record: StabilityRecord,
    batches: Sequence[EvalBatch],
    cases: dict[str, EvalCase],
    *,
    judge: AgentRunner[EntradaEvaluador, Evaluacion],
    matcher: Matcher,
    store: StabilityStore,
    progress: Callable[[str], None] = lambda _message: None,
) -> StabilityRecord:
    """Runs whatever is still missing, saving after each call so it resumes after a cut."""
    by_id = {b.batch_id: b for b in batches}
    done = {(r.batch_id, r.case_id) for r in record.juez}
    for batch_id, case_id in record.muestra_juez:
        if (batch_id, case_id) in done:
            continue
        result = by_id[batch_id].resultados[case_id]
        again = await judge.run(judge_input(cases[case_id], result))
        repetition = RepeticionJuez(
            batch_id=batch_id,
            case_id=case_id,
            original=result.puntajes,
            repetida=again.salida.puntajes,
        )
        record = record.model_copy(
            update={
                "juez": [*record.juez, repetition],
                "costo_usd": round(record.costo_usd + (again.uso.costo_usd or 0.0), 6),
            }
        )
        store.save(record)
        progress(f"juez {len(record.juez)} de {len(record.muestra_juez)}")
    if record.lote_emparejador is None:
        return record
    batch = by_id[record.lote_emparejador]
    matched = {r.case_id for r in record.emparejador}
    for case_id, deteccion in sorted(batch.deteccion.items()):
        if case_id in matched:
            continue
        outcome = await matcher.match(
            cases[case_id], batch.resultados[case_id].artefactos.observaciones
        )
        repetition_m = RepeticionEmparejador(
            case_id=case_id, original=deteccion.detecciones, repetida=outcome.detecciones
        )
        record = record.model_copy(
            update={
                "emparejador": [*record.emparejador, repetition_m],
                "costo_usd": round(record.costo_usd + (outcome.costo_usd or 0.0), 6),
            }
        )
        store.save(record)
        progress(f"emparejador {len(record.emparejador)} de {len(batch.deteccion)}")
    return record


@dataclass(frozen=True)
class SelfAgreement:
    pairs: int
    kappa: Estimate
    exact: Estimate


def _score_map(puntajes: Sequence[Puntaje]) -> dict[str, int]:
    return {p.criterio: p.valor for p in puntajes}


def judge_self_agreement(record: StabilityRecord, seed: int = REPORT_SEED) -> SelfAgreement | None:
    first: list[int] = []
    second: list[int] = []
    for r in record.juez:
        original, again = _score_map(r.original), _score_map(r.repetida)
        for criterio in sorted(original.keys() & again.keys()):
            first.append(original[criterio])
            second.append(again[criterio])
    if not first:
        return None
    return SelfAgreement(
        pairs=len(first),
        kappa=bootstrap(first, second, quadratic_weighted_kappa, seed),
        exact=bootstrap(first, second, exact_agreement, seed),
    )


def matcher_self_agreement(
    record: StabilityRecord, seed: int = REPORT_SEED
) -> SelfAgreement | None:
    first: list[int] = []
    second: list[int] = []
    for r in record.emparejador:
        again = {d.problema: d.detectado for d in r.repetida}
        for d in r.original:
            if d.problema in again:
                first.append(int(d.detectado))
                second.append(int(again[d.problema]))
    if not first:
        return None

    def binary_kappa(a: Sequence[int], b: Sequence[int]) -> float | None:
        return quadratic_weighted_kappa(a, b, scale=(0, 1))

    return SelfAgreement(
        pairs=len(first),
        kappa=bootstrap(first, second, binary_kappa, seed),
        exact=bootstrap(first, second, exact_agreement, seed),
    )
