"""Post-hoc analysis of finished batches: the matcher of seeded problems and the human session.

Neither takes part in a run or in the rubric; they only read what the batches already hold.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from criteria.domain.artifacts import CRITERIOS, Criterio
from criteria.domain.eval_sampling import judge_sample, match_sample
from criteria.domain.evaluation import (
    Deteccion,
    DeteccionCaso,
    EvalBatch,
    EvalCase,
    HumanScore,
    HumanSession,
    MatchCheck,
    ObservacionEnRonda,
)


@dataclass(frozen=True)
class MatchOutcome:
    detecciones: list[Deteccion]
    costo_usd: float | None


class Matcher(Protocol):
    async def match(
        self, caso: EvalCase, observaciones: Sequence[ObservacionEnRonda]
    ) -> MatchOutcome: ...


class BatchStore(Protocol):
    def save(self, batch: EvalBatch) -> None: ...


async def match_batch(  # noqa: PLR0913  the analysis needs each of these
    batch: EvalBatch,
    cases: dict[str, EvalCase],
    *,
    matcher: Matcher,
    store: BatchStore,
    matcher_model: str,
    matcher_version: str,
    progress: Callable[[str], None] = lambda _message: None,
) -> EvalBatch:
    """Matches every completed hard run not matched yet; saved after each case so it resumes."""
    for case_id, result in sorted(batch.resultados.items()):
        case = cases[case_id]
        if not case.problemas or result.estado != "completada" or case_id in batch.deteccion:
            continue
        outcome = await matcher.match(case, result.artefactos.observaciones)
        batch = batch.model_copy(
            update={
                "deteccion": {
                    **batch.deteccion,
                    case_id: DeteccionCaso(
                        case_id=case_id,
                        matcher_model=matcher_model,
                        matcher_version=matcher_version,
                        detecciones=outcome.detecciones,
                    ),
                },
                "costo_analisis_usd": round(
                    batch.costo_analisis_usd + (outcome.costo_usd or 0.0), 6
                ),
            }
        )
        store.save(batch)
        found = sum(d.detectado for d in outcome.detecciones)
        progress(f"{batch.clave} · {case_id}: {found} de {len(outcome.detecciones)} detectados")
    return batch


def new_session(batches: Sequence[EvalBatch], seed: int) -> HumanSession:
    return HumanSession(
        semilla=seed,
        muestra=judge_sample(batches, seed),
        revisiones_emparejador=match_sample(batches, seed),
    )


@dataclass(frozen=True)
class PendingScore:
    numero: int
    total: int
    batch_id: UUID
    case_id: str
    criterios: tuple[Criterio, ...]


@dataclass(frozen=True)
class PendingCheck:
    numero: int
    total: int
    batch_id: UUID
    case_id: str
    problema: int


def next_score(session: HumanSession) -> PendingScore | None:
    """The first sampled run with a criterion still unscored, with the criteria it lacks."""
    for numero, (batch_id, case_id) in enumerate(session.muestra, start=1):
        done = {
            s.criterio for s in session.puntajes if (s.batch_id, s.case_id) == (batch_id, case_id)
        }
        missing = tuple(c for c in CRITERIOS if c not in done)
        if missing:
            return PendingScore(numero, len(session.muestra), batch_id, case_id, missing)
    return None


def next_check(session: HumanSession) -> PendingCheck | None:
    done = {(c.batch_id, c.case_id, c.problema) for c in session.emparejamientos}
    for numero, item in enumerate(session.revisiones_emparejador, start=1):
        if item not in done:
            batch_id, case_id, problema = item
            return PendingCheck(
                numero, len(session.revisiones_emparejador), batch_id, case_id, problema
            )
    return None


def with_score(
    session: HumanSession, batch_id: UUID, case_id: str, criterio: Criterio, valor: int
) -> HumanSession:
    score = HumanScore(batch_id=batch_id, case_id=case_id, criterio=criterio, valor=valor)
    return session.model_copy(update={"puntajes": [*session.puntajes, score]})


def with_check(
    session: HumanSession, batch_id: UUID, case_id: str, problema: int, acierta: bool
) -> HumanSession:
    check = MatchCheck(batch_id=batch_id, case_id=case_id, problema=problema, acierta=acierta)
    return session.model_copy(update={"emparejamientos": [*session.emparejamientos, check]})
