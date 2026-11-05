from criteria.domain.events import CodigoError, ProveedorId, RespaldoSugerido

ACCOUNT_FAILURES: frozenset[CodigoError] = frozenset(
    {"clave_invalida", "sin_saldo", "limite_proveedor"}
)


def respaldo_sugerido(codigo: CodigoError, proveedor: ProveedorId) -> RespaldoSugerido | None:
    """Only a suggestion: switching providers would send the user's data to another third party."""
    if codigo in ACCOUNT_FAILURES and proveedor != "groq":
        return "groq"
    return None
