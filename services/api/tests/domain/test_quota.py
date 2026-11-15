from datetime import UTC, datetime, timedelta, timezone

from criteria.domain.quota import hour_window_reopens, next_utc_day

MEXICO = timezone(timedelta(hours=-6))


def test_the_daily_count_resets_at_the_next_utc_midnight() -> None:
    assert next_utc_day(datetime(2026, 11, 15, 13, 5, tzinfo=UTC)) == datetime(
        2026, 11, 16, tzinfo=UTC
    )
    # At midnight the new day has already started, so the next reset is a day away.
    assert next_utc_day(datetime(2026, 11, 15, 0, 0, tzinfo=UTC)) == datetime(
        2026, 11, 16, tzinfo=UTC
    )
    assert next_utc_day(datetime(2026, 11, 15, 23, 59, 59, 999_999, tzinfo=UTC)) == datetime(
        2026, 11, 16, tzinfo=UTC
    )


def test_a_local_evening_already_belongs_to_the_next_utc_day() -> None:
    # 19:00 in Mexico City is 01:00 UTC of the next day.
    assert next_utc_day(datetime(2026, 11, 15, 19, 0, tzinfo=MEXICO)) == datetime(
        2026, 11, 17, tzinfo=UTC
    )


def test_the_hour_window_reopens_an_hour_after_the_oldest_run_in_it() -> None:
    oldest = datetime(2026, 11, 15, 12, 41, 30, tzinfo=MEXICO)

    assert hour_window_reopens(oldest) == datetime(2026, 11, 15, 19, 41, 30, tzinfo=UTC)
