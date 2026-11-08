import io
import shutil
from pathlib import Path

import psycopg
import pytest

from criteria.adapters.cli.main import Terminal, main
from criteria.adapters.eval.files import JsonBatchStore, JsonSessionStore
from criteria.adapters.postgres.database import create_engine
from criteria.adapters.postgres.evaluation import PostgresEvalPublisher
from criteria.bootstrap import Container
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.evaluation import HumanScore, HumanSession, case_uuid
from tests.adapters.cli.test_cli import FakeContainer, happy
from tests.eval_factories import all_cases, batch, result
from tests.postgres.database import Database

pytestmark = pytest.mark.integration


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
