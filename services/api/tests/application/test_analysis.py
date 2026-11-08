from collections.abc import Sequence

import pytest

from criteria.application.analysis import (
    MatchOutcome,
    match_batch,
    new_session,
    next_check,
    next_score,
    with_check,
    with_score,
)
from criteria.domain.artifacts import CRITERIOS
from criteria.domain.evaluation import Deteccion, EvalBatch, EvalCase, ObservacionEnRonda
from tests.eval_factories import all_cases, batch, full_batch, result


class FakeMatcher:
    def __init__(self) -> None:
        self.seen: list[str] = []

    async def match(
        self, caso: EvalCase, observaciones: Sequence[ObservacionEnRonda]
    ) -> MatchOutcome:
        self.seen.append(caso.id)
        return MatchOutcome(
            detecciones=[
                Deteccion(
                    problema=i,
                    detectado=i == 0,
                    observacion=0 if i == 0 else None,
                    justificacion="x",
                )
                for i in range(len(caso.problemas))
            ],
            costo_usd=0.001,
        )


class MemoryStore:
    def __init__(self) -> None:
        self.saved: list[EvalBatch] = []

    def save(self, batch: EvalBatch) -> None:
        self.saved.append(batch)


class TestMatchBatch:
    async def test_matches_only_completed_hard_runs_and_resumes(self) -> None:
        cases = all_cases()
        started = batch(
            results=[
                result("facil-01"),
                result("dificil-01"),
                result("dificil-02", estado="error", scores=None),
                result("dificil-03"),
            ],
            detections={"dificil-03": [True, True]},
        )
        matcher, store = FakeMatcher(), MemoryStore()

        done = await match_batch(
            started,
            cases,
            matcher=matcher,
            store=store,
            matcher_model="anthropic:claude-haiku-5-5",
            matcher_version="v1",
        )

        assert matcher.seen == ["dificil-01"]
        assert [d.detectado for d in done.deteccion["dificil-01"].detecciones] == [True, False]
        assert done.deteccion["dificil-03"] == started.deteccion["dificil-03"]
        assert done.costo_analisis_usd == pytest.approx(0.001)
        assert done.costo_gastado_usd == started.costo_gastado_usd
        assert store.saved == [done]


class TestHumanSession:
    def test_scores_then_checks_until_done(self) -> None:
        batches = [
            full_batch("openai", "a"),
            full_batch("groq", "b").model_copy(
                update={"deteccion": batch(detections={"dificil-01": [True]}).deteccion}
            ),
        ]
        session = new_session(batches, seed=9)
        assert len(session.muestra) == 4
        assert session.revisiones_emparejador == [(batches[1].batch_id, "dificil-01", 0)]

        pending = next_score(session)
        assert pending is not None
        assert (pending.numero, pending.total, pending.criterios) == (1, 4, CRITERIOS)
        session = with_score(session, pending.batch_id, pending.case_id, "claridad", 3)
        again = next_score(session)
        assert again is not None
        assert again.criterios == CRITERIOS[1:]

        for batch_id, case_id in session.muestra:
            for criterio in CRITERIOS:
                if not any(
                    (s.batch_id, s.case_id, s.criterio) == (batch_id, case_id, criterio)
                    for s in session.puntajes
                ):
                    session = with_score(session, batch_id, case_id, criterio, 4)
        assert next_score(session) is None
        assert len(session.puntajes) == 16

        check = next_check(session)
        assert check is not None
        assert (check.numero, check.total, check.problema) == (1, 1, 0)
        session = with_check(session, check.batch_id, check.case_id, check.problema, acierta=True)
        assert next_check(session) is None
        assert session.emparejamientos[0].acierta is True
