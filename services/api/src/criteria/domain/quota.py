"""When a usage limit frees up again; the server decides it so every client shows the same time."""

from datetime import UTC, datetime, time, timedelta

HOUR = timedelta(hours=1)


def next_utc_day(at: datetime) -> datetime:
    """The next 00:00 UTC after `at`: daily counts are kept per UTC day."""
    return datetime.combine(at.astimezone(UTC).date() + timedelta(days=1), time(), tzinfo=UTC)


def hour_window_reopens(oldest_start: datetime) -> datetime:
    """The oldest run still inside the last hour leaves it exactly one hour after it started."""
    return oldest_start.astimezone(UTC) + HOUR
