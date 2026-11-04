import pytest

from criteria.config import ConfigError, load_settings


def test_fails_with_clear_message_when_app_env_is_missing() -> None:
    with pytest.raises(ConfigError, match=r"APP_ENV \(Field required\)"):
        load_settings()


def test_rejects_invalid_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("PORT", "70000")

    with pytest.raises(ConfigError) as error:
        load_settings()

    assert "APP_ENV" in str(error.value)
    assert "PORT" in str(error.value)


def test_loads_defaults_with_required_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")

    settings = load_settings()

    assert settings.port == 8080
    assert settings.host == "127.0.0.1"
    assert settings.sentry_dsn is None


def test_reads_port_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("PORT", "9000")

    assert load_settings().port == 9000
