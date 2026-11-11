from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Any, cast
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine

from criteria.adapters.postgres import database as t
from criteria.domain.artifacts import CRITERIOS
from criteria.domain.eval_metrics import common_keys, mean
from criteria.domain.events import ProveedorId
from criteria.domain.run_config import Nivel
from criteria.ports.credentials import Sealed, StoredCredential
from criteria.ports.stores import (
    LimitExceededError,
    ModelPlan,
    RunRecord,
    RunStatus,
    SavedRun,
    SavedRunSummary,
    StreamBusyError,
    UsageLimits,
    UsageSummary,
    UserSettings,
)


def _now() -> datetime:
    return datetime.now(UTC)


def _float(value: Any) -> float:
    return float(value) if value is not None else 0.0


class PostgresSettingsStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def get(self, user_id: str) -> UserSettings:
        async with self._engine.connect() as conn:
            row = (
                (
                    await conn.execute(
                        sa.select(t.user_settings).where(t.user_settings.c.user_id == user_id)
                    )
                )
                .mappings()
                .first()
            )
        if row is None:
            return UserSettings()
        return UserSettings(
            save_history=row["save_history"],
            default_provider=cast(ProveedorId | None, row["default_provider"]),
            default_tier=cast(Nivel | None, row["default_tier"]),
            judge_provider=cast(ProveedorId | None, row["judge_provider"]),
        )

    async def put(self, user_id: str, settings: UserSettings) -> None:
        values = {
            "save_history": settings.save_history,
            "default_provider": settings.default_provider,
            "default_tier": settings.default_tier,
            "judge_provider": settings.judge_provider,
            "updated_at": _now(),
        }
        statement = insert(t.user_settings).values(user_id=user_id, **values)
        async with self._engine.begin() as conn:
            await conn.execute(
                statement.on_conflict_do_update(index_elements=["user_id"], set_=values)
            )


class PostgresCredentialStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    @staticmethod
    def _credential(row: sa.RowMapping) -> StoredCredential:
        return StoredCredential(
            provider=cast(ProveedorId, row["provider"]),
            sealed=Sealed(row["ciphertext"], row["nonce"], row["key_version"]),
            last4=row["last4"],
            base_url=row["base_url"],
            validated_at=row["validated_at"],
        )

    async def get(self, user_id: str, provider: ProveedorId) -> StoredCredential | None:
        c = t.provider_credential.c
        async with self._engine.connect() as conn:
            row = (
                (
                    await conn.execute(
                        sa.select(t.provider_credential).where(
                            c.user_id == user_id, c.provider == provider
                        )
                    )
                )
                .mappings()
                .first()
            )
        return self._credential(row) if row else None

    async def list(self, user_id: str) -> list[StoredCredential]:
        c = t.provider_credential.c
        async with self._engine.connect() as conn:
            rows = (
                await conn.execute(
                    sa.select(t.provider_credential)
                    .where(c.user_id == user_id)
                    .order_by(c.provider)
                )
            ).mappings()
            return [self._credential(row) for row in rows]

    async def upsert(self, user_id: str, credential: StoredCredential) -> None:
        now = _now()
        values = {
            "ciphertext": credential.sealed.ciphertext,
            "nonce": credential.sealed.nonce,
            "key_version": credential.sealed.key_version,
            "last4": credential.last4,
            "base_url": credential.base_url,
            "validated_at": credential.validated_at,
            "updated_at": now,
        }
        statement = insert(t.provider_credential).values(
            id=uuid4(), user_id=user_id, provider=credential.provider, created_at=now, **values
        )
        async with self._engine.begin() as conn:
            await conn.execute(
                statement.on_conflict_do_update(
                    constraint="provider_credential_user_provider", set_=values
                )
            )

    async def delete(self, user_id: str, provider: ProveedorId) -> bool:
        c = t.provider_credential.c
        async with self._engine.begin() as conn:
            result = await conn.execute(
                sa.delete(t.provider_credential).where(c.user_id == user_id, c.provider == provider)
            )
        return bool(result.rowcount)

    async def record_check(self, user_id: str, at: datetime) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                sa.insert(t.credential_check).values(id=uuid4(), user_id=user_id, checked_at=at)
            )

    async def checks_since(self, user_id: str, since: datetime) -> int:
        c = t.credential_check.c
        async with self._engine.connect() as conn:
            count = await conn.scalar(
                sa.select(sa.func.count()).where(c.user_id == user_id, c.checked_at >= since)
            )
        return int(count or 0)


