import io

from criteria.adapters.cli.eval_view import PAGE_LINES, format_check, format_run, page
from criteria.domain.artifacts import CasoPrueba, CriterioAceptacion, HistoriaUsuario
from criteria.domain.evaluation import ArtefactosCaso, CaseResult, Deteccion, ObservacionEnRonda
from tests import factories as f
from tests.eval_factories import case, observacion, result


def full_result() -> CaseResult:
    entrega = f.entrega_qa(1)
    return result("dificil-01").model_copy(
        update={
            "artefactos": ArtefactosCaso(
                historias=[HistoriaUsuario.model_validate(f.historia(1))],
                criterios=[CriterioAceptacion.model_validate(c) for c in entrega["criterios"]],
                casos=[CasoPrueba.model_validate(c) for c in entrega["casos"]],
                observaciones=[
                    ObservacionEnRonda(ronda=0, observacion=observacion("Corregida")),
                    ObservacionEnRonda(
                        ronda=2, observacion=observacion("Sigue pendiente"), se_corrige=False
                    ),
                ],
            )
        }
    )


def test_a_run_shows_the_artifacts_the_judge_saw_without_the_model() -> None:
    text = "\n".join(format_run(case("dificil-01"), full_result()))

    for section in ("REQUERIMIENTO", "HISTORIAS", "CRITERIOS DE ACEPTACIÓN", "CASOS DE PRUEBA"):
        assert section in text
    assert "HU-1 [" in text
    assert "CA-1 [HU-1]" in text
    assert "| Dado" in text
    assert "Resultado esperado:" in text
    assert "Faltante: Sigue pendiente" in text
    assert "Corregida" not in text
    assert "openai" not in text


def test_without_pending_observations_it_says_so() -> None:
    assert "  (ninguna)" in format_run(case("facil-01"), result("facil-01", observaciones=0))


def test_a_check_shows_the_matching_observation_or_all_of_them() -> None:
    run = full_result()
    found = format_check(
        case("dificil-01"),
        run,
        Deteccion(problema=0, detectado=True, observacion=1, justificacion="La pendiente lo cubre"),
    )
    missed = format_check(
        case("dificil-01"),
        run,
        Deteccion(problema=1, detectado=False, justificacion="Ninguna habla de esto"),
    )
    empty = format_check(
        case("dificil-01"),
        result("dificil-01", observaciones=0),
        Deteccion(problema=0, detectado=False, justificacion="Sin observaciones"),
    )

    assert "Detectado por esta observación del Revisor:" in "\n".join(found)
    assert "Sigue pendiente" in "\n".join(found)
    assert "0. Corregida" in "\n".join(missed)
    assert "    (ninguna)" in empty


def test_paging_stops_when_asked() -> None:
    out = io.StringIO()
    prompts: list[str] = []
    lines = [f"línea {i}" for i in range(PAGE_LINES * 3)]

    def stop(prompt: str) -> str:
        prompts.append(prompt)
        return "q"

    page(lines, stop, out)

    assert len(prompts) == 1
    assert "línea 29" in out.getvalue()
    assert "línea 30" not in out.getvalue()
