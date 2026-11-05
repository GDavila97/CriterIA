from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, HttpUrl, SecretStr, StringConstraints, ValidationError, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from criteria.domain.events import ProveedorId

# Source-tree location; the Docker image overrides both paths through the environment.
SERVICE_ROOT = Path(__file__).resolve().parents[2]


class ConfigError(RuntimeError):
    pass


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
    provider_max_response_bytes: int = Field(default=1_048_576, ge=1024, le=16_777_216)

    prompt_version: Annotated[str, StringConstraints(pattern=r"^v\d+$")] = "v1"
    judge_version: Annotated[str, StringConstraints(pattern=r"^v\d+$")] = "v1"
    max_review_rounds: int = Field(default=2, ge=0, le=5)
    prompts_dir: Path = SERVICE_ROOT / "prompts"
    models_file: Path = SERVICE_ROOT / "config" / "models.toml"

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
