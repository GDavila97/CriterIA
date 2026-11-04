import argparse
import asyncio
import json
import os
import shlex
import subprocess
import sys
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO
from uuid import uuid4

from pydantic import ValidationError

from criteria.adapters.cli.output import PrintingEventSink, format_historia
from criteria.adapters.llm.registry import ProviderNotAllowedError
from criteria.adapters.llm.ssrf import EndpointNotAllowedError
from criteria.application.runs import EsperandoAprobacion, RunOutcome
from criteria.bootstrap import Container, build_container
from criteria.config import ConfigError, Settings, load_settings
from criteria.domain.approval import RespuestaHumana
from criteria.domain.artifacts import Historias, Requerimiento
from criteria.domain.run_config import ProviderSelection, SelectionError, parse_selection

USER_KEY_ENV = "CRITERIA_USER_API_KEY"
EXIT_OK, EXIT_RUN_FAILED, EXIT_USAGE, EXIT_CANCELLED = 0, 1, 2, 130
MAX_ROUNDS_LIMIT = 5


class UsageError(Exception):
    pass


class Cancelled(Exception):  # noqa: N818
    pass


@dataclass(frozen=True)
class Terminal:
    """The human side of the run: prompts and answers go to stderr so --json keeps stdout clean."""

    read: Callable[[str], str]
    out: TextIO
    err: TextIO
    edit: Callable[[Path], None]


def open_editor(path: Path) -> None:
    editor = shlex.split(os.environ.get("VISUAL") or os.environ.get("EDITOR") or "vi")
    subprocess.run([*editor, str(path)], check=False)  # noqa: S603


def default_terminal() -> Terminal:
    def read(prompt: str) -> str:
        print(prompt, end="", file=sys.stderr, flush=True)
        return sys.stdin.readline()

    return Terminal(read=read, out=sys.stdout, err=sys.stderr, edit=open_editor)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="criteria", description="CriterIA en la terminal.")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Corre el grafo completo con un requerimiento.")
    run.add_argument("--provider", help="Proveedor de generación (por defecto, PROVIDER).")
    run.add_argument("--model", help="Modelo de generación (por defecto, GENERATION_MODEL).")
    run.add_argument("--judge-provider", help="Proveedor del Evaluador (por defecto, el mismo).")
    run.add_argument("--judge-model", help="Modelo del Evaluador (por defecto, el mismo).")
    run.add_argument(
        "--base-url", help=f"URL https para openai_compatible; clave en {USER_KEY_ENV}."
    )
    run.add_argument("--temperatura", type=float, default=0.2)
    run.add_argument("--max-tokens", type=int, default=4096)
    source = run.add_mutually_exclusive_group(required=True)
    source.add_argument("--text", help="Requerimiento en línea.")
    source.add_argument("--file", type=Path, help="Archivo de texto con el requerimiento.")
    run.add_argument(
        "--auto-aprobar", action="store_true", help="Aprueba las historias sin preguntar."
    )
    run.add_argument("--max-rondas", type=int, help="Rondas de corrección del Revisor (0 a 5).")
    run.add_argument("--json", action="store_true", help="Un evento JSON por línea.")
    return parser


def read_requirement(args: argparse.Namespace) -> Requerimiento:
    texto = args.text if args.text is not None else Path(args.file).read_text(encoding="utf-8")
    try:
        return Requerimiento(texto=texto)
    except ValidationError as error:
        raise UsageError(
            "El requerimiento debe tener entre 20 y 2,000 caracteres sin caracteres de control."
        ) from error


def _selection(
    provider: str | None, model: str | None, args: argparse.Namespace
) -> ProviderSelection:
    if not provider or not model:
        raise UsageError(
            "Indica --provider y --model, o define PROVIDER y GENERATION_MODEL en el entorno."
        )
    data: dict[str, object] = {
        "proveedor": provider,
        "modelo": model,
        "temperatura": args.temperatura,
        "max_tokens": args.max_tokens,
    }
    if provider == "openai_compatible":
        data["base_url"] = args.base_url
        data["api_key"] = os.environ.get(USER_KEY_ENV)
    try:
        return parse_selection(data)
    except SelectionError as error:
        raise UsageError(f"Selección de modelo inválida: {error}") from None


