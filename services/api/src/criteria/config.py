from typing import Literal

from pydantic import Field, HttpUrl, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class ConfigError(RuntimeError):
    pass


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_env: Literal["development", "test", "production"]
    host: str = "127.0.0.1"
    port: int = Field(default=8080, ge=1, le=65535)
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    sentry_dsn: HttpUrl | None = None
    sentry_traces_sample_rate: float = Field(default=0.0, ge=0.0, le=1.0)


def load_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as error:
        problems = ", ".join(
            f"{'.'.join(str(part) for part in issue['loc']).upper()} ({issue['msg']})"
            for issue in error.errors()
        )
        raise ConfigError(f"Invalid API configuration: {problems}") from None
