"""Writes the evaluation report: Markdown tables, one SVG chart per criterion and a JSON summary."""

import json
from collections.abc import Collection, Mapping, Sequence
from dataclasses import asdict
from html import escape

from criteria.application.report import JudgeAgreement, ModelSummary, SampleScores, same_order
from criteria.application.stability import SelfAgreement
from criteria.domain.artifacts import CRITERIOS, TipoObservacion
from criteria.domain.eval_metrics import Agreement, Estimate
from criteria.domain.eval_sampling import DetectionRate
from criteria.domain.evaluation import DIFICULTADES, EvalCase

CRITERIA_NAMES = {
    "claridad": "Claridad",
    "verificabilidad": "Verificabilidad",
    "completitud": "Completitud",
    "consistencia": "Consistencia",
}
LEVEL_NAMES = {"facil": "Fáciles", "medio": "Medios", "dificil": "Difíciles"}
TYPE_NAMES: dict[TipoObservacion, str] = {
    "ambiguedad": "Ambigüedad",
    "inconsistencia": "Inconsistencia",
    "faltante": "Faltante",
}
PROVIDER_NAMES = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "groq": "Groq",
    "ollama": "Ollama",
    "openai_compatible": "Compatible con OpenAI",
}
# Categorical slots 1 to 4 of the reference palette, validated for adjacent bars on light.
SERIES = ("#2a78d6", "#eb6834", "#1baf7a", "#eda100")
SURFACE, INK, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"


def label(summary: ModelSummary) -> str:
    star = " *" if summary.juez_mismo_proveedor else ""
    return (
        f"{PROVIDER_NAMES.get(summary.proveedor, summary.proveedor)} · {summary.display_name}"
        f" ({summary.output_mode}){star}"
    )


