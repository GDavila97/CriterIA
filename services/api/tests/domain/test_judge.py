import pytest

from criteria.domain.events import ProveedorId
from criteria.domain.judge import elegir_juez


@pytest.mark.parametrize(
    ("disponibles", "generacion", "esperado"),
    [
        (["groq", "anthropic", "openai"], "openai", "anthropic"),
        (["groq", "openai"], "openai", "groq"),
        (["anthropic", "groq"], "anthropic", "groq"),
        (["ollama", "groq"], "ollama", "groq"),
        (["openai_compatible", "ollama"], "ollama", "openai_compatible"),
    ],
)
def test_prefers_a_judge_from_another_provider(
    disponibles: list[ProveedorId], generacion: ProveedorId, esperado: ProveedorId
) -> None:
    eleccion = elegir_juez(disponibles, generacion)

    assert eleccion.proveedor == esperado
    assert not eleccion.mismo_proveedor


@pytest.mark.parametrize("disponibles", [["groq"], []])
def test_falls_back_to_the_generation_provider_and_says_so(
    disponibles: list[ProveedorId],
) -> None:
    eleccion = elegir_juez(disponibles, "groq")

    assert eleccion.proveedor == "groq"
    assert eleccion.mismo_proveedor
