import base64
import os

import pytest

from criteria.adapters.crypto.aesgcm import AesGcmCipher
from criteria.config import parse_credential_keys
from criteria.ports.credentials import CipherError, credential_aad

KEY = "sk-user-9999-cipher-test"
AAD = credential_aad("user-1", "openai")


def cipher(active: int = 1, versions: tuple[int, ...] = (1,)) -> AesGcmCipher:
    keys = {version: bytes([version]) * 32 for version in versions}
    return AesGcmCipher(keys, active)


def test_round_trips_with_the_same_associated_data() -> None:
    box = cipher()

    assert box.decrypt(box.encrypt(KEY, AAD), AAD) == KEY


def test_each_encryption_uses_a_new_nonce_and_ciphertext() -> None:
    box = cipher()

    first, second = box.encrypt(KEY, AAD), box.encrypt(KEY, AAD)

    assert first.nonce != second.nonce
    assert first.ciphertext != second.ciphertext
    assert KEY.encode() not in first.ciphertext


@pytest.mark.parametrize(
    "aad", [credential_aad("user-2", "openai"), credential_aad("user-1", "anthropic")]
)
def test_a_ciphertext_moved_to_another_user_or_provider_fails(aad: bytes) -> None:
    box = cipher()

    with pytest.raises(CipherError, match="could not be decrypted"):
        box.decrypt(box.encrypt(KEY, AAD), aad)


def test_rotation_reads_old_rows_and_writes_with_the_active_key() -> None:
    old = cipher(active=1, versions=(1,))
    sealed_old = old.encrypt(KEY, AAD)
    rotated = cipher(active=2, versions=(1, 2))

    sealed_new = rotated.encrypt(KEY, AAD)

    assert rotated.decrypt(sealed_old, AAD) == KEY
    assert (sealed_old.key_version, sealed_new.key_version) == (1, 2)


def test_a_retired_key_version_cannot_decrypt() -> None:
    sealed = cipher(active=1, versions=(1,)).encrypt(KEY, AAD)

    with pytest.raises(CipherError, match="not configured"):
        cipher(active=2, versions=(2,)).decrypt(sealed, AAD)


def test_the_active_version_must_exist() -> None:
    with pytest.raises(ValueError, match="active key version"):
        AesGcmCipher({1: b"x" * 32}, 2)


def test_credential_keys_parse_and_reject_bad_material() -> None:
    one, two = (base64.b64encode(os.urandom(32)).decode() for _ in range(2))

    assert set(parse_credential_keys(f"1:{one}, 2:{two}")) == {1, 2}
    for raw in ("", "1:short", f"0:{one}", f"1:{one},1:{two}", f"x:{one}", "1:@@@"):
        with pytest.raises(ValueError, match=r"key|pairs") as error:
            parse_credential_keys(raw)
        assert one not in str(error.value)
