"""`criteria eval`: batch runs, the matcher, the blind scoring session and publication."""

import argparse
import asyncio
import warnings
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

from criteria.adapters.agents.matcher import ModelMatcher, load_matcher_prompt
from criteria.adapters.cli.eval_view import (
    CRITERIA_HELP,
    SCALE_HELP,
    format_check,
    format_run,
    page,
)
from criteria.adapters.eval.files import (
    NOT_BATCHES,
    EvalFileError,
    JsonBatchStore,
    JsonSessionStore,
    JsonStabilityStore,
    batch_slug,
    git_sha,
    load_batches,
    load_cases,
)
from criteria.adapters.eval.ollama import FULL_GPU, OllamaProbeError, probe
from criteria.adapters.eval.report import chart_svg, markdown, summary_json
from criteria.adapters.llm.registry import KeyRequiredError, ProviderNotAllowedError
from criteria.adapters.postgres.database import create_engine
from criteria.adapters.postgres.evaluation import PostgresEvalPublisher
from criteria.application.analysis import (
    match_batch,
    new_session,
    next_check,
    next_score,
    with_check,
    with_score,
)
from criteria.application.evaluation import BatchStoppedError, EvalRunner
from criteria.application.report import (
    common_cases,
    judge_agreement,
    judge_pairs,
    matcher_agreement,
    summarize,
)
from criteria.application.stability import (
    judge_self_agreement,
    matcher_self_agreement,
    measure,
    new_record,
)
from criteria.config import SERVICE_ROOT
from criteria.domain.eval_sampling import never_detected
from criteria.domain.evaluation import EvalBatch, EvalCase, HumanSession, OllamaConfig
from criteria.domain.run_config import (
    DEFAULT_MAX_TOKENS,
    ProviderSelection,
    SelectionError,
    parse_selection,
)

if TYPE_CHECKING:
    from criteria.adapters.cli.main import Terminal
    from criteria.bootstrap import Container

GENERATION_TEMPERATURE = 0.2
JUDGE_TEMPERATURE = 0.0
MAX_TOKENS = DEFAULT_MAX_TOKENS
JUDGE = ("anthropic", "claude-haiku-5-5")
DEFAULT_SEED = 20261108
MATCHER_VERSION = "v1"
HUMAN_FILE = "human.json"
STABILITY_FILE = "estabilidad.json"
# pydantic-ai warns with this text when a provider drops a sampling setting.
IGNORED_SETTING = "will be ignored"
PAUSE = "p"


class EvalUsageError(Exception):
    pass


def add_eval_commands(commands: "argparse._SubParsersAction[argparse.ArgumentParser]") -> None:
    evaluation = commands.add_parser("eval", help="Evaluación por lotes (F5).")
    sub = evaluation.add_subparsers(dest="eval_command", required=True)

    run = sub.add_parser("run", help="Corre el conjunto de casos con un modelo.")
    run.add_argument("--provider", required=True)
    run.add_argument("--model", required=True)
    run.add_argument("--cases", nargs="*", default=[], help="Solo estos casos (por id).")
    run.add_argument("--ollama-context", type=int, help="OLLAMA_CONTEXT_LENGTH del servidor.")
    run.add_argument("--ollama-flash-attention", choices=["0", "1"], help="OLLAMA_FLASH_ATTENTION.")
    run.add_argument("--ollama-kv-cache", help="OLLAMA_KV_CACHE_TYPE del servidor.")

    match = sub.add_parser("match", help="Empareja problemas sembrados con observaciones.")
    match.add_argument("--file", type=Path, help="Un lote; por defecto, todos.")

    score = sub.add_parser("score", help="Calificación humana a ciegas (pausable).")
    score.add_argument("--seed", type=int, default=DEFAULT_SEED)

    stability = sub.add_parser(
        "stability", help="Pregunta otra vez al juez y al emparejador para medir su estabilidad."
    )
    stability.add_argument("--seed", type=int, default=DEFAULT_SEED)

    report = sub.add_parser("report", help="Calcula las métricas y escribe tablas y gráfica.")
    report.add_argument(
        "--chart", type=Path, default=SERVICE_ROOT.parent.parent / "docs" / "evaluation"
    )

    publish = sub.add_parser("publish", help="Inserta un lote o la sesión humana en la base.")
    target = publish.add_mutually_exclusive_group(required=True)
    target.add_argument("--file", type=Path)
    target.add_argument("--human", action="store_true")


def _results_dir(container: "Container") -> Path:
    settings = container.settings
    return settings.eval_dir / "results" / settings.prompt_version


def _cases(container: "Container", only: list[str] | None = None) -> dict[str, EvalCase]:
    cases = load_cases(container.settings.eval_dir / "cases", only or [])
    return {case.id: case for case in cases}


