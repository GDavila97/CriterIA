from criteria.domain.artifacts import EntregaQA, Historias, VeredictoRevisor
from criteria.domain.rules import (
    cambios_historias,
    destino_correccion,
    historias_desconocidas,
    marcar_origen,
    referencias_desconocidas,
)
from tests import factories as f


def test_reports_test_artifacts_pointing_to_unknown_stories() -> None:
    entrega = EntregaQA.model_validate(f.entrega_qa(1, historia_ids=("HU-1", "HU-7")))

    assert historias_desconocidas(entrega, Historias.model_validate(f.historias(2))) == ["HU-7"]


def test_reports_reviewer_references_to_unknown_artifacts() -> None:
    veredicto = VeredictoRevisor.model_validate(
        f.veredicto(f.observacion(referencias=["HU-1", "CP-01", "CP-09"]))
    )
    entrega = EntregaQA.model_validate(f.entrega_qa(1))

    unknown = referencias_desconocidas(veredicto, Historias.model_validate(f.historias(1)), entrega)

    assert unknown == ["CP-09"]


def test_first_delivery_cases_always_come_from_qa() -> None:
    data = f.entrega_qa(2)
    data["casos"][1]["origen"] = "revisor"

    marcada = marcar_origen(EntregaQA.model_validate(data), previa=None)

    assert [caso.origen for caso in marcada.casos] == ["qa", "qa"]


def test_correction_marks_only_new_cases_as_reviewer_cases() -> None:
    previa = EntregaQA.model_validate(f.entrega_qa(2))
    nueva = EntregaQA.model_validate(f.entrega_qa(3))

    marcada = marcar_origen(nueva, previa)

    assert {caso.id: caso.origen for caso in marcada.casos} == {
        "CP-01": "qa",
        "CP-02": "qa",
        "CP-03": "revisor",
    }


def test_reviewer_origin_survives_later_rounds() -> None:
    ronda_1 = marcar_origen(
        EntregaQA.model_validate(f.entrega_qa(2)), EntregaQA.model_validate(f.entrega_qa(1))
    )

    ronda_2 = marcar_origen(EntregaQA.model_validate(f.entrega_qa(2)), ronda_1)

    assert ronda_2.casos[1].origen == "revisor"


def test_story_changes_list_added_modified_and_removed_ids() -> None:
    previas = Historias.model_validate(f.historias(3))
    nuevas = Historias.model_validate(
        {"historias": [f.historia(1), f.historia(2, prioridad="baja"), f.historia(4)]}
    )

    cambios = cambios_historias(previas, nuevas)

    assert (cambios.agregadas, cambios.modificadas, cambios.eliminadas) == (
        ["HU-4"],
        ["HU-2"],
        ["HU-3"],
    )
    assert cambios.hay_cambios()
    assert not cambios_historias(previas, previas).hay_cambios()


def test_any_story_observation_sends_the_correction_to_the_analyst() -> None:
    mixto = VeredictoRevisor.model_validate(
        f.veredicto(f.observacion("qa"), f.observacion("analista"))
    )
    solo_qa = VeredictoRevisor.model_validate(f.veredicto(f.observacion("qa")))

    assert destino_correccion(mixto) == "analista"
    assert destino_correccion(solo_qa) == "qa"