def _num(value: float | None, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{value:.0%}"


def _secs(ms: float | None) -> str:
    return "—" if ms is None else f"{ms / 1000:.0f} s"


def _usd(value: float | None) -> str:
    return "—" if value is None else f"{value:.4f}"


def _rate(rate: DetectionRate) -> str:
    return f"{_pct(rate.rate)} ({rate.detected} de {rate.total})"


def _interval(estimate: Estimate, fmt: str = "{:.2f}") -> str:
    if estimate.value is None:
        return "—"
    if estimate.low is None or estimate.high is None:
        return fmt.format(estimate.value)
    return f"{fmt.format(estimate.value)} [{fmt.format(estimate.low)}, {fmt.format(estimate.high)}]"


def _table(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return lines


def _distribution_row(name: str, counts: Mapping[int, int]) -> list[str]:
    total = sum(counts.values())
    average = sum(v * n for v, n in counts.items()) / total if total else None
    return [name, *(str(n) for n in counts.values()), _num(average)]


def _agreement_row(name: str, a: Agreement) -> list[str]:
    pct = "{:.0%}"
    return [
        name,
        str(a.pairs),
        _interval(a.kappa),
        _interval(a.spearman),
        _interval(a.exact, pct),
        _interval(a.within_one, pct),
        _interval(a.judge_minus_human, "{:+.2f}"),
    ]


def markdown(  # noqa: PLR0913  every part of the report is an input
    summaries: Sequence[ModelSummary],
    cases: Mapping[str, EvalCase],
    *,
    common: Collection[str],
    judge: JudgeAgreement | None,
    matcher: Estimate | None,
    matcher_checks: int,
    undetected: Sequence[tuple[str, int]],
    judge_self: SelfAgreement | None = None,
    matcher_self: SelfAgreement | None = None,
    sample: Sequence[SampleScores] = (),
) -> str:
    out = ["## Resultados por modelo", ""]
    out += _table(
        ["Modelo", "Completas", "Global", *CRITERIA_NAMES.values()],
        [
            [
                label(s),
                f"{s.completas} de {s.corridas}",
                _num(s.puntaje_global),
                *(_num(s.puntajes[c]) for c in CRITERIOS),
            ]
            for s in summaries
        ],
    )
    out += ["", "## Comparación sobre los casos comunes", ""]
    shared = sorted(common)
    out.append(
        f"{len(shared)} casos que todos los modelos completaron y el juez calificó: "
        + (", ".join(f"`{c}`" for c in shared) or "ninguno")
        + ". El promedio general de cada modelo usa todas sus corridas completas; el de los casos "
        "comunes compara a todos sobre el mismo terreno."
    )
    out.append("")
    out += _table(
        ["Modelo", "Global (todas)", "Global (comunes)", *CRITERIA_NAMES.values()],
        [
            [
                label(s),
                f"{_num(s.puntaje_global)} ({s.completas})",
                f"{_num(s.comunes.puntaje_global)} ({s.comunes.casos})",
                *(_num(s.comunes.puntajes[c]) for c in CRITERIOS),
            ]
            for s in summaries
        ],
    )
    out += ["", "Entre paréntesis, las corridas que entran en cada promedio.", ""]
    out += ["## Operación por modelo", ""]
    out += _table(
        [
            "Modelo",
            "Válidas a la primera",
            "Rondas medias",
            "Latencia p50",
            "Latencia p95",
            "Tokens por corrida",
            "Costo por corrida (USD)",
            "Costo del lote (USD)",
        ],
        [
            [
                label(s),
                f"{_pct(s.tasa_validas)} ({s.validas} de {s.llamadas})",
                _num(s.rondas_media, 1),
                _secs(s.latencia_p50_ms),
                _secs(s.latencia_p95_ms),
                _num(s.tokens_por_corrida, 0),
                _usd(s.costo_por_corrida),
                _usd(s.costo_gastado_usd),
            ]
            for s in summaries
        ],
    )
    out += ["", "## Errores por código", ""]
    out += _table(
        ["Modelo", "Errores"],
        [
            [
                label(s),
                ", ".join(f"`{code}`: {n}" for code, n in sorted(s.errores.items())) or "ninguno",
            ]
            for s in summaries
        ],
    )
    out += ["", "## Por dificultad", ""]
    out += _table(
        ["Modelo", *(f"{LEVEL_NAMES[d]}: completas · global" for d in DIFICULTADES)],
        [
            [
                label(s),
                *(
                    f"{s.por_dificultad[d].completas} de {s.por_dificultad[d].corridas} · "
                    f"{_num(s.por_dificultad[d].puntaje_global)}"
                    for d in DIFICULTADES
                ),
            ]
            for s in summaries
        ],
    )
    out += ["", "## Detección de problemas sembrados (casos difíciles)", ""]
    shared_hard = min((s.deteccion_comunes.casos for s in summaries), default=0)
    out += _table(
        [
            "Modelo",
            "Casos emparejados",
            "Total",
            *TYPE_NAMES.values(),
            f"En los difíciles comunes ({shared_hard})",
        ],
        [
            [
                label(s),
                f"{s.deteccion.casos} de {s.deteccion.casos_dificiles}"
                + ("" if s.deteccion.comparable else " †"),
                _rate(s.deteccion.total),
                *(_rate(s.deteccion.by_type[t]) for t in TYPE_NAMES),
                _rate(s.deteccion_comunes.total),
            ]
            for s in summaries
        ],
    )
    if not all(s.deteccion.comparable for s in summaries):
        out += [
            "",
            "† No directamente comparable: el modelo no completó todos los casos difíciles y el "
            "emparejador solo leyó los que completó. La última columna compara a todos sobre los "
            "mismos casos.",
        ]
    out += ["", "Problemas que ningún modelo detectó, entre los que completaron cada caso:", ""]
    out += [
        f"- `{case_id}` ({TYPE_NAMES[cases[case_id].problemas[i].tipo]}): "
        f"{cases[case_id].problemas[i].descripcion}"
        for case_id, i in undetected
    ] or ["- Ninguno."]
    out += ["", "## Acuerdo del juez con la calificación humana", ""]
    if judge is None:
        out.append("Pendiente: todavía no hay calificación humana.")
    else:
        out += _table(
            [
                "Criterio",
                "Pares",
                "Kappa ponderada",
                "Spearman",
                "Exacto",
                "±1",
                "Juez menos humano",
            ],
            [
                _agreement_row("Todos", judge.total),
                *(_agreement_row(CRITERIA_NAMES[c], judge.por_criterio[c]) for c in CRITERIOS),
            ],
        )
        out += [
            "",
            "Intervalos al 95 % por bootstrap de los pares (2,000 remuestreos, semilla fija).",
            "",
            "Distribución de los puntajes en esos pares:",
            "",
        ]
        out += _table(
            ["Quién", *(str(v) for v in judge.distribucion_juez), "Media"],
            [
                _distribution_row("Juez", judge.distribucion_juez),
                _distribution_row("Persona", judge.distribucion_humano),
            ],
        )
    if sample:
        names = {s.clave: label(s) for s in summaries}
        out += ["", "Por modelo en la muestra humana (descriptivo, no concluyente):", ""]
        out += _table(
            ["Modelo", "Corridas", "Juez", "Persona"],
            [
                [names.get(s.clave, s.clave), str(s.corridas), _num(s.juez), _num(s.persona)]
                for s in sample
            ],
        )
        out += [
            "",
            "El orden de los modelos "
            + ("coincide" if same_order(sample) else "no coincide")
            + " entre el juez y la persona.",
        ]
    out += ["", "## Acuerdo del emparejador con la revisión humana", ""]
    out.append(
        "Pendiente: todavía no hay revisión humana."
        if matcher is None
        else f"{_interval(matcher, '{:.0%}')} de {matcher_checks} emparejamientos revisados."
    )
    out += ["", "## Estabilidad: el juez y el emparejador contra sí mismos", ""]
    out += _table(
        ["Quién", "Pares", "Kappa", "Acuerdo exacto"],
        [
            [name, str(a.pairs), _interval(a.kappa), _interval(a.exact, "{:.0%}")]
            for name, a in (
                ("Juez (puntaje por criterio, ponderada cuadrática)", judge_self),
                ("Emparejador (detectado o no)", matcher_self),
            )
            if a is not None
        ]
        or [["Pendiente", "—", "—", "—"]],
    )
    out += ["", "\\* El juez es del mismo proveedor que este modelo (posible autopreferencia).", ""]
    return "\n".join(out)


def _bar_value(summary: ModelSummary, group: int) -> float | None:
    if group < len(CRITERIOS):
        return summary.puntajes[CRITERIOS[group]]
    return summary.puntaje_global if group == len(CRITERIOS) else summary.comunes.puntaje_global


def chart_svg(summaries: Sequence[ModelSummary]) -> str:
    """Grouped bars: the criteria, the overall score and the score on common cases, scale 1 to 5."""
    groups = [*(CRITERIA_NAMES[c] for c in CRITERIOS), "Global", "Casos comunes"]
    width, height = 760, 360
    left, right, top, bottom = 48, 16, 64, 56
    plot_w, plot_h = width - left - right, height - top - bottom
    group_w = plot_w / len(groups)
    bar_w, gap = 22.0, 2.0
    span = len(summaries) * bar_w + (len(summaries) - 1) * gap

    def y(value: float) -> float:
        return top + plot_h * (1 - (value - 1) / 4)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" font-family="system-ui, sans-serif" '
        f'aria-labelledby="titulo descripcion">',
        '<title id="titulo">Puntaje medio por criterio y modelo, evaluación v1</title>',
        '<desc id="descripcion">Barras agrupadas en escala de 1 a 5; los valores exactos están '
        "en la tabla de resultados por modelo.</desc>",
        f'<rect width="{width}" height="{height}" fill="{SURFACE}"/>',
    ]
    for tick in range(1, 6):
        ty = y(tick)
        parts.append(
            f'<line x1="{left}" x2="{width - right}" y1="{ty:.1f}" y2="{ty:.1f}" '
            f'stroke="{GRID}" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{left - 8}" y="{ty + 4:.1f}" text-anchor="end" font-size="12" '
            f'fill="{MUTED}">{tick}</text>'
        )
    for gi, group in enumerate(groups):
        start = left + gi * group_w + (group_w - span) / 2
        for si, summary in enumerate(summaries):
            value = _bar_value(summary, gi)
            if value is None:
                continue
            x = start + si * (bar_w + gap)
            top_y = y(value)
            bar_h = y(1) - top_y
            parts.append(
                f'<path d="M{x:.1f},{y(1):.1f} V{top_y + 4:.1f} '
                f"Q{x:.1f},{top_y:.1f} {x + 4:.1f},{top_y:.1f} H{x + bar_w - 4:.1f} "
                f'Q{x + bar_w:.1f},{top_y:.1f} {x + bar_w:.1f},{top_y + 4:.1f} V{y(1):.1f} Z" '
                f'fill="{SERIES[si % len(SERIES)]}"><title>{escape(label(summary))}: '
                f"{value:.2f}</title></path>"
                if bar_h > 4  # noqa: PLR2004  a rounded top needs the radius
                else f'<rect x="{x:.1f}" y="{top_y:.1f}" width="{bar_w}" height="{bar_h:.1f}" '
                f'fill="{SERIES[si % len(SERIES)]}"/>'
            )
            if gi >= len(CRITERIOS):
                parts.append(
                    f'<text x="{x + bar_w / 2:.1f}" y="{top_y - 6:.1f}" text-anchor="middle" '
                    f'font-size="11" fill="{INK}">{value:.1f}</text>'
                )
        parts.append(
            f'<text x="{left + gi * group_w + group_w / 2:.1f}" y="{height - bottom + 22}" '
            f'text-anchor="middle" font-size="13" fill="{INK}">{group}</text>'
        )
    legend_x = left
    for si, summary in enumerate(summaries):
        name = escape(label(summary))
        parts.append(
            f'<rect x="{legend_x}" y="20" width="12" height="12" rx="2" '
            f'fill="{SERIES[si % len(SERIES)]}"/>'
        )
        parts.append(f'<text x="{legend_x + 18}" y="30" font-size="12" fill="{INK}">{name}</text>')
        legend_x += 26 + 7 * len(label(summary))
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def summary_json(  # noqa: PLR0913  every part of the report is an input
    summaries: Sequence[ModelSummary],
    *,
    judge: JudgeAgreement | None,
    matcher: Estimate | None,
    undetected: Sequence[tuple[str, int]],
    judge_self: SelfAgreement | None,
    matcher_self: SelfAgreement | None,
) -> str:
    return (
        json.dumps(
            {
                "modelos": [asdict(s) for s in summaries],
                "acuerdo_juez": None if judge is None else asdict(judge),
                "acuerdo_emparejador": None if matcher is None else asdict(matcher),
                "no_detectados": [list(item) for item in undetected],
                "estabilidad_juez": None if judge_self is None else asdict(judge_self),
                "estabilidad_emparejador": None if matcher_self is None else asdict(matcher_self),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
