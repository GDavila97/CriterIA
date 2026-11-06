import base64
import json
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from jwt.algorithms import OKPAlgorithm

from criteria.adapters.auth.jwks import JwksCache, JwtVerifier, TokenPolicy
from criteria.ports.auth import AuthError
from tests.fakes import FakeClock

ISSUER = "https://web.example"
AUDIENCE = "criteria-api"
POLICY = TokenPolicy(
    issuer=ISSUER,
    audience=AUDIENCE,
    algorithms=frozenset({"EdDSA"}),
    verified_claim="email_verified",
    leeway_seconds=0,
)


class Keys:
    def __init__(self, kid: str = "k1") -> None:
        self.kid = kid
        self.private = Ed25519PrivateKey.generate()

    def jwk(self) -> dict[str, Any]:
        data: dict[str, Any] = json.loads(OKPAlgorithm.to_jwk(self.private.public_key()))
        return {**data, "kid": self.kid, "alg": "EdDSA", "use": "sig"}

    def token(self, **claims: Any) -> str:
        now = int(time.time())
        payload = {
            "sub": "user-1",
            "iss": ISSUER,
            "aud": AUDIENCE,
            "iat": now,
            "exp": now + 300,
            "email_verified": True,
            **claims,
        }
        return jwt.encode(
            {k: v for k, v in payload.items() if v is not None},
            self.private,
            algorithm="EdDSA",
            headers={"kid": self.kid},
        )


class Jwks:
    def __init__(self, *keys: Keys) -> None:
        self.keys = list(keys)
        self.fetches = 0

    async def __call__(self) -> dict[str, Any]:
        self.fetches += 1
        return {"keys": [k.jwk() for k in self.keys]}


def verifier(jwks: Jwks, clock: FakeClock | None = None, cache_seconds: float = 300) -> JwtVerifier:
    return JwtVerifier(JwksCache(jwks, clock or FakeClock(step_seconds=1), cache_seconds), POLICY)


async def test_accepts_a_valid_token_and_reads_the_verified_claim() -> None:
    keys = Keys()

    principal = await verifier(Jwks(keys)).verify(keys.token())

    assert (principal.user_id, principal.email_verified) == ("user-1", True)


async def test_unverified_email_is_reported_not_rejected() -> None:
    keys = Keys()

    principal = await verifier(Jwks(keys)).verify(keys.token(email_verified=None))

    assert principal.email_verified is False


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": int(time.time()) - 10},
        {"nbf": int(time.time()) + 600},
        {"aud": "someone-else"},
        {"iss": "https://evil.example"},
        {"sub": None},
        {"sub": ""},
        {"exp": None},
    ],
)
async def test_rejects_tokens_with_bad_claims(claims: dict[str, Any]) -> None:
    keys = Keys()

    with pytest.raises(AuthError):
        await verifier(Jwks(keys)).verify(keys.token(**claims))


async def test_rejects_a_signature_from_another_key_with_the_same_kid() -> None:
    trusted, attacker = Keys("k1"), Keys("k1")

    with pytest.raises(AuthError):
        await verifier(Jwks(trusted)).verify(attacker.token())


async def test_rejects_unknown_kids_and_refreshes_at_most_every_30_seconds() -> None:
    jwks = Jwks(Keys("k1"))
    stranger = Keys("k9")
    auth = verifier(jwks, FakeClock(step_seconds=1))

    for _ in range(5):
        with pytest.raises(AuthError):
            await auth.verify(stranger.token())

    assert jwks.fetches == 1


async def test_picks_up_a_rotated_key_after_the_refresh_interval() -> None:
    old, new = Keys("old"), Keys("new")
    jwks = Jwks(old)
    clock = FakeClock(step_seconds=40)
    auth = verifier(jwks, clock)
    await auth.verify(old.token())
    jwks.keys = [new]

    principal = await auth.verify(new.token())

    assert principal.user_id == "user-1"
    assert jwks.fetches == 2


def _unsigned(header: dict[str, Any], payload: dict[str, Any]) -> str:
    def part(data: dict[str, Any]) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()

    return f"{part(header)}.{part(payload)}."


async def test_rejects_alg_none() -> None:
    keys = Keys()
    now = int(time.time())
    token = _unsigned(
        {"alg": "none", "kid": "k1"},
        {"sub": "u", "iss": ISSUER, "aud": AUDIENCE, "exp": now + 60},
    )

    with pytest.raises(AuthError):
        await verifier(Jwks(keys)).verify(token)


async def test_rejects_symmetric_tokens_even_when_signed_with_the_public_key() -> None:
    keys = Keys()
    public = keys.jwk()["x"].encode()
    token = jwt.encode(
        {"sub": "u", "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 60},
        public,
        algorithm="HS256",
        headers={"kid": "k1"},
    )

    with pytest.raises(AuthError):
        await verifier(Jwks(keys)).verify(token)


@pytest.mark.parametrize("token", ["", "not-a-jwt", "a.b.c"])
async def test_rejects_garbage(token: str) -> None:
    with pytest.raises(AuthError):
        await verifier(Jwks(Keys())).verify(token)


async def test_a_failing_jwks_endpoint_rejects_instead_of_crashing() -> None:
    async def broken() -> dict[str, Any]:
        raise ConnectionError("down")

    keys = Keys()
    auth = JwtVerifier(JwksCache(broken, FakeClock(), 300), POLICY)

    with pytest.raises(AuthError):
        await auth.verify(keys.token())