def selections(
    args: argparse.Namespace, settings: Settings
) -> tuple[ProviderSelection, ProviderSelection]:
    provider = args.provider or settings.provider
    model = args.model or settings.generation_model
    generacion = _selection(provider, model, args)
    judge_provider = args.judge_provider or settings.judge_provider or provider
    judge_model = args.judge_model or settings.judge_model or model
    if (judge_provider, judge_model) == (provider, model):
        return generacion, generacion
    return generacion, _selection(judge_provider, judge_model, args)


def max_rounds(args: argparse.Namespace, settings: Settings) -> int:
    value = settings.max_review_rounds if args.max_rondas is None else args.max_rondas
    if not 0 <= value <= MAX_ROUNDS_LIMIT:
        raise UsageError(f"--max-rondas debe estar entre 0 y {MAX_ROUNDS_LIMIT}.")
    return int(value)


def ask_for_approval(waiting: EsperandoAprobacion, terminal: Terminal) -> RespuestaHumana:
    for historia in waiting.historias.historias:
        for line in format_historia(historia):
            print(line, file=terminal.err)
    while True:
        answer = terminal.read("¿[a]probar, [e]ditar o [c]ancelar? ").strip().lower()
        if answer in {"a", "aprobar"}:
            return RespuestaHumana(decision="aprobado")
        if answer in {"c", "cancelar", ""}:
            raise Cancelled
        if answer in {"e", "editar"}:
            edited = edit_stories(waiting.historias, terminal)
            if edited is not None:
                return RespuestaHumana(decision="editado", historias=edited)


def edit_stories(historias: Historias, terminal: Terminal) -> Historias | None:
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "historias.json"
        path.write_text(historias.model_dump_json(indent=2), encoding="utf-8")
        terminal.edit(path)
        content = path.read_text(encoding="utf-8")
    try:
        return Historias.model_validate(json.loads(content))
    except (ValueError, ValidationError) as error:
        print(f"Las historias editadas no son válidas: {error}", file=terminal.err)
        return None


async def execute(args: argparse.Namespace, container: Container, terminal: Terminal) -> int:
    settings = container.settings
    requerimiento = read_requirement(args)
    generacion, juez = selections(args, settings)
    rondas = max_rounds(args, settings)
    try:
        container.registry.validate(generacion)
        container.registry.validate(juez)
        agents = container.agents(generacion, juez)
    except (ProviderNotAllowedError, EndpointNotAllowedError) as error:
        raise UsageError(str(error)) from None
    events = PrintingEventSink(uuid4(), container.clock, terminal.out, as_json=args.json)
    service = container.service
    outcome: RunOutcome = await service.iniciar(
        requerimiento=requerimiento,
        agents=agents,
        events=events,
        proveedor=generacion.proveedor,
        max_rondas=rondas,
    )
    while isinstance(outcome, EsperandoAprobacion):
        try:
            respuesta = (
                RespuestaHumana(decision="aprobado")
                if args.auto_aprobar
                else ask_for_approval(outcome, terminal)
            )
        except Cancelled:
            await service.descartar(events.run_id)
            print("Corrida cancelada.", file=terminal.err)
            return EXIT_CANCELLED
        outcome = await service.reanudar(respuesta=respuesta, agents=agents, events=events)
    return EXIT_OK if outcome.estado == "completada" else EXIT_RUN_FAILED


def main(
    argv: Sequence[str] | None = None,
    container_factory: Callable[[Settings], Container] = build_container,
    terminal: Terminal | None = None,
) -> int:
    args = build_parser().parse_args(argv)
    terminal = terminal or default_terminal()
    try:
        container = container_factory(load_settings())
        return asyncio.run(execute(args, container, terminal))
    except (ConfigError, UsageError, OSError) as error:
        print(f"criteria: {error}", file=terminal.err)
        return EXIT_USAGE
    except KeyboardInterrupt:
        return EXIT_CANCELLED


def entrypoint() -> None:
    sys.exit(main())
