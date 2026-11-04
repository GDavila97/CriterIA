from datetime import UTC, datetime, timedelta


class FakeClock:
    """Advances one second per timestamp and a fixed step per latency reading."""

    def __init__(self, start: datetime | None = None, step_seconds: float = 0.25) -> None:
        self._now = start or datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
        self._monotonic = 0.0
        self._step = step_seconds

    def now(self) -> datetime:
        self._now += timedelta(seconds=1)
        return self._now

    def monotonic(self) -> float:
        self._monotonic += self._step
        return self._monotonic