class PostgresUsageGuard:
    def __init__(self, engine: AsyncEngine, limits: UsageLimits) -> None:
        self._engine = engine
        self._limits = limits

    async def reserve(
        self, user_id: str, at: datetime, uses_server_key: bool, server_cost_usd: float
    ) -> None:
        limits, day = self._limits, at.date()
        async with self._engine.begin() as conn:
            # Serializes one user's reservations so two parallel requests cannot both slip in.
            await conn.execute(
                sa.select(sa.func.pg_advisory_xact_lock(sa.func.hashtextextended(user_id, 0)))
            )
            recent = await conn.scalar(
                sa.select(sa.func.count()).where(
                    t.run_start.c.user_id == user_id,
                    t.run_start.c.started_at > at - timedelta(hours=1),
                )
            )
            if int(recent or 0) >= limits.user_runs_per_hour:
                raise LimitExceededError("limite_hora")
            today = await conn.scalar(
                sa.select(t.usage_daily.c.runs).where(
                    t.usage_daily.c.user_id == user_id, t.usage_daily.c.day == day
                )
            )
            if int(today or 0) >= limits.user_runs_per_day:
                raise LimitExceededError("limite_dia")
            if uses_server_key:
                await self._book_global(conn, day, server_cost_usd)
            await conn.execute(
                sa.insert(t.run_start).values(
                    id=uuid4(), user_id=user_id, started_at=at, uses_server_key=uses_server_key
                )
            )
            usage = insert(t.usage_daily).values(
                user_id=user_id, day=day, runs=1, cost_usd=server_cost_usd
            )
            await conn.execute(
                usage.on_conflict_do_update(
                    index_elements=["user_id", "day"],
                    set_={
                        "runs": t.usage_daily.c.runs + 1,
                        "cost_usd": t.usage_daily.c.cost_usd + server_cost_usd,
                    },
                )
            )

    async def _book_global(self, conn: Any, day: date, cost: float) -> None:
        g = t.global_usage_daily
        await conn.execute(
            insert(g)
            .values(day=day, runs=0, cost_usd=0)
            .on_conflict_do_nothing(index_elements=["day"])
        )
        # The row lock taken by this UPDATE makes the check-and-book atomic across instances.
        booked = await conn.scalar(
            sa.update(g)
            .where(
                g.c.day == day,
                g.c.runs + 1 <= self._limits.global_daily_runs,
                g.c.cost_usd + cost <= self._limits.global_daily_budget_usd,
            )
            .values(runs=g.c.runs + 1, cost_usd=g.c.cost_usd + cost)
            .returning(g.c.runs)
        )
        if booked is None:
            raise LimitExceededError("cupo_gratuito_agotado")

    async def reserve_extra(self, run_id: UUID, user_id: str, day: date, cost_usd: float) -> None:
        g, u, r = t.global_usage_daily, t.usage_daily, t.run
        async with self._engine.begin() as conn:
            booked = await conn.scalar(
                sa.update(g)
                .where(
                    g.c.day == day,
                    g.c.cost_usd + cost_usd <= self._limits.global_daily_budget_usd,
                )
                .values(cost_usd=g.c.cost_usd + cost_usd)
                .returning(g.c.day)
            )
            if booked is None:
                raise LimitExceededError("cupo_gratuito_agotado")
            await conn.execute(
                sa.update(u)
                .where(u.c.user_id == user_id, u.c.day == day)
                .values(cost_usd=u.c.cost_usd + cost_usd)
            )
            await conn.execute(
                sa.update(r)
                .where(r.c.id == run_id)
                .values(server_cost_reserved_usd=r.c.server_cost_reserved_usd + cost_usd)
            )

    async def summary(self, user_id: str, at: datetime) -> UsageSummary:
        async with self._engine.connect() as conn:
            last_hour = await conn.scalar(
                sa.select(sa.func.count()).where(
                    t.run_start.c.user_id == user_id,
                    t.run_start.c.started_at > at - timedelta(hours=1),
                )
            )
            today = await conn.scalar(
                sa.select(t.usage_daily.c.runs).where(
                    t.usage_daily.c.user_id == user_id, t.usage_daily.c.day == at.date()
                )
            )
        return UsageSummary(
            runs_last_hour=int(last_hour or 0),
            runs_per_hour=self._limits.user_runs_per_hour,
            runs_today=int(today or 0),
            runs_per_day=self._limits.user_runs_per_day,
        )

    async def settle(
        self, run_id: UUID, user_id: str, day: date, reserved_usd: float, actual_usd: float | None
    ) -> None:
        g, u, r = t.global_usage_daily, t.usage_daily, t.run
        async with self._engine.begin() as conn:
            # The flag and the adjustment commit together: a close retried after a crash skips it.
            marked = await conn.execute(
                sa.update(r).where(r.c.id == run_id, r.c.settled.is_(False)).values(settled=True)
            )
            if not marked.rowcount or actual_usd is None or actual_usd == reserved_usd:
                return
            delta = actual_usd - reserved_usd
            await conn.execute(
                sa.update(g)
                .where(g.c.day == day)
                .values(cost_usd=sa.func.greatest(g.c.cost_usd + delta, 0))
            )
            await conn.execute(
                sa.update(u)
                .where(u.c.user_id == user_id, u.c.day == day)
                .values(cost_usd=sa.func.greatest(u.c.cost_usd + delta, 0))
            )


