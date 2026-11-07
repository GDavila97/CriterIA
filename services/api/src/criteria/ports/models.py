from collections.abc import Collection
from typing import Protocol

from criteria.domain.events import ProveedorId
from criteria.domain.run_config import Nivel, ProviderSelection, RolAgente


class ProviderNotAllowedError(ValueError):
    codigo = "proveedor_no_permitido"


class KeyRequiredError(ProviderNotAllowedError):
    codigo = "clave_requerida"


class EndpointRejectedError(ValueError):
    """A user-supplied endpoint failed the outbound checks (scheme, address, redirects, size)."""

    codigo = "destino_no_permitido"


class ModelRouter(Protocol):
    def server_access(self, provider: ProveedorId) -> bool: ...

    def available(self, user_keys: Collection[ProveedorId] = ()) -> list[ProveedorId]: ...

    def has_tier(self, provider: ProveedorId, nivel: Nivel) -> bool: ...

    def tiers(self, provider: ProveedorId) -> dict[Nivel, str]: ...

    def models(self, provider: ProveedorId) -> list[str]: ...

    def validate(self, selection: ProviderSelection) -> ProviderSelection: ...

    def estimate_parts(
        self, generacion: ProviderSelection, juez: ProviderSelection
    ) -> tuple[float | None, float | None]:
        """Typical cost of the generation agents and of the judge for one run."""
        ...

    def estimate_agent(self, rol: RolAgente, selection: ProviderSelection) -> float | None:
        """Typical cost of one agent in a run; null when the model has no price."""
        ...
