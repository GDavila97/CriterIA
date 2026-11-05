from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import SecretStr

from criteria.domain.events import ProveedorId

EstadoClave = Literal["valida", "invalida", "no_verificable"]


@dataclass(frozen=True)
class KeyCheck:
    estado: EstadoClave
    last4: str


class KeyValidator(Protocol):
    async def validate(
        self, proveedor: ProveedorId, api_key: SecretStr, base_url: str | None = None
    ) -> KeyCheck:
        """Checks a key with the provider's cheapest call; never stores or logs the key."""
        ...
