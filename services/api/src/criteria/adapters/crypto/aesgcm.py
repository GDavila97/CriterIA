import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from criteria.ports.credentials import CipherError, Sealed

NONCE_BYTES = 12


class AesGcmCipher:
    """AES-256-GCM with a fresh random 96-bit nonce per encryption and versioned keys."""

    def __init__(self, keys: dict[int, bytes], active_version: int) -> None:
        if active_version not in keys:
            raise ValueError("the active key version is not configured")
        self._keys = {version: AESGCM(key) for version, key in keys.items()}
        self._active = active_version

    def encrypt(self, plaintext: str, associated_data: bytes) -> Sealed:
        nonce = os.urandom(NONCE_BYTES)
        ciphertext = self._keys[self._active].encrypt(nonce, plaintext.encode(), associated_data)
        return Sealed(ciphertext=ciphertext, nonce=nonce, key_version=self._active)

    def decrypt(self, sealed: Sealed, associated_data: bytes) -> str:
        key = self._keys.get(sealed.key_version)
        if key is None:
            raise CipherError("the key version of this credential is not configured")
        try:
            return key.decrypt(sealed.nonce, sealed.ciphertext, associated_data).decode()
        except InvalidTag:
            raise CipherError("the credential could not be decrypted") from None
