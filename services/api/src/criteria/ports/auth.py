from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Principal:
    user_id: str
    email_verified: bool


class AuthError(Exception):
    """The token is missing, malformed, expired or not signed by the web; never says which."""


class TokenVerifier(Protocol):
    async def verify(self, token: str) -> Principal: ...