def _plan(data: dict[str, Any]) -> ModelPlan:
    return ModelPlan(**data)


def _plan_json(plan: ModelPlan) -> dict[str, Any]:
    return {
        "proveedor": plan.proveedor,
        "modelo": plan.modelo,
        "temperatura": plan.temperatura,
        "max_tokens": plan.max_tokens,
        "clave": plan.clave,
    }


def _run_record(row: Any) -> RunRecord:
    return RunRecord(
        id=row["id"],
        user_id=row["user_id"],
        status=cast(RunStatus, row["status"]),
        requirement=row["requirement"],
        generation=_plan(row["generation"]),
        judge=_plan(row["judge"]),
        max_rounds=row["max_rounds"],
        server_cost_reserved_usd=_float(row["server_cost_reserved_usd"]),
        estimated_cost_usd=None
        if row["estimated_cost_usd"] is None
        else float(row["estimated_cost_usd"]),
        created_at=row["created_at"],
        approval=row["approval"],
        agent_plans={rol: _plan(data) for rol, data in (row["agent_plans"] or {}).items()},
        save_history=row["save_history"],
    )


def _lock_key(run_id: UUID) -> int:
    return int.from_bytes(run_id.bytes[:8], "big", signed=True)


class PostgresRunStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def create(self, record: RunRecord) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                sa.insert(t.run).values(
                    id=record.id,
                    user_id=record.user_id,
                    status=record.status,
                    requirement=record.requirement,
                    generation=_plan_json(record.generation),
                    judge=_plan_json(record.judge),
                    max_rounds=record.max_rounds,
                    server_cost_reserved_usd=record.server_cost_reserved_usd,
                    estimated_cost_usd=record.estimated_cost_usd,
                    approval=record.approval,
                    created_at=record.created_at,
                    updated_at=record.created_at,
                    agent_plans={rol: _plan_json(p) for rol, p in record.agent_plans.items()},
                    save_history=record.save_history,
                )
            )

    async def get(self, run_id: UUID, user_id: str) -> RunRecord | None:
        c = t.run.c
        async with self._engine.connect() as conn:
            row = (
                (await conn.execute(sa.select(t.run).where(c.id == run_id, c.user_id == user_id)))
                .mappings()
                .first()
            )
        return None if row is None else _run_record(row)

    async def set_status(self, run_id: UUID, status: RunStatus) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                sa.update(t.run)
                .where(t.run.c.id == run_id)
                .values(status=status, updated_at=_now())
            )

    async def set_approval(self, run_id: UUID, approval: dict[str, Any] | None) -> bool:
        c = t.run.c
        async with self._engine.begin() as conn:
            result = await conn.execute(
                sa.update(t.run)
                .where(c.id == run_id, c.status == "esperando_aprobacion")
                .values(approval=approval, updated_at=_now())
            )
        return bool(result.rowcount)

    async def append_event(
        self, run_id: UUID, seq: int, kind: str, payload: dict[str, Any]
    ) -> None:
        now = _now()
        async with self._engine.begin() as conn:
            await conn.execute(
                sa.insert(t.run_event).values(
                    run_id=run_id, seq=seq, type=kind, payload=payload, created_at=now
                )
            )
            await conn.execute(sa.update(t.run).where(t.run.c.id == run_id).values(updated_at=now))

    async def events_after(self, run_id: UUID, seq: int) -> list[dict[str, Any]]:
        c = t.run_event.c
        async with self._engine.connect() as conn:
            rows = await conn.execute(
                sa.select(c.payload).where(c.run_id == run_id, c.seq > seq).order_by(c.seq)
            )
            return [row[0] for row in rows]

    async def last_seq(self, run_id: UUID) -> int:
        async with self._engine.connect() as conn:
            value = await conn.scalar(
                sa.select(sa.func.max(t.run_event.c.seq)).where(t.run_event.c.run_id == run_id)
            )
        return int(value or 0)

    async def delete(self, run_id: UUID) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(sa.delete(t.run).where(t.run.c.id == run_id))

    async def stale(self, updated_before: datetime) -> list[RunRecord]:
        async with self._engine.connect() as conn:
            rows = await conn.execute(sa.select(t.run).where(t.run.c.updated_at < updated_before))
            return [_run_record(row) for row in rows.mappings()]

    async def fail_if_stale(self, run_id: UUID, updated_before: datetime) -> bool:
        c = t.run.c
        async with self._engine.begin() as conn:
            result = await conn.execute(
                sa.update(t.run)
                .where(c.id == run_id, c.updated_at < updated_before)
                .values(status="fallida", updated_at=_now())
            )
        return bool(result.rowcount)

    @asynccontextmanager
    async def stream_lock(self, run_id: UUID) -> AsyncIterator[None]:
        key = _lock_key(run_id)
        # A session lock on an autocommit connection: held for the whole stream without an open
        # transaction, and released by Postgres if the instance dies.
        async with self._engine.connect() as conn:
            await conn.execution_options(isolation_level="AUTOCOMMIT")
            acquired = await conn.scalar(sa.select(sa.func.pg_try_advisory_lock(key)))
            if not acquired:
                raise StreamBusyError
            try:
                yield
            finally:
                await conn.scalar(sa.select(sa.func.pg_advisory_unlock(key)))


class PostgresHistoryStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def save(self, user_id: str, run: SavedRun) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                postgresql.insert(t.saved_run)
                .values(
                    id=run.id,
                    user_id=user_id,
                    status=run.status,
                    requirement=run.requirement,
                    artifacts=run.artifacts,
                    scores=run.scores,
                    provider=run.provider,
                    model=run.model,
                    judge_model=run.judge_model,
                    prompt_version=run.prompt_version,
                    judge_version=run.judge_version,
                    experimental=run.experimental,
                    totals=run.totals,
                    created_at=run.created_at or _now(),
                )
                # A close retried after a crash must not fail on the copy it already made.
                .on_conflict_do_nothing(index_elements=["id"])
            )

    async def list(self, user_id: str, limit: int) -> list[SavedRunSummary]:
        c = t.saved_run.c
        query = (
            sa.select(c.id, c.status, c.provider, c.model, c.created_at, c.scores)
            .where(c.user_id == user_id)
            .order_by(c.created_at.desc())
            .limit(limit)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings()
            return [SavedRunSummary(**row) for row in rows]

    async def get(self, user_id: str, run_id: UUID) -> SavedRun | None:
        c = t.saved_run.c
        async with self._engine.connect() as conn:
            row = (
                (
                    await conn.execute(
                        sa.select(t.saved_run).where(c.user_id == user_id, c.id == run_id)
                    )
                )
                .mappings()
                .first()
            )
        if row is None:
            return None
        data = dict(row)
        data.pop("user_id")
        return SavedRun(**data)

    async def delete_all(self, user_id: str) -> int:
        async with self._engine.begin() as conn:
            result = await conn.execute(
                sa.delete(t.saved_run).where(t.saved_run.c.user_id == user_id)
            )
        return int(result.rowcount)


def _common_by_version(
    rows: Sequence[sa.RowMapping], scores: Mapping[Any, Mapping[Any, float]]
) -> dict[Any, frozenset[Any]]:
    """The cases every batch of the same prompt and judge versions completed and had scored."""
    groups: dict[tuple[str, str], list[Any]] = {}
    for row in rows:
        groups.setdefault((row["prompt_version"], row["judge_version"]), []).append(row["id"])
    return {
        batch: common_keys(scores[b] for b in members)
        for members in groups.values()
        for batch in members
    }


class PostgresEvaluationReader:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def batches(self) -> list[dict[str, Any]]:
        b, r = t.eval_batch.c, t.eval_result.c
        done = r.completed.is_(True)
        llamadas = sa.func.sum(sa.cast(r.details["llamadas"].astext, sa.Integer))
        validas = sa.func.sum(sa.cast(r.details["validas_a_la_primera"].astext, sa.Integer))
        summary = (
            sa.select(
                b.id,
                b.created_at,
                b.provider,
                b.model,
                b.display_name,
                b.prompt_version,
                b.judge_model,
                b.judge_version,
                b.judge_same_provider,
                b.output_mode,
                sa.func.count(r.id).label("cases"),
                sa.func.count(r.id).filter(done).label("completed"),
                # Each agent call valid at the first answer; older rows only know the whole run.
                sa.func.coalesce(
                    sa.cast(validas, sa.Float) / sa.func.nullif(llamadas, 0),
                    sa.func.avg(sa.cast(r.valid_output, sa.Integer)),
                ).label("valid_rate"),
                sa.func.percentile_cont(0.5)
                .within_group(r.latency_ms)
                .filter(done)
                .label("latency_p50_ms"),
                sa.func.percentile_cont(0.95)
                .within_group(r.latency_ms)
                .filter(done)
                .label("latency_p95_ms"),
                sa.func.avg(r.cost_usd).filter(done).label("cost_usd_avg"),
            )
            .select_from(t.eval_batch.outerjoin(t.eval_result, r.batch_id == b.id))
            .group_by(b.id)
            .order_by(b.created_at.desc())
        )
        scores = sa.select(r.batch_id, r.case_id, r.scores)
        async with self._engine.connect() as conn:
            rows = list((await conn.execute(summary)).mappings())
            by_batch: dict[Any, dict[Any, float]] = {row["id"]: {} for row in rows}
            for row in (await conn.execute(scores)).mappings():
                values = [float(s["valor"]) for s in row["scores"]]
                if len(values) == len(CRITERIOS):
                    by_batch[row["batch_id"]][row["case_id"]] = sum(values) / len(values)
        common = _common_by_version(rows, by_batch)
        return [
            {
                **{k: row[k] for k in ("id", "created_at", "provider", "model")},
                **{
                    k: row[k]
                    for k in ("prompt_version", "judge_model", "judge_version", "output_mode")
                },
                "display_name": row["display_name"],
                "judge_same_provider": row["judge_same_provider"],
                "cases": int(row["cases"]),
                "completed": int(row["completed"]),
                "valid_rate": None if row["valid_rate"] is None else float(row["valid_rate"]),
                "latency_p50_ms": row["latency_p50_ms"],
                "latency_p95_ms": row["latency_p95_ms"],
                "cost_usd_avg": None if row["cost_usd_avg"] is None else float(row["cost_usd_avg"]),
                "score_mean": mean(list(by_batch[row["id"]].values())),
                "common_cases": len(common[row["id"]]),
                "score_mean_common": mean(
                    [by_batch[row["id"]][case] for case in common[row["id"]]]
                ),
            }
            for row in rows
        ]

    async def judge_pairs(self) -> list[tuple[str, int, int]]:
        h, r = t.human_score.c, t.eval_result.c
        query = sa.select(h.criterion, h.score, r.scores).select_from(
            t.human_score.join(t.eval_result, (r.batch_id == h.batch_id) & (r.case_id == h.case_id))
        )
        async with self._engine.connect() as conn:
            rows = list((await conn.execute(query)).mappings())
        pairs: list[tuple[str, int, int]] = []
        for row in rows:
            judge = next(
                (int(s["valor"]) for s in row["scores"] if s["criterio"] == row["criterion"]),
                None,
            )
            if judge is not None:
                pairs.append((row["criterion"], judge, int(row["score"])))
        return pairs
