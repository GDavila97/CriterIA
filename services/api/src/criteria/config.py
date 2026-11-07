import base64
import binascii
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import (
    Field,
    HttpUrl,
    SecretStr,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from criteria.domain.events import ProveedorId

# Source-tree location; the Docker image overrides both paths through the environment.
SERVICE_ROOT = Path(__file__).resolve().parents[2]


MAX_TIMEOUT_SECONDS = 600
AES_KEY_BYTES = 32
ASYMMETRIC_JWT_ALGORITHMS = frozenset(
    {"EdDSA", "ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512"}
)


class ConfigError(RuntimeError):
    pass


def parse_credential_keys(raw: str) -> dict[int, bytes]:
    """Parses "1:<base64>,2:<base64>"; the error never repeats key material."""
    keys: dict[int, bytes] = {}
    for item in (part.strip() for part in raw.split(",") if part.strip()):
        version, _, encoded = item.partition(":")
        try:
            key = base64.b64decode(encoded, validate=True)
            number = int(version)
        except (ValueError, binascii.Error):
            raise ValueError("use version:base64 pairs separated by commas") from None
        if number < 1 or len(key) != AES_KEY_BYTES or number in keys:
            raise ValueError("each key needs a unique positive version and exactly 32 bytes")
        keys[number] = key
    if not keys:
        raise ValueError("at least one key is required")
    return keys


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
        frozen=True,
    )

    app_env: Literal["development", "test", "production"]
    host: str = "127.0.0.1"
    port: int = Field(default=8080, ge=1, le=65535)
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    sentry_dsn: HttpUrl | None = None
    sentry_traces_sample_rate: float = Field(default=0.0, ge=0.0, le=1.0)

    provider: ProveedorId | None = None
    generation_model: str | None = None
    judge_provider: ProveedorId | None = None
    judge_model: str | None = None
    # Providers that may run on the operator's own credentials; production allows only groq.
    server_key_providers: Annotated[list[ProveedorId], NoDecode] = Field(default_factory=list)
    openai_api_key: SecretStr | None = None
    anthropic_api_key: SecretStr | None = None
    groq_api_key: SecretStr | None = None
    ollama_base_url: HttpUrl | None = None
    provider_timeout_seconds: float = Field(default=60.0, gt=0, le=600)
    # Per-provider overrides such as "ollama:180,groq:60"; local models answer far slower.
    provider_timeouts: Annotated[dict[ProveedorId, float], NoDecode] = Field(default_factory=dict)
    provider_max_response_bytes: int = Field(default=1_048_576, ge=1024, le=16_777_216)

    prompt_version: Annotated[str, StringConstraints(pattern=r"^v\d+$")] = "v1"
    judge_version: Annotated[str, StringConstraints(pattern=r"^v\d+$")] = "v1"
    max_review_rounds: int = Field(default=2, ge=0, le=5)
    prompts_dir: Path = SERVICE_ROOT / "prompts"
    models_file: Path = SERVICE_ROOT / "config" / "models.toml"

    @field_validator("provider_timeouts", mode="before")
    @classmethod
    def _parse_timeouts(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        pairs = (item.strip().rsplit(":", 1) for item in value.split(",") if item.strip())
        try:
            return {provider.strip(): float(seconds) for provider, seconds in pairs}
        except ValueError:
            raise ValueError("use provider:seconds pairs separated by commas") from None

    @field_validator("provider_timeouts")
    @classmethod
    def _timeouts_in_range(cls, value: dict[ProveedorId, float]) -> dict[ProveedorId, float]:
        if any(not 0 < seconds <= MAX_TIMEOUT_SECONDS for seconds in value.values()):
            raise ValueError(f"timeouts must be between 0 and {MAX_TIMEOUT_SECONDS} seconds")
        return value

    def timeout_for(self, provider: ProveedorId) -> float:
        return self.provider_timeouts.get(provider, self.provider_timeout_seconds)

    @field_validator("server_key_providers", mode="before")
    @classmethod
    def _split_providers(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("server_key_providers")
    @classmethod
    def _no_server_key_for_user_endpoints(cls, value: list[ProveedorId]) -> list[ProveedorId]:
        if "openai_compatible" in value:
            raise ValueError("openai_compatible always needs the user's own key")
        return list(dict.fromkeys(value))


def load_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as error:
        problems = ", ".join(
            f"{'.'.join(str(part) for part in issue['loc']).upper()} ({issue['msg']})"
            for issue in error.errors()
        )
        raise ConfigError(f"Invalid API configuration: {problems}") from None


class ApiSettings(Settings):
    """HTTP API settings on top of the CLI ones; fields without a default are required."""

    database_url: SecretStr
    web_origin: HttpUrl
    auth_jwks_url: HttpUrl
    auth_issuer: Annotated[str, StringConstraints(min_length=1)]
    auth_audience: Annotated[str, StringConstraints(min_length=1)]
    auth_algorithms: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["EdDSA"])
    auth_verified_claim: str = "email_verified"
    # False only while the web cannot send verification emails (EMAIL_PROVIDER=none).
    auth_require_verified_email: bool = True
    auth_jwks_cache_seconds: int = Field(default=300, ge=10, le=86400)
    auth_leeway_seconds: int = Field(default=30, ge=0, le=300)
    credentials_keys: SecretStr
    credentials_active_key: int = Field(ge=1)
    credential_checks_per_hour: int = Field(default=10, ge=1)
    user_runs_per_hour: int = Field(default=5, ge=1)
    user_runs_per_day: int = Field(default=20, ge=1)
    global_daily_runs: int = Field(default=100, ge=0)
    global_daily_budget_usd: float = Field(default=1.0, ge=0)
    run_ttl_minutes: int = Field(default=60, ge=5)
    sse_heartbeat_seconds: float = Field(default=15.0, gt=0, le=60)
    max_request_bytes: int = Field(default=65536, ge=1024, le=1_048_576)
    database_pool_size: int = Field(default=10, ge=2, le=50)
    model_backend: Literal["real", "fake"] = "real"
    fake_model_delay_ms: int = Field(default=300, ge=0, le=10_000)

    @field_validator("auth_algorithms", mode="before")
    @classmethod
    def _split_algorithms(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("auth_algorithms")
    @classmethod
    def _only_asymmetric(cls, value: list[str]) -> list[str]:
        if not value or not set(value) <= ASYMMETRIC_JWT_ALGORITHMS:
            raise ValueError("only asymmetric algorithms are allowed (for example EdDSA)")
        return value

    @field_validator("credentials_keys")
    @classmethod
    def _valid_keys(cls, value: SecretStr) -> SecretStr:
        parse_credential_keys(value.get_secret_value())
        return value

    @model_validator(mode="after")
    def _fake_models_only_in_tests(self) -> Self:
        if self.model_backend == "fake" and self.app_env != "test":
            raise ValueError("MODEL_BACKEND=fake is only allowed with APP_ENV=test")
        return self

    @model_validator(mode="after")
    def _active_key_exists(self) -> Self:
        if self.credentials_active_key not in self.credential_keys():
            raise ValueError("CREDENTIALS_ACTIVE_KEY must name one of CREDENTIALS_KEYS")
        return self

    def credential_keys(self) -> dict[int, bytes]:
        return parse_credential_keys(self.credentials_keys.get_secret_value())

    @property
    def web_origin_value(self) -> str:
        return str(self.web_origin).rstrip("/")


def load_api_settings() -> ApiSettings:
    try:
        return ApiSettings()
    except ValidationError as error:
        problems = ", ".join(
            f"{'.'.join(str(part) for part in issue['loc']).upper() or 'SETTINGS'} ({issue['msg']})"
            for issue in error.errors(include_input=False)
        )
    raise ConfigError(f"Invalid API configuration: {problems}")
