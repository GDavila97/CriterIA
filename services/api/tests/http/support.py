import base64
import json
import os
import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from jwt.algorithms import OKPAlgorithm

from criteria.config import ApiSettings

ISSUER = "https://web.criteria.test"
AUDIENCE = "criteria-api"
WEB_ORIGIN = "https://web.criteria.test"


class TokenFactory:
    """Signs tokens the way Better Auth will, with a key pair that only exists in the test."""

    def __init__(self, kid: str = "test-key") -> None:
        self.kid = kid
        self._private = Ed25519PrivateKey.generate()

    def jwks(self) -> dict[str, Any]:
        public: dict[str, Any] = json.loads(OKPAlgorithm.to_jwk(self._private.public_key()))
        return {"keys": [{**public, "kid": self.kid, "alg": "EdDSA", "use": "sig"}]}

    async def fetch(self) -> dict[str, Any]:
        return self.jwks()

    def token(self, sub: str = "user-1", verified: bool = True, **claims: Any) -> str:
        now = int(time.time())
        payload = {
            "sub": sub,
            "iss": ISSUER,
            "aud": AUDIENCE,
            "iat": now,
            "exp": now + 300,
            "email_verified": verified,
            **claims,
        }
        return jwt.encode(payload, self._private, algorithm="EdDSA", headers={"kid": self.kid})

    def headers(self, sub: str = "user-1", verified: bool = True) -> dict[str, str]:
        return {"authorization": f"Bearer {self.token(sub, verified)}"}


def credential_keys(*versions: int) -> str:
    return ",".join(f"{v}:{base64.b64encode(os.urandom(32)).decode()}" for v in versions or (1,))


def api_settings(**overrides: Any) -> ApiSettings:
    values: dict[str, Any] = {
        "app_env": "test",
        "database_url": "postgresql://api_role:unused@127.0.0.1:5432/unused",
        "web_origin": WEB_ORIGIN,
        "auth_jwks_url": f"{WEB_ORIGIN}/api/auth/jwks",
        "auth_issuer": ISSUER,
        "auth_audience": AUDIENCE,
        "credentials_keys": credential_keys(1),
        "credentials_active_key": 1,
        "server_key_providers": "groq",
        "groq_api_key": "server-groq-key",
        **overrides,
    }
    return ApiSettings.model_validate(values)
