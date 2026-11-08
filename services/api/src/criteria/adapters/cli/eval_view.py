"""What the person sees while scoring: the run without its model, paginated, and the rubric."""

import textwrap
from collections.abc import Callable
from typing import TextIO

from criteria.adapters.cli.output import format_historia
from criteria.domain.artifacts import Criterio
from criteria.domain.evaluation import CaseResult, Deteccion, EvalCase

PAGE_LINES = 30
WIDTH = 96

# The same rubric the judge receives (prompts/juez/v1/evaluador.md), so both score the same thing.
CRITERIA_HELP: dict[Criterio, str] = {
    "claridad": "los artefactos se entienden sin ambigüedad.",
    "verificabilidad": "los criterios y los casos se pueden comprobar con un resultado observable.",
    "completitud": "el requerimiento queda cubierto por historias y cada historia por pruebas.",
    "consistencia": "historias, criterios y casos concuerdan entre sí y con el requerimiento.",
}
SCALE_HELP = (
    "Escala: 1 deficiente, 2 con problemas graves, 3 aceptable con problemas, "
    "4 bueno con detalles menores, 5 sin problemas relevantes. Un 5 es excepcional; "
    "si dudas entre dos valores, elige el menor."
)
TYPE_NAMES = {
    "ambiguedad": "Ambigüedad",
    "inconsistencia": "Inconsistencia",
    "faltante": "Faltante",
}


def _wrap(text: str, indent: str = "") -> list[str]:
    return textwrap.wrap(text, WIDTH, initial_indent=indent, subsequent_indent=indent) or [indent]


def format_run(case: EvalCase, result: CaseResult) -> list[str]:
    """The requirement and the final artifacts, as the judge received them; never the model."""
    a = result.artefactos
    lines = ["REQUERIMIENTO", *_wrap(case.texto, "  "), "", "HISTORIAS"]
    for historia in a.historias:
        lines += [w for line in format_historia(historia) for w in _wrap(line, "  ")]
    lines += ["", "CRITERIOS DE ACEPTACIÓN"]
    lines += [w for c in a.criterios for w in _wrap(f"{c.id} [{c.historia_id}] {c.texto}", "  ")]
    lines += ["", "CASOS DE PRUEBA"]
    for caso in a.casos:
        lines += _wrap(f"{caso.id} [{caso.historia_id}] {caso.titulo}", "  ")
        lines += [w for i, p in enumerate(caso.pasos, 1) for w in _wrap(f"{i}. {p}", "      ")]
        lines += _wrap(f"Resultado esperado: {caso.resultado_esperado}", "    ")
        g = caso.gherkin
        gherkin = [
            *(f"{'Y' if i else 'Dado'} {s}" for i, s in enumerate(g.dado)),
            *(f"{'Y' if i else 'Cuando'} {s}" for i, s in enumerate(g.cuando)),
            *(f"{'Y' if i else 'Entonces'} {s}" for i, s in enumerate(g.entonces)),
        ]
        lines += [w for step in gherkin for w in _wrap(step, "    | ")]
    pendientes = [o for o in a.observaciones if not o.se_corrige]
    lines += ["", "OBSERVACIONES PENDIENTES DEL REVISOR"]
    if not pendientes:
        lines.append("  (ninguna)")
    for o in pendientes:
        obs = o.observacion
        lines += _wrap(f"{TYPE_NAMES[obs.tipo]}: {obs.descripcion}", "  ")
    return lines


def format_check(case: EvalCase, result: CaseResult, deteccion: Deteccion) -> list[str]:
    problema = case.problemas[deteccion.problema]
    lines = ["REQUERIMIENTO", *_wrap(case.texto, "  "), "", "PROBLEMA SEMBRADO"]
    lines += _wrap(f"{TYPE_NAMES[problema.tipo]}: {problema.descripcion}", "  ")
    lines += ["", "DECISIÓN DEL EMPAREJADOR"]
    if deteccion.detectado and deteccion.observacion is not None:
        o = result.artefactos.observaciones[deteccion.observacion]
        obs = o.observacion
        lines.append("  Detectado por esta observación del Revisor:")
        lines += _wrap(f"{TYPE_NAMES[obs.tipo]} (ronda {o.ronda}): {obs.descripcion}", "    ")
        lines += _wrap(f"Sugerencia: {obs.sugerencia}", "    ")
    else:
        lines.append("  No detectado por ninguna observación. Las observaciones del Revisor:")
        todas = result.artefactos.observaciones or []
        if not todas:
            lines.append("    (ninguna)")
        for i, o in enumerate(todas):
            lines += _wrap(f"{i}. {o.observacion.descripcion}", "    ")
    lines += _wrap(f"Justificación: {deteccion.justificacion}", "  ")
    return lines


def page(lines: list[str], read: Callable[[str], str], out: TextIO) -> None:
    """Shows PAGE_LINES at a time; Enter shows more and q skips to the questions."""
    for start in range(0, len(lines), PAGE_LINES):
        print("\n".join(lines[start : start + PAGE_LINES]), file=out)
        if start + PAGE_LINES < len(lines):
            answer = read(
                f"-- {start + PAGE_LINES} de {len(lines)} líneas · Enter sigue, q termina -- "
            )
            if answer.strip().lower() == "q":
                return