def _selection(provider: str, model: str, temperatura: float) -> ProviderSelection:
    try:
        return parse_selection(
            {
                "proveedor": provider,
                "modelo": model,
                "temperatura": temperatura,
                "max_tokens": MAX_TOKENS,
            }
        )
    except SelectionError as error:
        raise EvalUsageError(f"Selección de modelo inválida: {error}") from None


def _validated(container: "Container", selection: ProviderSelection) -> ProviderSelection:
    try:
        return container.registry.validate(selection)
    except KeyRequiredError as error:
        raise EvalUsageError(
            f"{selection.proveedor} necesita su clave en el .env local y en SERVER_KEY_PROVIDERS "
            f"({error.codigo})."
        ) from None
    except ProviderNotAllowedError as error:
        raise EvalUsageError(str(error)) from None


def _judge(container: "Container") -> ProviderSelection:
    return _validated(container, _selection(*JUDGE, JUDGE_TEMPERATURE))


async def _ollama_config(
    container: "Container", args: argparse.Namespace, model: str, terminal: "Terminal"
) -> OllamaConfig:
    if None in (args.ollama_context, args.ollama_flash_attention, args.ollama_kv_cache):
        raise EvalUsageError(
            "Un lote de Ollama necesita --ollama-context, --ollama-flash-attention y "
            "--ollama-kv-cache, como están configurados en el servidor."
        )
    base_url = container.settings.ollama_base_url
    if base_url is None:
        raise EvalUsageError("Define OLLAMA_BASE_URL para correr el lote local.")
    try:
        status = await probe(str(base_url), model)
    except OllamaProbeError as error:
        raise EvalUsageError(str(error)) from None
    print(
        f"Ollama {status.version}: {model} al {status.gpu_percent:.0f} % en la GPU.",
        file=terminal.err,
    )
    if status.gpu_percent < FULL_GPU:
        raise EvalUsageError(
            f"{model} no quedó completo en la GPU ({status.gpu_percent:.0f} %). "
            "Cierra otras cargas de la GPU y vuelve a intentarlo."
        )
    return OllamaConfig(
        version=status.version,
        context_length=args.ollama_context,
        flash_attention=args.ollama_flash_attention == "1",
        kv_cache_type=args.ollama_kv_cache,
        gpu_percent=status.gpu_percent,
    )


def _check_resumable(batch: EvalBatch, fresh: EvalBatch) -> None:
    keys = (
        "proveedor",
        "modelo",
        "output_mode",
        "version_prompts",
        "version_juez",
        "juez_proveedor",
        "juez_modelo",
        "temperatura",
        "max_tokens",
    )
    changed = [k for k in keys if getattr(batch, k) != getattr(fresh, k)]
    if changed:
        raise EvalUsageError(
            f"El lote guardado no coincide en: {', '.join(changed)}. Usa otro archivo."
        )


def _with_ignored_settings(
    store: JsonBatchStore, caught: list[warnings.WarningMessage]
) -> EvalBatch:
    batch = store.load()
    assert batch is not None  # noqa: S101  saved before the first case
    found = {str(w.message) for w in caught if IGNORED_SETTING in str(w.message)}
    merged = sorted(set(batch.parametros_ignorados) | found)
    if merged != batch.parametros_ignorados:
        batch = batch.model_copy(update={"parametros_ignorados": merged})
        store.save(batch)
    return batch


async def _run(args: argparse.Namespace, container: "Container", terminal: "Terminal") -> int:
    registry = container.registry
    settings = container.settings
    cases = list(_cases(container, args.cases).values())
    generacion = _validated(
        container, _selection(args.provider, args.model, GENERATION_TEMPERATURE)
    )
    juez = _judge(container)
    modelo = generacion.modelo or args.model
    ollama = (
        await _ollama_config(container, args, modelo, terminal)
        if generacion.proveedor == "ollama"
        else None
    )
    fresh = EvalBatch(
        batch_id=uuid4(),
        creado_en=datetime.now(UTC),
        proveedor=generacion.proveedor,
        modelo=modelo,
        display_name=registry.display_name(generacion.proveedor, modelo),
        output_mode=registry.output_mode(generacion),
        version_prompts=settings.prompt_version,
        juez_proveedor=juez.proveedor,
        juez_modelo=juez.modelo or JUDGE[1],
        version_juez=settings.judge_version,
        juez_mismo_proveedor=juez.proveedor == generacion.proveedor,
        git_sha=git_sha(SERVICE_ROOT),
        temperatura=GENERATION_TEMPERATURE,
        temperatura_juez=JUDGE_TEMPERATURE,
        max_tokens=registry.max_tokens(generacion),
        max_rondas=settings.max_review_rounds,
        ollama=ollama,
    )
    store = JsonBatchStore(
        _results_dir(container) / f"{batch_slug(generacion.proveedor, modelo)}.json"
    )
    saved = store.load()
    if saved is not None:
        _check_resumable(saved, fresh)
        if saved.git_sha != fresh.git_sha:
            print(
                f"Aviso: el lote empezó en {saved.git_sha} y ahora el código está en "
                f"{fresh.git_sha}.",
                file=terminal.err,
            )
    batch = saved or fresh
    store.save(batch)
    print(
        f"Lote {batch.clave}: {len(batch.resultados)} de {len(cases)} casos ya completos. "
        f"Archivo: {store.path}",
        file=terminal.err,
    )
    runner = EvalRunner(
        service=container.service,
        agents=container.agents(generacion, juez),
        clock=container.clock,
        store=store,
        sleep=asyncio.sleep,
        max_rondas=batch.max_rondas,
    )
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                batch = await runner.run(
                    batch, cases, lambda message: print(message, file=terminal.err)
                )
            finally:
                batch = _with_ignored_settings(store, caught)
    except BatchStoppedError as error:
        print(
            f"Lote detenido en {error.case_id} por {error.codigo}; "
            "se reanuda con el mismo comando.",
            file=terminal.err,
        )
        return 1
    completas = sum(r.estado == "completada" for r in batch.resultados.values())
    print(
        f"Listo: {completas} de {len(batch.resultados)} corridas completas. "
        f"Costo real del lote: US$ {batch.costo_gastado_usd:.4f}.",
        file=terminal.err,
    )
    return 0


