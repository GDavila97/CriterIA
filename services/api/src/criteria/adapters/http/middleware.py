import hashlib
import json
import logging
import time
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from criteria.adapters.http.errors import error_response

logger = logging.getLogger("criteria.http")

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
}
PUBLIC_PATHS = {"/healthz", "/evaluation"}


def user_ref(user_id: str) -> str:
    """A short, stable pseudonym so logs can group a user's requests without identifying them."""
    return hashlib.sha256(user_id.encode()).hexdigest()[:12]


class JsonFormatter(logging.Formatter):
    FIELDS = ("method", "path", "status", "duration_ms", "run_id", "user", "estado")

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        entry.update({k: getattr(record, k) for k in self.FIELDS if hasattr(record, k)})
        return json.dumps(entry, ensure_ascii=False)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())


class HardeningMiddleware:
    """Body size limit, security and cache headers, and one access log line per request."""

    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self._app = app
        self._max = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        started = time.monotonic()
        state: dict[str, Any] = {"status": 500, "sent": False}
        headers = dict(scope.get("headers", []))
        declared = headers.get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self._max:
            await error_response("cuerpo_demasiado_grande")(scope, receive, send)
            self._log(scope, 413, started)
            return
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self._max:
                    # Cut the body; the response below is replaced by a 413.
                    state["too_large"] = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def secured_send(message: Message) -> None:
            if state.get("too_large"):
                if message["type"] == "http.response.start":
                    state["status"], state["sent"] = 413, True
                    await error_response("cuerpo_demasiado_grande")(scope, receive, send)
                return
            if message["type"] == "http.response.start":
                state["status"], state["sent"] = message["status"], True
                existing = {k.lower() for k, _ in message.get("headers", [])}
                extra = [(k.encode(), v.encode()) for k, v in SECURITY_HEADERS.items()]
                if b"cache-control" not in existing and scope["path"] not in PUBLIC_PATHS:
                    extra.append((b"cache-control", b"no-store"))
                message["headers"] = [*message.get("headers", []), *extra]
            await send(message)

        await self._app(scope, limited_receive, secured_send)
        self._log(scope, state["status"], started)

    def _log(self, scope: Scope, status: int, started: float) -> None:
        route = scope.get("route")
        extra: dict[str, Any] = {
            "method": scope.get("method"),
            "path": getattr(route, "path", None) or "unmatched",
            "status": status,
            "duration_ms": round((time.monotonic() - started) * 1000),
        }
        user = scope.get("state", {}).get("user_ref")
        if user:
            extra["user"] = user
        logger.info("request", extra=extra)
