"""In-memory versions of the store ports, for use-case tests that do not need Postgres."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from typing import Any
from uuid import UUID

from criteria.domain.events import ProveedorId
from criteria.ports.credentials import StoredCredential
from criteria.ports.stores import (
    LimitExceededError,
    RunRecord,
    RunStatus,
    SavedRun,
    SavedRunSummary,
    StreamBusyError,
    UsageSummary,
    UserSettings,
)


class MemorySettings:
    def __init__(self) -> None:
        self.saved: dict[str, UserSettings] = {}

    async def get(self, user_id: str) -> UserSettings:
        return self.saved.get(user_id, UserSettings())

    async def put(self, user_id: str, settings: UserSettings) -> None:
        self.saved[user_id] = settings


class MemoryCredentials:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, ProveedorId], StoredCredential] = {}
        self.checks: list[tuple[str, datetime]] = []

    async def get(self, user_id: str, provider: ProveedorId) -> StoredCredential | None:
        return self.rows.get((user_id, provider))

    async def list(self, user_id: str) -> list[StoredCredential]:
        return [c for (owner, _), c in self.rows.items() if owner == user_id]

    async def upsert(self, user_id: str, credential: StoredCredential) -> None:
        self.rows[(user_id, credential.provider)] = credential

    async def delete(self, user_id: str, provider: ProveedorId) -> bool:
        return self.rows.pop((user_id, provider), None) is not None

    async def record_check(self, user_id: str, at: datetime) -> None:
        self.checks.append((user_id, at))

    async def checks_since(self, user_id: str, since: datetime) -> int:
        return sum(1 for owner, at in self.checks if owner == user_id and at >= since)


@dataclass
class MemoryRuns:
    records: dict[UUID, RunRecord] = field(default_factory=dict)
    events: dict[UUID, list[dict[str, Any]]] = field(default_factory=dict)
    touched: dict[UUID, datetime] = field(default_factory=dict)
    locked: set[UUID] = field(default_factory=set)
    now: datetime = datetime(2026, 11, 5, 12, 0)

    async def create(self, record: RunRecord) -> None:
        self.records[record.id] = record
        self.events[record.id] = []
        self.touched[record.id] = record.created_at

    async def get(self, run_id: UUID, user_id: str) -> RunRecord | None:
        record = self.records.get(run_id)
        return record if record is not None and record.user_id == user_id else None

    async def set_status(self, run_id: UUID, status: RunStatus) -> None:
        self.records[run_id] = replace(self.records[run_id], status=status)

    async def set_approval(self, run_id: UUID, approval: dict[str, Any] | None) -> bool:
        record = self.records.get(run_id)
        if record is None or record.status != "esperando_aprobacion":
            return False
        self.records[run_id] = replace(record, approval=approval)
        return True

    async def append_event(
        self, run_id: UUID, seq: int, kind: str, payload: dict[str, Any]
    ) -> None:
        self.events[run_id].append(payload)

    async def events_after(self, run_id: UUID, seq: int) -> list[dict[str, Any]]:
        return [e for e in self.events.get(run_id, []) if e["seq"] > seq]

    async def last_seq(self, run_id: UUID) -> int:
        return max((e["seq"] for e in self.events.get(run_id, [])), default=0)

    async def delete(self, run_id: UUID) -> None:
        self.records.pop(run_id, None)
        self.events.pop(run_id, None)
        self.touched.pop(run_id, None)

    async def stale(self, updated_before: datetime) -> list[RunRecord]:
        return [self.records[i] for i, at in self.touched.items() if at < updated_before]

    async def fail_if_stale(self, run_id: UUID, updated_before: datetime) -> bool:
        if self.touched.get(run_id, updated_before) >= updated_before:
            return False
        await self.set_status(run_id, "fallida")
        return True

    @asynccontextmanager
    async def stream_lock(self, run_id: UUID) -> AsyncIterator[None]:
        if run_id in self.locked:
            raise StreamBusyError(str(run_id))
        self.locked.add(run_id)
        try:
            yield
        finally:
            self.locked.discard(run_id)


@dataclass
class MemoryUsage:
    reserved: list[tuple[str, bool, float]] = field(default_factory=list)
    settled: list[tuple[str, date, float, float | None]] = field(default_factory=list)
    settled_runs: set[UUID] = field(default_factory=set)
    extra: list[tuple[UUID, float]] = field(default_factory=list)
    refuse: LimitExceededError | None = None

    async def reserve(
        self, user_id: str, at: datetime, uses_server_key: bool, server_cost_usd: float
    ) -> None:
        if self.refuse is not None:
            raise self.refuse
        self.reserved.append((user_id, uses_server_key, server_cost_usd))

    async def settle(
        self, run_id: UUID, user_id: str, day: date, reserved_usd: float, actual_usd: float | None
    ) -> None:
        if run_id in self.settled_runs:
            return
        self.settled_runs.add(run_id)
        self.settled.append((user_id, day, reserved_usd, actual_usd))

    async def reserve_extra(self, run_id: UUID, user_id: str, day: date, cost_usd: float) -> None:
        if self.refuse is not None:
            raise self.refuse
        self.extra.append((run_id, cost_usd))

    async def summary(self, user_id: str, at: datetime) -> UsageSummary:
        mine = sum(1 for owner, _, _ in self.reserved if owner == user_id)
        return UsageSummary(runs_last_hour=mine, runs_per_hour=5, runs_today=mine, runs_per_day=20)


class MemoryHistory:
    def __init__(self) -> None:
        self.runs: dict[str, list[SavedRun]] = {}

    async def save(self, user_id: str, run: SavedRun) -> None:
        saved = self.runs.setdefault(user_id, [])
        if all(r.id != run.id for r in saved):
            saved.append(run)

    async def list(self, user_id: str, limit: int) -> list[SavedRunSummary]:
        return [
            SavedRunSummary(
                id=r.id,
                status=r.status,
                provider=r.provider,
                model=r.model,
                created_at=r.created_at or datetime(2026, 11, 5),
                scores=r.scores,
            )
            for r in self.runs.get(user_id, [])[:limit]
        ]

    async def get(self, user_id: str, run_id: UUID) -> SavedRun | None:
        return next((r for r in self.runs.get(user_id, []) if r.id == run_id), None)

    async def delete_all(self, user_id: str) -> int:
        return len(self.runs.pop(user_id, []))