async def _match(args: argparse.Namespace, container: "Container", terminal: "Terminal") -> int:
    juez = _judge(container)
    matcher = _matcher(container)
    cases = _cases(container)
    folder = _results_dir(container)
    paths = [args.file] if args.file else sorted(folder.glob("*.json"))
    for path in paths:
        if path.name in NOT_BATCHES:
            continue
        store = JsonBatchStore(path)
        batch = store.load()
        if batch is None:
            raise EvalUsageError(f"No existe {path}")
        batch = await match_batch(
            batch,
            cases,
            matcher=matcher,
            store=store,
            matcher_model=juez.etiqueta,
            matcher_version=MATCHER_VERSION,
            progress=lambda message: print(message, file=terminal.err),
        )
        print(
            f"{batch.clave}: costo del emparejador US$ {batch.costo_analisis_usd:.4f}",
            file=terminal.err,
        )
    return 0


def _ask(terminal: "Terminal", prompt: str, valid: Mapping[str, object]) -> object:
    while True:
        answer = terminal.read(prompt).strip().lower()
        if answer in valid:
            return valid[answer]
        print("Respuesta no válida.", file=terminal.err)


async def _score(args: argparse.Namespace, container: "Container", terminal: "Terminal") -> int:
    folder = _results_dir(container)
    batches = {b.batch_id: b for b in load_batches(folder)}
    cases = _cases(container)
    store = JsonSessionStore(folder / HUMAN_FILE)
    session: HumanSession = store.load() or new_session(list(batches.values()), args.seed)
    store.save(session)
    err = terminal.err
    print(
        "Calificación a ciegas: no se muestra el modelo ni el puntaje del juez. "
        f"Escribe {PAUSE} en cualquier pregunta para pausar; se guarda cada respuesta.",
        file=err,
    )
    scores = {str(n): n for n in range(1, 6)} | {PAUSE: PAUSE}
    while (pending := next_score(session)) is not None:
        batch = batches[pending.batch_id]
        case = cases[pending.case_id]
        result = batch.resultados[pending.case_id]
        print(f"\n=== Corrida {pending.numero} de {pending.total} ===", file=err)
        page(format_run(case, result), terminal.read, err)
        for criterio in pending.criterios:
            print(f"\n{criterio.upper()}: {CRITERIA_HELP[criterio]}\n{SCALE_HELP}", file=err)
            valor = _ask(terminal, f"Puntaje de {criterio} (1 a 5): ", scores)
            if valor == PAUSE:
                print("Sesión pausada; se reanuda con el mismo comando.", file=err)
                return 0
            session = with_score(
                session, pending.batch_id, pending.case_id, criterio, int(str(valor))
            )
            store.save(session)
    yes_no: dict[str, object] = {"s": True, "n": False, PAUSE: PAUSE}
    while (check := next_check(session)) is not None:
        batch = batches[check.batch_id]
        deteccion = next(
            d for d in batch.deteccion[check.case_id].detecciones if d.problema == check.problema
        )
        print(f"\n=== Emparejamiento {check.numero} de {check.total} ===", file=err)
        page(
            format_check(cases[check.case_id], batch.resultados[check.case_id], deteccion),
            terminal.read,
            err,
        )
        acierta = _ask(terminal, "¿El emparejador acertó? [s/n]: ", yes_no)
        if acierta == PAUSE:
            print("Sesión pausada; se reanuda con el mismo comando.", file=err)
            return 0
        session = with_check(
            session, check.batch_id, check.case_id, check.problema, acierta is True
        )
        store.save(session)
    print(
        f"Sesión completa: {len(session.puntajes)} puntajes y "
        f"{len(session.emparejamientos)} emparejamientos revisados.",
        file=err,
    )
    return 0


