import io
import shutil
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import ClassVar

import pytest
from pydantic_ai import ModelHTTPError

from criteria.adapters.cli import evaluation as cli_eval
from criteria.adapters.cli.main import EXIT_OK, EXIT_USAGE, Terminal, main
from criteria.adapters.eval.files import JsonBatchStore, JsonSessionStore, JsonStabilityStore
from criteria.adapters.eval.ollama import OllamaProbeError, OllamaStatus
from criteria.application.analysis import MatchOutcome
from criteria.bootstrap import Container
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.evaluation import Deteccion, EvalCase, HumanSession, ObservacionEnRonda
from tests import factories as f
from tests.adapters.cli.test_cli import FakeContainer
from tests.agent_models import ScriptedTeam, team
from tests.eval_factories import batch, result

ALL_CASES = [f"{d}-{n:02d}" for d in ("facil", "medio", "dificil") for n in range(1, 6)]


@pytest.fixture
def eval_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    shutil.copytree(SERVICE_ROOT / "eval" / "cases", tmp_path / "cases")
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("SERVER_KEY_PROVIDERS", "openai,anthropic,groq")
    for name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY"):
        monkeypatch.setenv(name, "unused-in-tests")
    monkeypatch.setenv("EVAL_DIR", str(tmp_path))
    return tmp_path


def reviewer_team() -> ScriptedTeam:
    return team(
        analista=[f.historias(1)],
        qa=[f.entrega_qa(1)],
        revisor=[f.veredicto(f.observacion()), f.veredicto()],
        evaluador=[f.evaluacion(3)],
    )


def run(
    argv: list[str], read: Callable[[str], str] = lambda _prompt: ""
) -> tuple[int, str, FakeContainer | None]:
    err = io.StringIO()
    holder: list[FakeContainer] = []

    def factory(settings: Settings) -> Container:
        holder.append(FakeContainer(settings, reviewer_team()))
        return holder[0]

    terminal = Terminal(read=read, out=io.StringIO(), err=err, edit=lambda _path: None)
    code = main(argv, container_factory=factory, terminal=terminal)
    return code, err.getvalue(), holder[0] if holder else None


def stored(eval_dir: Path, name: str) -> JsonBatchStore:
    return JsonBatchStore(eval_dir / "results" / "v1" / name)


