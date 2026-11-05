import io
import json
from collections.abc import Callable
from pathlib import Path

import pytest

from criteria.adapters.agents.factory import AgentFactory
from criteria.adapters.cli.main import (
    EXIT_CANCELLED,
    EXIT_OK,
    EXIT_RUN_FAILED,
    EXIT_USAGE,
    USER_KEY_ENV,
    Terminal,
    main,
)
from criteria.adapters.cli.output import format_event
from criteria.adapters.llm.catalog import ModelCatalog
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.adapters.memory.checkpointer import MemoryCheckpointer
from criteria.application.runs import RunService
from criteria.bootstrap import Container, build_container
from criteria.config import SERVICE_ROOT, Settings
from criteria.domain.events import AgenteError, evento_adapter
from criteria.domain.run_config import ProviderSelection
from criteria.ports.agents import AgentSet
from tests import factories as f
from tests.agent_models import ScriptedTeam, make_binding, team
from tests.fakes import FakeClock

EXAMPLES = SERVICE_ROOT / "examples"


def happy() -> ScriptedTeam:
    return team(
        analista=[f.historias(1)],
        qa=[f.entrega_qa(1)],
        revisor=[f.veredicto()],
        evaluador=[f.evaluacion(5)],
    )


class FakeContainer(Container):
    def __init__(self, settings: Settings, scripted: ScriptedTeam) -> None:
        self.checkpointer = MemoryCheckpointer()
        super().__init__(
            settings=settings,
            registry=ProviderRegistry(settings, ModelCatalog.load(settings.models_file)),
            clock=FakeClock(),
            service=RunService(self.checkpointer),
        )
        self.team = scripted
        self.selections: list[tuple[ProviderSelection, ProviderSelection]] = []

    def agents(self, generacion: ProviderSelection, juez: ProviderSelection) -> AgentSet:
        self.selections.append((generacion, juez))
        gen, judge = (
            make_binding(self.team, sel.etiqueta, provider=sel.proveedor)
            for sel in (generacion, juez)
        )
        return AgentFactory(self.settings.prompts_dir, "v1", "v1", self.clock).build(gen, judge)


class Console:
    def __init__(self, answers: list[str], edit: Callable[[Path], None] | None = None) -> None:
        self.out = io.StringIO()
        self.err = io.StringIO()
        self.answers = answers
        self.terminal = Terminal(
            read=lambda _prompt: self.answers.pop(0) if self.answers else "",
            out=self.out,
            err=self.err,
            edit=edit or (lambda _path: None),
        )


