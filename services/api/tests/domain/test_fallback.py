import pytest

from criteria.domain.events import CodigoError, ProveedorId
from criteria.domain.fallback import respaldo_sugerido


@pytest.mark.parametrize("codigo", ["clave_invalida", "sin_saldo", "limite_proveedor"])
@pytest.mark.parametrize("proveedor", ["openai", "anthropic", "openai_compatible", "ollama"])
def test_account_failures_suggest_the_free_provider(
    codigo: CodigoError, proveedor: ProveedorId
) -> None:
    assert respaldo_sugerido(codigo, proveedor) == "groq"


@pytest.mark.parametrize("codigo", ["clave_invalida", "sin_saldo", "limite_proveedor"])
def test_groq_failures_never_suggest_groq(codigo: CodigoError) -> None:
    assert respaldo_sugerido(codigo, "groq") is None


@pytest.mark.parametrize(
    "codigo",
    ["salida_invalida", "proveedor_no_disponible", "destino_no_permitido", "error_interno"],
)
def test_other_failures_suggest_nothing(codigo: CodigoError) -> None:
    assert respaldo_sugerido(codigo, "openai") is None