class TestEvalRun:
    def test_runs_the_chosen_cases_with_the_fixed_judge_and_resumes(self, eval_dir: Path) -> None:
        code, err, container = run(
            ["eval", "run", "--provider", "openai", "--model", "gpt-6-luna", "--cases", "facil-01"]
        )

        assert code == EXIT_OK
        saved = stored(eval_dir, "openai-gpt-6-luna.json").load()
        assert saved is not None
        assert list(saved.resultados) == ["facil-01"]
        assert saved.resultados["facil-01"].rondas == 1
        assert (saved.display_name, saved.juez_modelo, saved.juez_mismo_proveedor) == (
            "GPT-6 Luna",
            "claude-haiku-5-5",
            False,
        )
        assert (saved.temperatura, saved.temperatura_juez, saved.ollama) == (0.2, 0.0, None)
        assert saved.max_tokens == 16384
        assert saved.parametros_ignorados == []
        assert container is not None
        generacion, juez = container.selections[0]
        assert (generacion.temperatura, juez.etiqueta, juez.temperatura) == (
            0.2,
            "anthropic:claude-haiku-5-5",
            0.0,
        )
        assert "Costo real del lote" in err

        code, err, _ = run(
            [
                "eval",
                "run",
                "--provider",
                "openai",
                "--model",
                "gpt-6-luna",
                "--cases",
                "facil-01",
                "medio-01",
            ]
        )
        assert code == EXIT_OK
        assert "facil-01: ya estaba completo, se salta" in err
        again = stored(eval_dir, "openai-gpt-6-luna.json").load()
        assert again is not None
        assert sorted(again.resultados) == ["facil-01", "medio-01"]
        assert again.batch_id == saved.batch_id

    def test_the_haiku_batch_is_marked_as_judged_by_its_own_provider(self, eval_dir: Path) -> None:
        code, _, _ = run(
            [
                "eval",
                "run",
                "--provider",
                "anthropic",
                "--model",
                "claude-haiku-5-5",
                "--cases",
                "facil-02",
            ]
        )

        assert code == EXIT_OK
        saved = stored(eval_dir, "anthropic-claude-haiku-5-5.json").load()
        assert saved is not None
        assert saved.juez_mismo_proveedor is True

    def test_a_saved_batch_with_another_configuration_is_not_mixed(self, eval_dir: Path) -> None:
        store = stored(eval_dir, "openai-gpt-6-luna.json")
        store.save(batch().model_copy(update={"version_juez": "v2"}))

        code, err, _ = run(["eval", "run", "--provider", "openai", "--model", "gpt-6-luna"])

        assert code == EXIT_USAGE
        assert "no coincide en: version_juez" in err

    def test_the_judge_needs_its_key(self, eval_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SERVER_KEY_PROVIDERS", "openai")

        code, err, _ = run(["eval", "run", "--provider", "openai", "--model", "gpt-6-luna"])

        assert code == EXIT_USAGE
        assert "anthropic necesita su clave" in err

    def test_an_ollama_batch_needs_the_server_configuration_first(
        self, eval_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SERVER_KEY_PROVIDERS", "anthropic,ollama")
        monkeypatch.setenv("OLLAMA_BASE_URL", "http://192.168.1.50:11434")

        code, err, _ = run(["eval", "run", "--provider", "ollama", "--model", "llama3.1:8b"])

        assert code == EXIT_USAGE
        assert "--ollama-context" in err

    def test_unknown_cases_are_reported(self, eval_dir: Path) -> None:
        code, err, _ = run(
            ["eval", "run", "--provider", "openai", "--model", "gpt-6-luna", "--cases", "facil-09"]
        )

        assert code == EXIT_USAGE
        assert "Unknown cases: facil-09" in err


class TestOllamaAndStops:
    @pytest.fixture
    def local(self, monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
        monkeypatch.setenv("SERVER_KEY_PROVIDERS", "anthropic,ollama")
        monkeypatch.setenv("OLLAMA_BASE_URL", "http://192.168.1.50:11434/v1")
        return monkeypatch

    LOCAL: ClassVar[list[str]] = [
        "eval",
        "run",
        "--provider",
        "ollama",
        "--model",
        "llama3.1:8b",
        "--cases",
        "facil-01",
        "--ollama-context",
        "16384",
        "--ollama-flash-attention",
        "1",
        "--ollama-kv-cache",
        "q8_0",
    ]

    def test_a_local_batch_records_the_server_and_needs_the_whole_model_on_the_gpu(
        self, eval_dir: Path, local: pytest.MonkeyPatch
    ) -> None:
        seen: list[tuple[str, str]] = []

        async def full(base_url: str, model: str) -> OllamaStatus:
            seen.append((base_url, model))
            return OllamaStatus(version="0.40.14", gpu_percent=100.0, context_length=16384)

        local.setattr(cli_eval, "probe", full)
        code, err, _ = run(self.LOCAL)

        assert code == EXIT_OK
        assert seen == [("http://192.168.1.50:11434/v1", "llama3.1:8b")]
        assert "al 100 % en la GPU" in err
        saved = stored(eval_dir, "ollama-llama3.1-8b.json").load()
        assert saved is not None
        assert saved.ollama is not None
        assert (saved.ollama.context_length, saved.ollama.flash_attention) == (16384, True)
        assert (saved.ollama.kv_cache_type, saved.output_mode) == ("q8_0", "native")

    def test_a_partial_gpu_load_or_an_unreachable_server_stops_before_any_run(
        self, eval_dir: Path, local: pytest.MonkeyPatch
    ) -> None:
        async def partial(_base_url: str, _model: str) -> OllamaStatus:
            return OllamaStatus(version="0.40.14", gpu_percent=80.0, context_length=None)

        async def down(_base_url: str, _model: str) -> OllamaStatus:
            raise OllamaProbeError("Ollama did not answer as expected: ConnectError")

        local.setattr(cli_eval, "probe", partial)
        code, err, _ = run(self.LOCAL)
        assert code == EXIT_USAGE
        assert "no quedó completo en la GPU (80 %)" in err

        local.setattr(cli_eval, "probe", down)
        code, err, _ = run(self.LOCAL)
        assert code == EXIT_USAGE
        assert "did not answer" in err
        assert stored(eval_dir, "ollama-llama3.1-8b.json").load() is None

    def test_a_local_batch_needs_the_ollama_url(
        self, eval_dir: Path, local: pytest.MonkeyPatch
    ) -> None:
        local.setenv("SERVER_KEY_PROVIDERS", "anthropic")
        local.delenv("OLLAMA_BASE_URL")

        code, err, _ = run(self.LOCAL)

        assert code == EXIT_USAGE
        assert "ollama" in err

    def test_an_account_failure_stops_the_batch_and_a_new_commit_is_noted(
        self, eval_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        stored(eval_dir, "openai-gpt-6-luna.json").save(
            batch().model_copy(update={"git_sha": "viejo"})
        )
        failing = team(analista=[ModelHTTPError(401, "m")], qa=[], revisor=[], evaluador=[])
        monkeypatch.setattr(sys.modules[__name__], "reviewer_team", lambda: failing)

        code, err, _ = run(
            ["eval", "run", "--provider", "openai", "--model", "gpt-6-luna", "--cases", "medio-02"]
        )

        assert code == 1
        assert "el lote empezó en viejo" in err
        assert "Lote detenido en medio-02 por clave_invalida" in err


class FakeMatcher:
    def __init__(self, *_args: object) -> None:
        pass

    async def match(
        self, caso: EvalCase, observaciones: Sequence[ObservacionEnRonda]
    ) -> MatchOutcome:
        return MatchOutcome(
            [
                Deteccion(problema=i, detectado=False, justificacion="Ninguna lo cubre.")
                for i in range(len(caso.problemas))
            ],
            0.0005,
        )


class TestEvalMatch:
    def test_matches_the_hard_runs_of_every_batch(
        self, eval_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(cli_eval, "ModelMatcher", FakeMatcher)
        store = stored(eval_dir, "groq-openai-gpt-oss-20b.json")
        store.save(batch("groq", "openai/gpt-oss-20b", [result("dificil-01"), result("facil-01")]))
        JsonSessionStore(eval_dir / "results" / "v1" / "human.json").save(HumanSession(semilla=1))

        code, err, _ = run(["eval", "match"])

        assert code == EXIT_OK
        matched = store.load()
        assert matched is not None
        assert list(matched.deteccion) == ["dificil-01"]
        assert len(matched.deteccion["dificil-01"].detecciones) == 5
        assert "costo del emparejador US$ 0.0005" in err

    def test_a_missing_file_is_reported(
        self, eval_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(cli_eval, "ModelMatcher", FakeMatcher)

        code, err, _ = run(["eval", "match", "--file", str(eval_dir / "nada.json")])

        assert code == EXIT_USAGE
        assert "No existe" in err


def answers(score: str = "4") -> Callable[[str], str]:
    def read(prompt: str) -> str:
        if prompt.startswith("--"):
            return "q"
        return score if prompt.startswith("Puntaje") else "s"

    return read


class TestEvalScore:
    def seed_batches(self, eval_dir: Path) -> None:
        for provider, model in (("openai", "gpt-6-luna"), ("groq", "openai/gpt-oss-20b")):
            full = batch(
                provider,  # type: ignore[arg-type]
                model,
                [result(c) for c in ALL_CASES],
                detections={"dificil-01": [True, False, False, False, False]},
            )
            stored(eval_dir, f"{provider}.json").save(full)

    def test_scores_blind_pauses_and_resumes(self, eval_dir: Path) -> None:
        self.seed_batches(eval_dir)
        pause_at_first: Callable[[str], str] = lambda prompt: "p"  # noqa: E731

        code, err, _ = run(["eval", "score"], pause_at_first)

        assert code == EXIT_OK
        assert "Sesión pausada" in err
        session_store = JsonSessionStore(eval_dir / "results" / "v1" / "human.json")
        paused = session_store.load()
        assert paused is not None
        assert (len(paused.muestra), paused.puntajes) == (4, [])

        code, err, _ = run(["eval", "score"], answers())

        assert code == EXIT_OK
        done = session_store.load()
        assert done is not None
        assert len(done.puntajes) == 16
        assert len(done.emparejamientos) == 10
        assert all(c.acierta for c in done.emparejamientos)
        assert "Sesión completa: 16 puntajes y 10 emparejamientos revisados." in err
        # Neither the model nor the judge's justification reach the screen; the matcher's does.
        for hidden in ("gpt-6-luna", "gpt-oss", "groq", "openai", "Simulada"):
            assert hidden not in err
        assert "Justificación del emparejador" in err

    def test_invalid_answers_are_asked_again(self, eval_dir: Path) -> None:
        self.seed_batches(eval_dir)
        replies = iter(["9", "p"])

        code, err, _ = run(
            ["eval", "score"], lambda prompt: "q" if prompt.startswith("--") else next(replies)
        )

        assert code == EXIT_OK
        assert "Respuesta no válida." in err


class TestEvalReportAndStability:
    def test_writes_tables_json_and_the_chart(self, eval_dir: Path) -> None:
        TestEvalScore().seed_batches(eval_dir)
        chart_dir = eval_dir / "grafica"

        code, err, _ = run(["eval", "report", "--chart", str(chart_dir)])

        assert code == EXIT_OK
        results = eval_dir / "results" / "v1"
        assert "## Resultados por modelo" in (results / "tablas.md").read_text(encoding="utf-8")
        assert '"modelos"' in (results / "reporte.json").read_text(encoding="utf-8")
        assert (chart_dir / "criterios-v1.svg").read_text(encoding="utf-8").startswith("<svg")
        assert "Reporte en" in err

    def test_a_report_needs_batches(self, eval_dir: Path) -> None:
        code, err, _ = run(["eval", "report", "--chart", str(eval_dir / "g")])
        assert code == EXIT_USAGE
        assert "Todavía no hay lotes." in err

    def test_stability_asks_the_judge_and_the_matcher_again_and_resumes(
        self, eval_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(cli_eval, "ModelMatcher", FakeMatcher)
        TestEvalScore().seed_batches(eval_dir)
        store = stored(eval_dir, "openai.json")
        full = store.load()
        assert full is not None
        store.save(
            full.model_copy(
                update={
                    "deteccion": batch(
                        detections={f"dificil-0{i}": [True] * 5 for i in range(1, 6)}
                    ).deteccion
                }
            )
        )

        code, err, _ = run(["eval", "stability"])

        assert code == EXIT_OK
        record = JsonStabilityStore(eval_dir / "results" / "v1" / "estabilidad.json").load()
        assert record is not None
        assert (len(record.juez), len(record.emparejador)) == (10, 5)
        assert "Estabilidad medida" in err
        code, _, _ = run(["eval", "stability"])
        assert code == EXIT_OK
        assert JsonStabilityStore(eval_dir / "results" / "v1" / "estabilidad.json").load() == record

        code, _, _ = run(["eval", "report", "--chart", str(eval_dir / "g")])
        assert code == EXIT_OK
        assert "Juez (puntaje por criterio" in (
            eval_dir / "results" / "v1" / "tablas.md"
        ).read_text(encoding="utf-8")


class TestEvalPublish:
    def test_publishing_needs_the_eval_writer_url(self, eval_dir: Path) -> None:
        code, err, _ = run(["eval", "publish", "--human"])

        assert code == EXIT_USAGE
        assert "EVAL_DATABASE_URL" in err
