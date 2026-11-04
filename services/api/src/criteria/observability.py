from collections.abc import Mapping
from typing import Any

import sentry_sdk
from sentry_sdk.types import Event, Hint

from criteria.config import Settings

SENSITIVE_HEADERS = frozenset({"authorization", "cookie", "x-provider-key"})


def _without_sensitive_headers(headers: object) -> object:
    if isinstance(headers, Mapping):
        return {k: v for k, v in headers.items() if str(k).lower() not in SENSITIVE_HEADERS}
    if isinstance(headers, list):
        return [
            pair
            for pair in headers
            if not (isinstance(pair, (list, tuple)) and str(pair[0]).lower() in SENSITIVE_HEADERS)
        ]
    return headers


def scrub_sensitive_data(event: Event, _hint: Hint) -> Event:
    request: Any = event.get("request")
    if isinstance(request, dict):
        if "headers" in request:
            request["headers"] = _without_sensitive_headers(request["headers"])
        request.pop("cookies", None)
    return event


def init_sentry(settings: Settings) -> bool:
    if settings.sentry_dsn is None:
        return False
    sentry_sdk.init(
        dsn=str(settings.sentry_dsn),
        environment=settings.app_env,
        send_default_pii=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=scrub_sensitive_data,
    )
    return True
