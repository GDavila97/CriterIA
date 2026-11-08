from pathlib import Path

import pytest

from criteria.adapters.eval.files import (
    EvalFileError,
    JsonBatchStore,
    JsonSessionStore,
    batch_slug,
    git_sha,
    load_batches,
    load_cases,
)
from criteria.config import SERVICE_ROOT
from criteria.domain.evaluation import HumanSession
from tests.eval_factories import batch, result

CASES = SERVICE_ROOT / "eval" / "cases"


class TestCases:
    def test_the_v1_set_has_five_cases_per_difficulty_within_the_limits(self) -> None:
        cases = load_cases(CASES)

        assert len(cases) == 15
        assert {c.dificultad for c in cases} == {"facil", "medio", "dificil"}
        assert all(200 <= len(c.texto) <= 1500 for c in cases)
        hard = [c for c in cases if c.dificultad == "dificil"]
        assert all(len(c.problemas) == 5 for c in hard)
        assert {p.tipo for c in hard for p in c.problemas} == {
            "ambiguedad",
            "inconsistencia",
            "faltante",
        }

    def test_a_subset_by_id_and_unknown_ids(self) -> None:
        assert [c.id for c in load_cases(CASES, ["medio-02", "facil-01"])] == [
            "facil-01",
            "medio-02",
        ]
        with pytest.raises(EvalFileError, match="Unknown cases: medio-09"):
            load_cases(CASES, ["medio-09"])

    def test_broken_or_unbalanced_sets_are_refused(self, tmp_path: Path) -> None:
        (tmp_path / "facil-01.toml").write_text('id = "facil-01"\n', encoding="utf-8")
        with pytest.raises(EvalFileError, match="Invalid evaluation case"):
            load_cases(tmp_path)
        (tmp_path / "facil-01.toml").write_text(
            (CASES / "facil-01.toml").read_text(encoding="utf-8"), encoding="utf-8"
        )
        with pytest.raises(EvalFileError, match="5 cases per difficulty"):
            load_cases(tmp_path)


class TestStores:
    def test_a_batch_survives_the_round_trip(self, tmp_path: Path) -> None:
        store = JsonBatchStore(tmp_path / "v1" / "openai-gpt-6-luna.json")
        assert store.load() is None
        saved = batch(results=[result("facil-01")])

        store.save(saved)

        assert store.load() == saved
        assert list((tmp_path / "v1").glob("*.tmp")) == []
        assert load_batches(tmp_path / "v1") == [saved]

    def test_the_session_lives_next_to_the_batches_and_is_not_a_batch(self, tmp_path: Path) -> None:
        store = JsonSessionStore(tmp_path / "human.json")
        assert store.load() is None
        store.save(HumanSession(semilla=1))
        JsonBatchStore(tmp_path / "groq.json").save(batch("groq", "m"))

        assert store.load() == HumanSession(semilla=1)
        assert [b.proveedor for b in load_batches(tmp_path)] == ["groq"]

    def test_slugs_are_safe_file_names(self) -> None:
        assert batch_slug("groq", "openai/gpt-oss-20b") == "groq-openai-gpt-oss-20b"
        assert batch_slug("ollama", "llama3.1:8b") == "ollama-llama3.1-8b"


class TestGitSha:
    def test_reads_the_commit_of_this_repository(self) -> None:
        sha = git_sha(SERVICE_ROOT)
        assert len(sha.split("+")[0]) == 40

    def test_outside_a_repository_it_says_so(self, tmp_path: Path) -> None:
        assert git_sha(tmp_path) == "desconocido"
