from typing import Any

import pytest
import sentry_sdk
from sentry_sdk.types import Event

from criteria.config import Settings
from criteria.observability import init_sentry, scrub_sensitive_data


def _event(headers: Any) -> Event:
    return {"request": {"headers": headers, "cookies": {"session": "secret"}, "url": "/runs"}}


def test_removes_sensitive_headers_from_dict_case_insensitive() -> None:
    event = _event(
        {
            "Authorization": "Bearer token",
            "Cookie": "session=secret",
            "X-Provider-Key": "sk-user",
            "Content-Type": "application/json",
        }
    )

    scrubbed = scrub_sensitive_data(event, {})

    assert scrubbed["request"]["headers"] == {"Content-Type": "application/json"}
    assert "cookies" not in scrubbed["request"]


def test_removes_sensitive_headers_from_pair_list() -> None:
    event = _event([["authorization", "Bearer token"], ["x-provider-key", "sk"], ["accept", "*/*"]])

    scrubbed = scrub_sensitive_data(event, {})

    assert scrubbed["request"]["headers"] == [["accept", "*/*"]]


def test_leaves_events_without_request_untouched() -> None:
    event: Event = {"message": "boom"}

    assert scrub_sensitive_data(event, {}) == {"message": "boom"}


def test_sentry_is_disabled_without_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    assert init_sentry(Settings(app_env="test")) is False
    assert calls == []


def test_sentry_is_initialized_without_pii_and_with_scrubber(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    monkeypatch.setenv("SENTRY_DSN", "https://key@o0.ingest.sentry.io/0")

    enabled = init_sentry(Settings(app_env="test"))

    assert enabled is True
    assert calls[0]["send_default_pii"] is False
    assert calls[0]["before_send"] is scrub_sensitive_data