@pytest.fixture(autouse=True)
def local_ollama(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("SERVER_KEY_PROVIDERS", "ollama")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://192.168.1.50:11434")


def run_cli(
    argv: list[str], scripted: ScriptedTeam | None = None, console: Console | None = None
) -> tuple[int, Console, FakeContainer | None]:
    console = console or Console([])
    holder: list[FakeContainer] = []

    def factory(settings: Settings) -> Container:
        holder.append(FakeContainer(settings, scripted or happy()))
        return holder[0]

    code = main(argv, container_factory=factory, terminal=console.terminal)
    return code, console, holder[0] if holder else None


OLLAMA = ["run", "--provider", "ollama", "--model", "qwen3:8b"]


class TestRun:
    def test_auto_approve_prints_readable_events_and_artifacts(self) -> None:
        code, console, _ = run_cli([*OLLAMA, "--text", f.REQUERIMIENTO, "--auto-aprobar"])

        output = console.out.getvalue()
        assert code == EXIT_OK
        assert output.startswith("[01] sistema   · corrida ")
        assert "· prompts v1 · juez v1 ·" in output
        for fragment in (
            "HU-1 [alta] Como socio",
            "CP-01 (HU-1, qa)",
            "Dado un socio",
            "claridad: 5/5",
        ):
            assert fragment in output
        assert "fin · completada" in output

    def test_json_mode_prints_one_valid_event_per_line(self) -> None:
        code, console, _ = run_cli([*OLLAMA, "--text", f.REQUERIMIENTO, "--auto-aprobar", "--json"])

        events = [
            evento_adapter.validate_json(line) for line in console.out.getvalue().splitlines()
        ]
        assert code == EXIT_OK
        assert [e.seq for e in events] == list(range(1, len(events) + 1))
        assert events[-1].type == "corrida_fin"

    def test_reads_the_requirement_from_a_file(self) -> None:
        code, _, container = run_cli(
            [*OLLAMA, "--file", str(EXAMPLES / "biblioteca.txt"), "--auto-aprobar"]
        )

        assert code == EXIT_OK
        assert container is not None
        assert "biblioteca municipal" in container.team.prompts["analista"][0]

    def test_failed_runs_exit_with_status_one(self) -> None:
        failing = team(analista=[{"historias": []}])

        code, console, _ = run_cli([*OLLAMA, "--text", f.REQUERIMIENTO, "--auto-aprobar"], failing)

        assert code == EXIT_RUN_FAILED
        assert "error salida_invalida" in console.out.getvalue()

    def test_defaults_come_from_the_environment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PROVIDER", "ollama")
        monkeypatch.setenv("GENERATION_MODEL", "llama3.1:8b")
        monkeypatch.setenv("JUDGE_MODEL", "qwen3:8b")

        code, _, container = run_cli(["run", "--text", f.REQUERIMIENTO, "--auto-aprobar"])

        assert code == EXIT_OK
        assert container is not None
        generacion, juez = container.selections[0]
        assert (generacion.etiqueta, juez.etiqueta) == ("ollama:llama3.1:8b", "ollama:qwen3:8b")


class TestTiers:
    def test_a_tier_resolves_to_the_catalog_model_and_shows_the_estimate(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(USER_KEY_ENV, "sk-user-7777")
        argv = ["run", "--provider", "anthropic", "--nivel", "equilibrado", "--clave-propia"]

        code, console, container = run_cli([*argv, "--text", f.REQUERIMIENTO, "--auto-aprobar"])

        assert code == EXIT_OK
        assert container is not None
        assert container.selections[0][0].etiqueta == "anthropic:claude-sonnet-5-5"
        assert "Costo estimado de la corrida: US$ 0.0" in console.err.getvalue()

    def test_priced_models_print_a_dollar_estimate(self) -> None:
        code, console, _ = run_cli([*OLLAMA, "--text", f.REQUERIMIENTO, "--auto-aprobar"])

        assert code == EXIT_OK
        assert "Costo estimado de la corrida: US$ 0.000000" in console.err.getvalue()

    def test_an_invalid_catalog_stops_the_cli_with_a_clear_message(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        catalog = tmp_path / "models.toml"
        entry = '[[models]]\nprovider = "groq"\nname = "{}"\nnivel = "economico"\n'
        catalog.write_text(entry.format("a") + entry.format("b"), encoding="utf-8")
        monkeypatch.setenv("MODELS_FILE", str(catalog))

        code, console, _ = run_cli([*OLLAMA, "--text", f.REQUERIMIENTO])

        assert code == EXIT_USAGE
        assert "groq has two models for the economico tier" in console.err.getvalue()

    def test_providers_without_tiers_need_an_explicit_model(self) -> None:
        code, console, _ = run_cli(["run", "--provider", "ollama", "--text", f.REQUERIMIENTO])

        assert code == EXIT_USAGE
        assert "ollama has no model for the economico tier" in console.err.getvalue()


class TestJudgeChoice:
    def test_picks_another_provider_with_server_access_for_the_judge(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SERVER_KEY_PROVIDERS", "ollama,anthropic")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-operator")

        code, console, container = run_cli([*OLLAMA, "--text", f.REQUERIMIENTO, "--auto-aprobar"])

        assert code == EXIT_OK
        assert container is not None
        generacion, juez = container.selections[0]
        assert (generacion.etiqueta, juez.etiqueta) == (
            "ollama:qwen3:8b",
            "anthropic:claude-haiku-5-5",
        )
        assert not juez.usa_clave_propia
        assert "(mismo proveedor)" not in console.out.getvalue()

    def test_uses_the_same_provider_when_no_other_is_available(self) -> None:
        code, console, container = run_cli([*OLLAMA, "--text", f.REQUERIMIENTO, "--auto-aprobar"])

        assert code == EXIT_OK
        assert container is not None
        generacion, juez = container.selections[0]
        assert juez is generacion
        assert "juez ollama:qwen3:8b (mismo proveedor)" in console.out.getvalue()

    def test_explicit_judge_configuration_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SERVER_KEY_PROVIDERS", "ollama,anthropic")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-operator")

        code, _, container = run_cli(
            [*OLLAMA, "--judge-model", "llama3.1:8b", "--text", f.REQUERIMIENTO, "--auto-aprobar"]
        )

        assert code == EXIT_OK
        assert container is not None
        assert container.selections[0][1].etiqueta == "ollama:llama3.1:8b"


class TestApproval:
    def test_interactive_approval(self) -> None:
        console = Console(["a"])

        code, console, _ = run_cli([*OLLAMA, "--text", f.REQUERIMIENTO], console=console)

        assert code == EXIT_OK
        assert "HU-1 [alta]" in console.err.getvalue()
        assert "humano_responde" not in console.out.getvalue()
        assert "aprobado · agregadas -" in console.out.getvalue()

    def test_edit_in_the_editor_sends_the_edited_stories_to_qa(self) -> None:
        def edit(path: Path) -> None:
            data = json.loads(path.read_text(encoding="utf-8"))
            data["historias"][0]["quiero"] = "reservar desde el teléfono"
            path.write_text(json.dumps(data), encoding="utf-8")

        code, console, container = run_cli(
            [*OLLAMA, "--text", f.REQUERIMIENTO], console=Console(["e"], edit)
        )

        assert code == EXIT_OK
        assert "editado · agregadas - · modificadas ['HU-1']" in console.out.getvalue()
        assert container is not None
        assert "reservar desde el teléfono" in container.team.prompts["qa"][0]

    def test_invalid_edits_are_reported_and_asked_again(self) -> None:
        def break_file(path: Path) -> None:
            path.write_text('{"historias": []}', encoding="utf-8")

        code, console, _ = run_cli(
            [*OLLAMA, "--text", f.REQUERIMIENTO], console=Console(["e", "x", "a"], break_file)
        )

        assert code == EXIT_OK
        assert "Las historias editadas no son válidas" in console.err.getvalue()

    def test_cancel_discards_the_paused_run(self) -> None:
        code, console, container = run_cli(
            [*OLLAMA, "--text", f.REQUERIMIENTO], console=Console(["c"])
        )

        assert code == EXIT_CANCELLED
        assert "Corrida cancelada." in console.err.getvalue()
        assert container is not None
        assert container.checkpointer.saver().storage == {}  # type: ignore[attr-defined]


class TestUsageErrors:
    @pytest.mark.parametrize(
        ("argv", "message"),
        [
            ([*OLLAMA, "--text", "muy corto"], "entre 20 y 2,000"),
            (["run", "--text", f.REQUERIMIENTO], "Indica --provider"),
            (
                [
                    "run",
                    "--provider",
                    "openai",
                    "--model",
                    "gpt-5.4-mini",
                    "--text",
                    f.REQUERIMIENTO,
                ],
                "clave_requerida",
            ),
            ([*OLLAMA[:4], "mistral:7b", "--text", f.REQUERIMIENTO], "not allowed"),
            ([*OLLAMA, "--text", f.REQUERIMIENTO, "--max-rondas", "9"], "entre 0 y 5"),
            ([*OLLAMA, "--file", "/no/existe.txt"], "No such file"),
        ],
    )
    def test_usage_errors_exit_with_status_two(self, argv: list[str], message: str) -> None:
        code, console, _ = run_cli(argv)

        assert code == EXIT_USAGE
        assert message in console.err.getvalue()

    def test_missing_configuration_is_reported(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("APP_ENV")

        code, console, _ = run_cli([*OLLAMA, "--text", f.REQUERIMIENTO])

        assert code == EXIT_USAGE
        assert "APP_ENV" in console.err.getvalue()


COMPATIBLE = (
    "run",
    "--provider",
    "openai_compatible",
    "--model",
    "any-model",
    "--text",
    f.REQUERIMIENTO,
    "--auto-aprobar",
)


class TestUserKey:
    def test_user_endpoint_needs_the_key_from_the_environment(self) -> None:
        code, console, _ = run_cli([*COMPATIBLE, "--base-url", "https://llm.example.com/v1"])

        assert code == EXIT_USAGE
        assert "needs its own base_url and api_key" in console.err.getvalue()

    def test_rejected_user_endpoint_never_prints_the_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        key = "sk-user-3333-terminal"
        monkeypatch.setenv(USER_KEY_ENV, key)

        code, console, _ = run_cli([*COMPATIBLE, "--base-url", "https://192.168.1.50/v1"])

        assert code == EXIT_USAGE
        assert "not public" in console.err.getvalue()
        assert key not in console.err.getvalue() + console.out.getvalue()

    def test_own_key_unlocks_a_paid_provider_without_server_access(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(USER_KEY_ENV, "sk-user-6666")
        argv = [
            "run",
            "--provider",
            "groq",
            "--model",
            "openai/gpt-oss-20b",
            "--text",
            f.REQUERIMIENTO,
        ]

        without_key, console, _ = run_cli([*argv, "--auto-aprobar"])
        code, _, container = run_cli([*argv, "--auto-aprobar", "--clave-propia"])

        assert without_key == EXIT_USAGE
        assert "clave_requerida" in console.err.getvalue()
        assert code == EXIT_OK
        assert container is not None
        generacion, juez = container.selections[0]
        assert generacion.usa_clave_propia
        assert juez is generacion

    def test_valid_user_endpoint_reaches_the_run(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(USER_KEY_ENV, "sk-user-4444")

        code, _, container = run_cli([*COMPATIBLE, "--base-url", "https://llm.example.com/v1"])

        assert code == EXIT_OK
        assert container is not None
        assert container.selections[0][0].usa_clave_propia


def test_account_failures_print_the_free_option() -> None:
    event = AgenteError.model_validate(
        {
            "run_id": "0b6f0c1e-3c55-4d7c-9a77-3f1ac2a3f0f1",
            "seq": 7,
            "ts": "2026-11-05T12:00:00Z",
            "agent": "analista",
            "codigo": "sin_saldo",
            "mensaje": "La cuenta del proveedor no tiene saldo o cuota disponible.",
            "respaldo_sugerido": "groq",
        }
    )

    assert format_event(event).endswith("Puedes usar el gratuito (groq).")


def test_real_container_builds_agents_from_the_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings.model_validate(
        {
            "app_env": "test",
            "server_key_providers": "ollama",
            "ollama_base_url": "http://localhost:11434",
        }
    )
    container = build_container(settings)
    selection = ProviderSelection(proveedor="ollama", modelo="qwen3:8b")

    agents = container.agents(selection, selection)

    assert agents.analista.modelo == agents.evaluador.modelo == "ollama:qwen3:8b"
    assert (agents.version_prompts, agents.version_juez) == ("v1", "v1")
