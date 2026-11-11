import io
import shutil
from pathlib import Path

import psycopg
import pytest

from criteria.adapters.cli.main import Terminal, main
from criteria.adapters.eval.files import JsonBatchStore, JsonSessionStore
from criteria.adapters.postgres.database import create_engine
from criteria.adapters.postgres.evaluation import PostgresEvalPublisher
from criteria.adapters.postgres.stores import PostgresEvaluationReader
from criteria.bootstrap import Container
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.artifacts import Criterio
from criteria.domain.evaluation import HumanScore, HumanSession, case_uuid
from tests.adapters.cli.test_cli import FakeContainer, happy
from tests.eval_factories import all_cases, batch, result
from tests.postgres.database import Database

pytestmark = pytest.mark.integration

SCORED: list[tuple[Criterio, int]] = [("claridad", 4), ("verificabilidad", 3), ("completitud", 3)]


async def test_publishing_twice_inserts_each_row_once_as_eval_writer(database: Database) -> None:
    engine = create_engine(database.eval_writer, pool_size=2)
    publisher = PostgresEvalPublisher(engine)
    published = batch(
        "groq",
        "openai/gpt-oss-20b",
        [result("facil-01"), result("dificil-01", estado="error", scores=None, validas=3)],
        detections={"dificil-01": [True, False]},
    )
    session = HumanSession(
        semilla=1,
        puntajes=[
            HumanScore(
                batch_id=published.batch_id, case_id="facil-01", criterio="claridad", valor=4
            )
        ],
    )
    try:
        first = await publisher.publish(published, all_cases())
        again = await publisher.publish(published, all_cases())
        human = [await publisher.publish_human(session), await publisher.publish_human(session)]
    finally:
        await engine.dispose()

    assert (first.cases, first.batches, first.results) == (2, 1, 2)
    assert (again.cases, again.batches, again.results) == (0, 0, 0)
    assert human == [1, 0]
    with psycopg.connect(database.admin) as conn:
        row = conn.execute(
            "SELECT b.display_name, b.judge_same_provider, b.settings->>'max_rondas', "
            "r.completed, r.error_code, r.valid_output, r.details->>'llamadas', "
            "r.details->'deteccion'->>'matcher_version' "
            "FROM app.eval_result r JOIN app.eval_batch b ON b.id = r.batch_id "
            "WHERE r.case_id = %s",
            (case_uuid("dificil-01"),),
        ).fetchone()
        case = conn.execute(
            "SELECT domain, jsonb_array_length(seeded_problems) FROM app.eval_case WHERE id = %s",
            (case_uuid("dificil-01"),),
        ).fetchone()
    assert row == ("openai/gpt-oss-20b", False, "2", False, "salida_invalida", False, "4", "v1")
    assert case == ("pruebas", 2)


def test_the_cli_publishes_a_batch_file_and_the_human_session(
    database: Database, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    shutil.copytree(SERVICE_ROOT / "eval" / "cases", tmp_path / "cases")
    results = tmp_path / "results" / "v1"
    published = batch("openai", "gpt-6-luna", [result("medio-03")])
    JsonBatchStore(results / "openai.json").save(published)
    JsonSessionStore(results / "human.json").save(
        HumanSession(
            semilla=1,
            puntajes=[
                HumanScore(batch_id=published.batch_id, case_id="medio-03", criterio=c, valor=3)
                for c in ("claridad", "consistencia")
            ],
        )
    )
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("EVAL_DIR", str(tmp_path))
    monkeypatch.setenv("EVAL_DATABASE_URL", database.eval_writer)
    err = io.StringIO()
    terminal = Terminal(read=lambda _p: "", out=io.StringIO(), err=err, edit=lambda _p: None)

    def factory(settings: Settings) -> Container:
        return FakeContainer(settings, happy())

    batch_code = main(
        ["eval", "publish", "--file", str(results / "openai.json")], factory, terminal
    )
    human_code = main(["eval", "publish", "--human"], factory, terminal)

    assert (batch_code, human_code) == (0, 0)
    assert "openai:gpt-6-luna: 1 casos, 1 lote y 1 resultados nuevos." in err.getvalue()
    assert "Puntajes humanos nuevos: 2." in err.getvalue()


async def test_the_board_shows_published_batches_with_the_judge_agreement(
    database: Database,
) -> None:
    engine = create_engine(database.eval_writer, pool_size=2)
    published = batch(
        "anthropic",
        "claude-haiku-5-5",
        [
            result("medio-05", scores=(4, 4, 3, 5)),
            result("facil-05", scores=(2, 2, 2, 2), validas=2),
        ],
    )
    session = HumanSession(
        semilla=1,
        puntajes=[
            HumanScore(batch_id=published.batch_id, case_id="medio-05", criterio=c, valor=v)
            for c, v in SCORED
        ],
    )
    try:
        await PostgresEvalPublisher(engine).publish(published, all_cases())
        await PostgresEvalPublisher(engine).publish_human(session)
    finally:
        await engine.dispose()
    reader_engine = create_engine(database.api, pool_size=2)
    try:
        reader = PostgresEvaluationReader(reader_engine)
        lotes = {b["id"]: b for b in await reader.batches()}
        pairs = await reader.judge_pairs()
    finally:
        await reader_engine.dispose()

    lote = lotes[published.batch_id]
    assert lote["display_name"] == "claude-haiku-5-5"
    assert lote["judge_same_provider"] is True
    assert (lote["cases"], lote["completed"]) == (2, 2)
    assert lote["valid_rate"] == pytest.approx(6 / 8)
    assert lote["score_mean"] == pytest.approx((4.0 + 2.0) / 2)
    assert sorted(p for p in pairs if p[0] in {"claridad", "verificabilidad", "completitud"})[
        -3:
    ] == [("claridad", 4, 4), ("completitud", 3, 3), ("verificabilidad", 4, 3)]


async def test_each_batch_also_scores_on_the_cases_every_batch_of_its_version_completed(
    database: Database,
) -> None:
    complete = batch(
        "anthropic",
        "comun-a",
        [result("medio-05", scores=(4, 4, 4, 4)), result("facil-05", scores=(2, 2, 2, 2))],
    )
    partial = batch(
        "ollama",
        "comun-b",
        [result("medio-05", scores=(3, 3, 3, 3)), result("facil-05", estado="error", scores=None)],
    )
    other_version = batch("groq", "comun-c", [result("facil-01")])
    engine = create_engine(database.eval_writer, pool_size=2)
    try:
        for published in (complete, partial):
            await PostgresEvalPublisher(engine).publish(
                published.model_copy(update={"version_prompts": "v7"}), all_cases()
            )
        await PostgresEvalPublisher(engine).publish(
            other_version.model_copy(update={"version_prompts": "v8"}), all_cases()
        )
    finally:
        await engine.dispose()
    reader_engine = create_engine(database.api, pool_size=2)
    try:
        lotes = {b["id"]: b for b in await PostgresEvaluationReader(reader_engine).batches()}
    finally:
        await reader_engine.dispose()

    a, b, c = (lotes[x.batch_id] for x in (complete, partial, other_version))
    assert (a["score_mean"], a["common_cases"], a["score_mean_common"]) == (3.0, 1, 4.0)
    assert (b["common_cases"], b["score_mean_common"]) == (1, 3.0)
    assert (c["common_cases"], c["score_mean_common"]) == (1, 4.0)