def _matcher(container: "Container") -> ModelMatcher:
    registry = container.registry
    juez = _judge(container)
    return ModelMatcher(
        registry.model(juez),
        registry.model_settings(juez),
        load_matcher_prompt(container.settings.prompts_dir, MATCHER_VERSION),
        lambda tokens_in, tokens_out: registry.cost_usd(juez, tokens_in, tokens_out),
    )


async def _stability(args: argparse.Namespace, container: "Container", terminal: "Terminal") -> int:
    folder = _results_dir(container)
    batches = load_batches(folder)
    store = JsonStabilityStore(folder / STABILITY_FILE)
    record = store.load() or new_record(batches, args.seed)
    store.save(record)
    juez = _judge(container)
    record = await measure(
        record,
        batches,
        _cases(container),
        judge=container.agents(juez, juez).evaluador,
        matcher=_matcher(container),
        store=store,
        progress=lambda message: print(message, file=terminal.err),
    )
    print(f"Estabilidad medida; costo US$ {record.costo_usd:.4f}.", file=terminal.err)
    return 0


async def _report(args: argparse.Namespace, container: "Container", terminal: "Terminal") -> int:
    folder = _results_dir(container)
    cases = _cases(container)
    batches = sorted(load_batches(folder), key=lambda b: b.clave)
    if not batches:
        raise EvalUsageError("Todavía no hay lotes.")
    summaries = summarize(batches, cases)
    session = JsonSessionStore(folder / HUMAN_FILE).load()
    judge = None if session is None else judge_agreement(judge_pairs(session, batches))
    matcher = None if session is None else matcher_agreement(session)
    checks = 0 if session is None else len(session.emparejamientos)
    stability = JsonStabilityStore(folder / STABILITY_FILE).load()
    judge_self = None if stability is None else judge_self_agreement(stability)
    matcher_self = None if stability is None else matcher_self_agreement(stability)
    undetected = never_detected(batches)
    (folder / "tablas.md").write_text(
        markdown(
            summaries,
            cases,
            common=common_cases(batches),
            judge=judge,
            matcher=matcher,
            matcher_checks=checks,
            undetected=undetected,
            judge_self=judge_self,
            matcher_self=matcher_self,
        ),
        encoding="utf-8",
    )
    (folder / "reporte.json").write_text(
        summary_json(
            summaries,
            judge=judge,
            matcher=matcher,
            undetected=undetected,
            judge_self=judge_self,
            matcher_self=matcher_self,
        ),
        encoding="utf-8",
    )
    args.chart.mkdir(parents=True, exist_ok=True)
    chart = args.chart / f"criterios-{container.settings.prompt_version}.svg"
    chart.write_text(chart_svg(summaries), encoding="utf-8")
    print(f"Reporte en {folder / 'tablas.md'} y gráfica en {chart}.", file=terminal.err)
    return 0


async def _publish(args: argparse.Namespace, container: "Container", terminal: "Terminal") -> int:
    url = container.settings.eval_database_url
    if url is None:
        raise EvalUsageError("Define EVAL_DATABASE_URL (rol eval_writer) para publicar.")
    engine = create_engine(url.get_secret_value(), pool_size=2)
    publisher = PostgresEvalPublisher(engine)
    try:
        if args.human:
            session = JsonSessionStore(_results_dir(container) / HUMAN_FILE).load()
            if session is None:
                raise EvalUsageError("Todavía no hay una sesión de calificación.")
            inserted = await publisher.publish_human(session)
            print(f"Puntajes humanos nuevos: {inserted}.", file=terminal.err)
            return 0
        batch = JsonBatchStore(args.file).load()
        if batch is None:
            raise EvalUsageError(f"No existe {args.file}")
        published = await publisher.publish(batch, _cases(container))
        print(
            f"{batch.clave}: {published.cases} casos, {published.batches} lote y "
            f"{published.results} resultados nuevos.",
            file=terminal.err,
        )
        return 0
    finally:
        await engine.dispose()


async def execute_eval(
    args: argparse.Namespace, container: "Container", terminal: "Terminal"
) -> int:
    handlers = {
        "run": _run,
        "match": _match,
        "score": _score,
        "stability": _stability,
        "report": _report,
        "publish": _publish,
    }
    try:
        return await handlers[args.eval_command](args, container, terminal)
    except (EvalUsageError, EvalFileError) as error:
        print(f"criteria eval: {error}", file=terminal.err)
        return 2
