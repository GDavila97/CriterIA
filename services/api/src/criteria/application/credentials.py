import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from pydantic import SecretStr

from criteria.application.errors import CredentialRejectedError, InvalidInputError
from criteria.domain.events import ProveedorId
from criteria.domain.run_config import USER_KEY_PROVIDERS
from criteria.ports.clock import Clock
from criteria.ports.credentials import (
    Cipher,
    CipherError,
    CredentialStore,
    StoredCredential,
    credential_aad,
)
from criteria.ports.keys import KeyValidator
from criteria.ports.stores import LimitExceededError

logger = logging.getLogger(__name__)

MAX_KEY_LENGTH = 512


@dataclass(frozen=True)
class CredentialSummary:
    provider: ProveedorId
    last4: str
    validated_at: datetime
    base_url: str | None


@dataclass(frozen=True)
class ResolvedKey:
    api_key: SecretStr
    base_url: str | None


def _summary(credential: StoredCredential) -> CredentialSummary:
    return CredentialSummary(
        provider=credential.provider,
        last4=credential.last4,
        validated_at=credential.validated_at,
        base_url=credential.base_url,
    )


class CredentialService:
    def __init__(
        self,
        *,
        store: CredentialStore,
        cipher: Cipher,
        validator: KeyValidator,
        clock: Clock,
        checks_per_hour: int,
    ) -> None:
        self._store = store
        self._cipher = cipher
        self._validator = validator
        self._clock = clock
        self._checks_per_hour = checks_per_hour

    async def save(
        self, user_id: str, provider: ProveedorId, api_key: SecretStr, base_url: str | None
    ) -> CredentialSummary:
        key = api_key.get_secret_value().strip()
        if provider not in USER_KEY_PROVIDERS:
            raise InvalidInputError(f"{provider} does not take a user key")
        if not key or len(key) > MAX_KEY_LENGTH:
            raise InvalidInputError("the key is empty or too long")
        if (provider == "openai_compatible") != (base_url is not None):
            raise InvalidInputError("only openai_compatible takes, and needs, a base_url")
        now = self._clock.now()
        # Counted before checking, so the API cannot be used to test stolen keys in bulk.
        if (
            await self._store.checks_since(user_id, now - timedelta(hours=1))
            >= self._checks_per_hour
        ):
            raise LimitExceededError("limite_validaciones")
        await self._store.record_check(user_id, now)
        check = await self._validator.validate(provider, SecretStr(key), base_url)
        if check.estado != "valida":
            codigo = "clave_invalida" if check.estado == "invalida" else "clave_no_verificable"
            raise CredentialRejectedError(f"the {provider} key was not accepted", codigo)
        stored = StoredCredential(
            provider=provider,
            sealed=self._cipher.encrypt(key, credential_aad(user_id, provider)),
            last4=check.last4,
            base_url=base_url,
            validated_at=now,
        )
        await self._store.upsert(user_id, stored)
        return _summary(stored)

    async def list(self, user_id: str) -> list[CredentialSummary]:
        return [_summary(credential) for credential in await self._store.list(user_id)]

    async def providers(self, user_id: str) -> set[ProveedorId]:
        return {credential.provider for credential in await self._store.list(user_id)}

    async def delete(self, user_id: str, provider: ProveedorId) -> bool:
        return await self._store.delete(user_id, provider)

    async def resolve(self, user_id: str, provider: ProveedorId) -> ResolvedKey | None:
        credential = await self._store.get(user_id, provider)
        if credential is None:
            return None
        try:
            key = self._cipher.decrypt(credential.sealed, credential_aad(user_id, provider))
        except CipherError:
            logger.warning("stored %s credential could not be decrypted", provider)
            return None
        return ResolvedKey(api_key=SecretStr(key), base_url=credential.base_url)
