import pytest
from pydantic import ValidationError

from criteria.domain.artifacts import (
    MAX_CASOS,
    MAX_HISTORIAS,
    CasoPrueba,
    CriterioAceptacion,
    EntregaQA,
    Evaluacion,
    Historias,
    HistoriaUsuario,
    Observacion,
    Puntaje,
    Requerimiento,
    VeredictoRevisor,
)
from tests import factories as f


class TestRequerimiento:
    def test_accepts_multiline_text_within_limits(self) -> None:
        texto = "Línea uno del requerimiento\n\tcon detalle"
        assert Requerimiento(texto=texto).texto == texto

    @pytest.mark.parametrize("length", [19, 2001])
    def test_rejects_text_outside_20_to_2000_characters(self, length: int) -> None:
        with pytest.raises(ValidationError):
            Requerimiento(texto="a" * length)

    @pytest.mark.parametrize("character", [chr(c) for c in (0x00, 0x1B, 0x7F, 0x200B, 0x202E)])
    def test_rejects_control_and_invisible_characters(self, character: str) -> None:
        with pytest.raises(ValidationError, match="control or non-printable"):
            Requerimiento(texto=f"Requerimiento válido de prueba {character} con texto")

    def test_strips_surrounding_whitespace_before_counting(self) -> None:
        with pytest.raises(ValidationError):
            Requerimiento(texto="   corto   " + " " * 30)


class TestIds:
    @pytest.mark.parametrize("value", ["HU-1", "HU-12", "HU-99"])
    def test_story_ids_follow_hu_n(self, value: str) -> None:
        assert HistoriaUsuario.model_validate(f.historia(id=value)).id == value

    @pytest.mark.parametrize("value", ["HU-0", "HU-01", "hu-1", "HU-100", "US-1", "HU1"])
    def test_rejects_malformed_story_ids(self, value: str) -> None:
        with pytest.raises(ValidationError):
            HistoriaUsuario.model_validate(f.historia(id=value))

    @pytest.mark.parametrize("value", ["CP-1", "CP-001", "cp-01", "CP-AB"])
    def test_test_case_ids_need_two_digits(self, value: str) -> None:
        with pytest.raises(ValidationError):
            CasoPrueba.model_validate(f.caso(id=value))

    @pytest.mark.parametrize("value", ["CA-0", "CA-1000", "CA-x"])
    def test_rejects_malformed_criterion_ids(self, value: str) -> None:
        with pytest.raises(ValidationError):
            CriterioAceptacion(id=value, historia_id="HU-1", texto="Algo verificable")


class TestEnums:
    def test_rejects_unknown_priority(self) -> None:
        with pytest.raises(ValidationError):
            HistoriaUsuario.model_validate(f.historia(prioridad="urgente"))

    def test_rejects_unknown_observation_type_and_target(self) -> None:
        with pytest.raises(ValidationError):
            Observacion.model_validate(f.observacion(tipo="estilo"))
        with pytest.raises(ValidationError):
            Observacion.model_validate(f.observacion(destino="evaluador"))

    def test_case_origin_defaults_to_qa_and_accepts_only_known_origins(self) -> None:
        assert CasoPrueba.model_validate(f.caso()).origen == "qa"
        with pytest.raises(ValidationError):
            CasoPrueba.model_validate(f.caso(origen="usuario"))

    def test_rejects_unknown_fields(self) -> None:
        with pytest.raises(ValidationError):
            HistoriaUsuario.model_validate(f.historia(extra="no"))


class TestListLimits:
    def test_at_most_12_stories(self) -> None:
        Historias.model_validate(f.historias(MAX_HISTORIAS))
        with pytest.raises(ValidationError):
            Historias.model_validate(f.historias(MAX_HISTORIAS + 1))

    def test_at_least_one_story(self) -> None:
        with pytest.raises(ValidationError):
            Historias(historias=[])

    def test_at_most_60_test_cases(self) -> None:
        EntregaQA.model_validate(f.entrega_qa(MAX_CASOS))
        with pytest.raises(ValidationError):
            EntregaQA.model_validate(f.entrega_qa(MAX_CASOS + 1))

    def test_gherkin_needs_every_step_list(self) -> None:
        data = f.caso()
        data["gherkin"]["entonces"] = []
        with pytest.raises(ValidationError):
            CasoPrueba.model_validate(data)

    def test_limits_field_lengths(self) -> None:
        with pytest.raises(ValidationError):
            HistoriaUsuario.model_validate(f.historia(quiero="x" * 301))
        with pytest.raises(ValidationError):
            HistoriaUsuario.model_validate(f.historia(supuestos=["ok"] * 9))


class TestUniqueness:
    def test_rejects_duplicated_story_ids(self) -> None:
        with pytest.raises(ValidationError, match="duplicated story ids: HU-1"):
            Historias(historias=[f.historia(1), f.historia(1)])  # type: ignore[list-item]

    def test_rejects_duplicated_case_ids(self) -> None:
        data = f.entrega_qa(1)
        data["casos"].append(f.caso(1))
        with pytest.raises(ValidationError, match="duplicated test case ids"):
            EntregaQA.model_validate(data)


class TestVeredicto:
    def test_approved_verdict_has_no_observations(self) -> None:
        with pytest.raises(ValidationError, match="approved verdict"):
            VeredictoRevisor.model_validate({"aprobado": True, "observaciones": [f.observacion()]})

    def test_rejected_verdict_needs_observations(self) -> None:
        with pytest.raises(ValidationError, match="rejected verdict"):
            VeredictoRevisor(aprobado=False, observaciones=[])


class TestPuntajes:
    @pytest.mark.parametrize("valor", [0, 6])
    def test_score_between_1_and_5(self, valor: int) -> None:
        with pytest.raises(ValidationError):
            Puntaje(criterio="claridad", valor=valor, justificacion="Breve")

    def test_justification_up_to_280_characters(self) -> None:
        Puntaje(criterio="claridad", valor=3, justificacion="x" * 280)
        with pytest.raises(ValidationError):
            Puntaje(criterio="claridad", valor=3, justificacion="x" * 281)

    def test_evaluation_scores_each_criterion_once(self) -> None:
        Evaluacion.model_validate(f.evaluacion())
        data = f.evaluacion()
        data["puntajes"][1]["criterio"] = "claridad"
        with pytest.raises(ValidationError, match="duplicated criteria"):
            Evaluacion.model_validate(data)
