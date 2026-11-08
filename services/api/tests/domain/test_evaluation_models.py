import pytest
from pydantic import ValidationError

from criteria.domain.evaluation import EvalCase, case_uuid, row_uuid
from tests.eval_factories import TEXT, batch, case, result


def test_only_hard_cases_carry_seeded_problems_and_ids_match_difficulty() -> None:
    with pytest.raises(ValidationError, match="only the hard cases"):
        case("facil-01", problems=1)
    with pytest.raises(ValidationError, match="only the hard cases"):
        case("dificil-01", problems=0)
    with pytest.raises(ValidationError, match="must start with its difficulty"):
        EvalCase(id="medio-01", titulo="Caso", dificultad="facil", dominio="x" * 3, texto=TEXT)


def test_scores_by_criterion_and_whether_a_run_was_graded() -> None:
    graded = result("facil-01")
    assert graded.puntaje("completitud") == 3
    assert graded.calificada is True
    ungraded = result("facil-01", scores=None)
    assert ungraded.puntaje("claridad") is None
    assert ungraded.calificada is False


def test_ids_are_stable_so_publishing_twice_finds_the_same_rows() -> None:
    first = batch()
    assert case_uuid("facil-01") == case_uuid("facil-01") != case_uuid("facil-02")
    assert row_uuid(first.batch_id, "result", "facil-01") == row_uuid(
        first.batch_id, "result", "facil-01"
    )
    assert first.clave == "openai:gpt-6-luna"
    assert first.etiqueta_juez == "anthropic:claude-haiku-5-5"
