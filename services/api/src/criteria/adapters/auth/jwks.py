import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx2
import jwt
from jwt import PyJWK

from criteria.ports.auth import AuthError, Principal
from criteria.ports.clock import Clock

logger = logging.getLogger(__name__)

JwksFetcher = Callable[[], Awaitable[dict[str, Any]]]
REQUIRED_CLAIMS = ["exp", "iss", "aud", "sub"]
# An unknown kid may mean the web rotated its key, but refreshing on every one would let anyone
# with garbage tokens hammer the JWKS endpoint.
MIN_REFRESH_SECONDS = 30.0


def http_jwks_fetcher(url: str, timeout_seconds: float = 5.0) -> JwksFetcher:
    async def fetch() -> dict[str, Any]:
        async with httpx2.AsyncClient(timeout=timeout_seconds, follow_redirects=False) as client:
            response = await client.get(url)
            response.raise_for_status()
            data: dict[str, Any] = response.json()
            return data

    return fetch


class JwksCache:
    def __init__(self, fetch: JwksFetcher, clock: Clock, cache_seconds: float) -> None:
        self._fetch = fetch
        self._clock = clock
        self._cache_seconds = cache_seconds
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None

    async def key_for(self, kid: str) -> PyJWK | None:
        now = self._clock.monotonic()
        stale = self._fetched_at is None or now - self._fetched_at >= self._cache_seconds
        unknown_and_refreshable = kid not in self._keys and (
            self._fetched_at is None or now - self._fetched_at >= MIN_REFRESH_SECONDS
        )
        if stale or unknown_and_refreshable:
            await self._refresh(now)
        return self._keys.get(kid)

    async def _refresh(self, now: float) -> None:
        try:
            document = await self._fetch()
        except Exception as error:
            logger.warning("jwks refresh failed: %s", type(error).__name__)
            return
        keys: dict[str, PyJWK] = {}
        for item in document.get("keys", []):
            kid = item.get("kid")
            if not isinstance(kid, str):
                continue
            try:
                keys[kid] = PyJWK(item)
            except jwt.PyJWTError:
                logger.warning("jwks key %s skipped: unsupported", kid)
        self._keys = keys
        self._fetched_at = now


@dataclass(frozen=True)
class TokenPolicy:
    issuer: str
    audience: str
    algorithms: frozenset[str]
    verified_claim: str
    leeway_seconds: int


class JwtVerifier:
    def __init__(self, jwks: JwksCache, policy: TokenPolicy) -> None:
        self._jwks = jwks
        self._policy = policy

    async def verify(self, token: str) -> Principal:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise AuthError from None
        algorithm, kid = header.get("alg"), header.get("kid")
        policy = self._policy
        if algorithm not in policy.algorithms or not isinstance(kid, str):
            raise AuthError
        key = await self._jwks.key_for(kid)
        if key is None or (key.algorithm_name and key.algorithm_name != algorithm):
            raise AuthError
        try:
            claims = jwt.decode(
                token,
                key=key.key,
                algorithms=[algorithm],
                audience=policy.audience,
                issuer=policy.issuer,
                leeway=policy.leeway_seconds,
                options={"require": REQUIRED_CLAIMS},
            )
        except jwt.PyJWTError as error:
            logger.info("token rejected: %s", type(error).__name__)
            raise AuthError from None
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise AuthError
        return Principal(user_id=subject, email_verified=claims.get(policy.verified_claim) is True)
