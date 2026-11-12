import json
from xml.etree import ElementTree

from criteria.adapters.eval.report import chart_svg, label, markdown, summary_json
from criteria.application.report import (
    ModelSummary,
    SampleScores,
    common_cases,
    judge_agreement,
    matcher_agreement,
    summarize,
    summarize_batch,
)
from criteria.application.stability import SelfAgreement
from criteria.domain.eval_metrics import Estimate
from criteria.domain.evaluation import EvalBatch, HumanSession, MatchCheck
from tests.eval_factories import all_cases, batch, full_batch, result

CASES = all_cases()


def batches() -> list[EvalBatch]:
    haiku = full_batch("anthropic", "claude-haiku-5-5")
    return [
        haiku.model_copy(
            update={
                "deteccion": batch(
                    detections={f"dificil-0{i}": [True, False] for i in range(1, 6)}
                ).deteccion
            }
        ),
        batch(
            "groq",
            "openai/gpt-oss-20b",
            [result("facil-01"), result("dificil-01", estado="error", scores=None)],
            detections={"dificil-02": [False, False]},
        ),
    ]


def summaries() -> list[ModelSummary]:
    return summarize(batches(), CASES)


def test_labels_name_the_provider_model_output_mode_and_the_bias_mark() -> None:
    haiku, groq = summaries()
    assert label(haiku) == "Anthropic · claude-haiku-5-5 (tool) *"
    assert label(groq) == "Groq · openai/gpt-oss-20b (tool)"


def test_tables_cover_every_section_and_say_what_is_still_pending() -> None:
    text = markdown(
        summaries(),
        CASES,
        common=common_cases(batches()),
        judge=None,
        matcher=None,
        matcher_checks=0,
        undetected=[("dificil-02", 0)],
    )

    for heading in (
        "## Resultados por modelo",
        "## Comparación sobre los casos comunes",
        "## Operación por modelo",
        "## Errores por código",
        "## Por dificultad",
        "## Detección de problemas sembrados",
        "## Acuerdo del juez con la calificación humana",
        "## Estabilidad",
    ):
        assert heading in text
    assert "`salida_invalida`: 1" in text
    assert "1 de 2" in text
    assert "`dificil-02` (Ambigüedad)" in text
    assert "Pendiente: todavía no hay calificación humana." in text
    assert "| Pendiente | — | — | — |" in text
    assert "1 casos que todos los modelos completaron y el juez calificó: `facil-01`." in text
    assert "| Anthropic · claude-haiku-5-5 (tool) * | 4.00 (15) | 4.00 (1) |" in text
    assert "| 5 de 5 | 50% (5 de 10) |" in text
    assert "| 1 de 5 † | 0% (0 de 2) |" in text
    assert "En los difíciles comunes (1)" in text
    assert "| 50% (1 de 2) |\n| Groq" in text
    assert "† No directamente comparable" in text


def test_tables_with_human_scores_and_stability() -> None:
    b = full_batch("openai", "gpt-6-luna")
    agreement = judge_agreement([("claridad", 4, 4), ("completitud", 3, 2), ("claridad", 2, 3)])
    session = HumanSession(
        semilla=1,
        emparejamientos=[
            MatchCheck(batch_id=b.batch_id, case_id="dificil-01", problema=0, acierta=True)
        ],
    )
    stable = SelfAgreement(pairs=40, kappa=Estimate(0.8, 0.6, 0.9), exact=Estimate(0.7, 0.55, 0.85))

    sample = [SampleScores("openai:gpt-6-luna", 3, 2.5, 4.5)]
    text = markdown(
        [summarize_batch(b, CASES)],
        CASES,
        sample=sample,
        common=[],
        judge=agreement,
        matcher=matcher_agreement(session),
        matcher_checks=1,
        undetected=[],
        judge_self=stable,
        matcher_self=stable,
    )

    assert "| Todos | 3 |" in text
    assert "| OpenAI · gpt-6-luna (tool) | 3 | 2.50 | 4.50 |" in text
    assert "El orden de los modelos coincide entre el juez y la persona." in text
    assert "| Quién | 1 | 2 | 3 | 4 | 5 | Media |" in text
    assert "| Juez | 0 | 1 | 1 | 1 | 0 | 3.00 |" in text
    assert "| Persona | 0 | 1 | 1 | 1 | 0 | 3.00 |" in text
    assert "100% [100%, 100%] de 1 emparejamientos revisados." in text
    assert "| Juez (puntaje por criterio, ponderada cuadrática) | 40 | 0.80 [0.60, 0.90] |" in text
    assert "- Ninguno." in text
    assert "0 casos que todos los modelos completaron y el juez calificó: ninguno." in text


def test_the_chart_is_valid_svg_with_a_legend_and_labels_on_the_overall_group() -> None:
    svg = chart_svg(summaries())

    root = ElementTree.fromstring(svg)  # noqa: S314  our own output, not untrusted input
    texts = ["".join(t.itertext()) for t in root.iter("{http://www.w3.org/2000/svg}text")]
    assert "Anthropic · claude-haiku-5-5 (tool) *" in texts
    assert "Global" in texts
    assert "Casos comunes" in texts
    assert "4.0" in texts
    assert root.find("{http://www.w3.org/2000/svg}title") is not None


def test_the_json_summary_round_trips() -> None:
    data = json.loads(
        summary_json(
            summaries(),
            judge=None,
            matcher=None,
            undetected=[("dificil-02", 1)],
            judge_self=None,
            matcher_self=None,
        )
    )
    assert [m["clave"] for m in data["modelos"]] == [
        "anthropic:claude-haiku-5-5",
        "groq:openai/gpt-oss-20b",
    ]
    assert data["no_detectados"] == [["dificil-02", 1]]
