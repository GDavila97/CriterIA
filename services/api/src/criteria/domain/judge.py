from collections.abc import Collection

from criteria.domain.artifacts import Esquema
from criteria.domain.events import ProveedorId

# Anthropic first because the official evaluation judges with Claude Haiku; local models last.
JUDGE_PREFERENCE: tuple[ProveedorId, ...] = (
    "anthropic",
    "openai",
    "groq",
    "openai_compatible",
    "ollama",
)


class EleccionJuez(Esquema):
    proveedor: ProveedorId
    mismo_proveedor: bool


def elegir_juez(disponibles: Collection[ProveedorId], generacion: ProveedorId) -> EleccionJuez:
    """A judge from another provider avoids self-preference; with no other option it says so."""
    for proveedor in JUDGE_PREFERENCE:
        if proveedor in disponibles and proveedor != generacion:
            return EleccionJuez(proveedor=proveedor, mismo_proveedor=False)
    return EleccionJuez(proveedor=generacion, mismo_proveedor=True)
