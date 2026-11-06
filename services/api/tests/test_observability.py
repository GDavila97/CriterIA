import json
from collections.abc import Iterator
from typing import Any
from uuid import uuid4

import pytest
import sentry_sdk
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport
from sentry_sdk.types import Event

from criteria.config import Settings
from criteria.observability import SentryErrorReporter, init_sentry, scrub_sensitive_data


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
    assert calls[0]["include_local_variables"] is False


class CapturingTransport(Transport):
    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Envelope) -> None:
        event = envelope.get_event()
        if event is not None:
            self.events.append(dict(event))


@pytest.fixture
def transport() -> Iterator[CapturingTransport]:
    capturing = CapturingTransport()
    sentry_sdk.init(
        dsn="https://key@o0.ingest.sentry.io/0",
        transport=capturing,
        send_default_pii=False,
        include_local_variables=False,
    )
    yield capturing
    sentry_sdk.get_client().close()
    sentry_sdk.init()


def _fail_with_user_text(requirement: str) -> None:
    raise RuntimeError(f"could not process: {requirement}")


def test_run_errors_reach_sentry_with_type_and_stack_but_no_user_text(
    transport: CapturingTransport,
) -> None:
    run_id = uuid4()
    # Built at runtime so the source context Sentry keeps does not contain it either.
    requirement = " ".join(["Quiero", "pagar", "con", "la", "tarjeta", str(4100 + 11)])
    sentry_sdk.add_breadcrumb(message=requirement, category="log")
    try:
        _fail_with_user_text(requirement)
    except RuntimeError as error:
        SentryErrorReporter().report(error, run_id)

    [event] = transport.events
    dumped = json.dumps(event, default=str)
    [exception] = event["exception"]["values"]
    assert exception["type"] == "RuntimeError"
    assert exception["value"] == ""
    assert any(f["function"] == "_fail_with_user_text" for f in exception["stacktrace"]["frames"])
    assert event["tags"]["run_id"] == str(run_id)
    assert "4111" not in dumped
    assert "Quiero pagar" not in dumped
