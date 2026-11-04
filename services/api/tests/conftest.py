from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Keeps a developer's local .env and shell variables out of the tests.
    monkeypatch.chdir(tmp_path)
    for name in ("APP_ENV", "HOST", "PORT", "LOG_LEVEL", "SENTRY_DSN", "SENTRY_TRACES_SAMPLE_RATE"):
        monkeypatch.delenv(name, raising=False)
