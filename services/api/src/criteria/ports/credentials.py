from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from criteria.domain.events import ProveedorId


@dataclass(frozen=True)
class Sealed:
    ciphertext: bytes
    nonce: bytes
    key_version: int


class CipherError(Exception):
    """Decryption failed: wrong key version, tampered row or a ciphertext moved to another row."""


class Cipher(Protocol):
    def encrypt(self, plaintext: str, associated_data: bytes) -> Sealed: ...

    def decrypt(self, sealed: Sealed, associated_data: bytes) -> str: ...


@dataclass(frozen=True)
class StoredCredential:
    provider: ProveedorId
    sealed: Sealed
    last4: str
    base_url: str | None
    validated_at: datetime


class CredentialStore(Protocol):
    async def get(self, user_id: str, provider: ProveedorId) -> StoredCredential | None: ...

    async def list(self, user_id: str) -> list[StoredCredential]: ...

    async def upsert(self, user_id: str, credential: StoredCredential) -> None: ...

    async def delete(self, user_id: str, provider: ProveedorId) -> bool: ...

    async def record_check(self, user_id: str, at: datetime) -> None: ...

    async def checks_since(self, user_id: str, since: datetime) -> int: ...


def credential_aad(user_id: str, provider: ProveedorId) -> bytes:
    # Binds a ciphertext to its row: copying it to another user or provider fails to decrypt.
    return f"criteria-credential\x1f{user_id}\x1f{provider}".encode()
