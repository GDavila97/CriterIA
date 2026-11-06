from typing import Any, cast

import sqlalchemy as sa
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.postgres.base import BasePostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

metadata = sa.MetaData(schema="app")

user_settings = sa.Table(
    "user_settings",
    metadata,
    sa.Column("user_id", sa.Text, primary_key=True),
    sa.Column("save_history", sa.Boolean, nullable=False),
    sa.Column("default_provider", sa.Text),
    sa.Column("default_tier", sa.Text),
    sa.Column("judge_provider", sa.Text),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
)

provider_credential = sa.Table(
    "provider_credential",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("provider", sa.Text, nullable=False),
    sa.Column("ciphertext", sa.LargeBinary, nullable=False),
    sa.Column("nonce", sa.LargeBinary, nullable=False),
    sa.Column("key_version", sa.Integer, nullable=False),
    sa.Column("last4", sa.Text, nullable=False),
    sa.Column("base_url", sa.Text),
    sa.Column("validated_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
)

credential_check = sa.Table(
    "credential_check",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
)

usage_daily = sa.Table(
    "usage_daily",
    metadata,
    sa.Column("user_id", sa.Text, primary_key=True),
    sa.Column("day", sa.Date, primary_key=True),
    sa.Column("runs", sa.Integer, nullable=False),
    sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False),
)

global_usage_daily = sa.Table(
    "global_usage_daily",
    metadata,
    sa.Column("day", sa.Date, primary_key=True),
    sa.Column("runs", sa.Integer, nullable=False),
    sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False),
)

run_start = sa.Table(
    "run_start",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("uses_server_key", sa.Boolean, nullable=False),
)

run = sa.Table(
    "run",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("status", sa.Text, nullable=False),
    sa.Column("requirement", sa.Text, nullable=False),
    sa.Column("generation", JSONB, nullable=False),
    sa.Column("judge", JSONB, nullable=False),
    sa.Column("max_rounds", sa.Integer, nullable=False),
    sa.Column("server_cost_reserved_usd", sa.Numeric(12, 6), nullable=False),
    sa.Column("estimated_cost_usd", sa.Numeric(12, 6)),
    sa.Column("approval", JSONB),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
)

run_event = sa.Table(
    "run_event",
    metadata,
    sa.Column("run_id", UUID(as_uuid=True), primary_key=True),
    sa.Column("seq", sa.Integer, primary_key=True),
    sa.Column("type", sa.Text, nullable=False),
    sa.Column("payload", JSONB, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)

saved_run = sa.Table(
    "saved_run",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("requirement", sa.Text, nullable=False),
    sa.Column("artifacts", JSONB, nullable=False),
    sa.Column("scores", JSONB, nullable=False),
    sa.Column("status", sa.Text, nullable=False),
    sa.Column("provider", sa.Text, nullable=False),
    sa.Column("model", sa.Text, nullable=False),
    sa.Column("judge_model", sa.Text, nullable=False),
    sa.Column("prompt_version", sa.Text, nullable=False),
    sa.Column("judge_version", sa.Text, nullable=False),
    sa.Column("experimental", sa.Boolean, nullable=False),
    sa.Column("totals", JSONB, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)

eval_batch = sa.Table(
    "eval_batch",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("provider", sa.Text, nullable=False),
    sa.Column("model", sa.Text, nullable=False),
    sa.Column("prompt_version", sa.Text, nullable=False),
    sa.Column("judge_model", sa.Text, nullable=False),
    sa.Column("judge_version", sa.Text, nullable=False),
    sa.Column("output_mode", sa.Text, nullable=False),
    sa.Column("git_sha", sa.Text, nullable=False),
    sa.Column("notes", sa.Text),
)

eval_result = sa.Table(
    "eval_result",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True),
    sa.Column("batch_id", UUID(as_uuid=True), nullable=False),
    sa.Column("case_id", UUID(as_uuid=True), nullable=False),
    sa.Column("valid_output", sa.Boolean, nullable=False),
    sa.Column("review_rounds", sa.Integer, nullable=False),
    sa.Column("latency_ms", sa.Integer, nullable=False),
    sa.Column("tokens_in", sa.Integer, nullable=False),
    sa.Column("tokens_out", sa.Integer, nullable=False),
    sa.Column("cost_usd", sa.Numeric(12, 6)),
    sa.Column("scores", JSONB, nullable=False),
)


def _with_driver(url: str, driver: str) -> str:
    return make_url(url).set(drivername=driver).render_as_string(hide_password=False)


def create_engine(database_url: str, pool_size: int) -> AsyncEngine:
    return create_async_engine(
        _with_driver(database_url, "postgresql+psycopg"),
        pool_size=pool_size,
        max_overflow=pool_size,
        pool_pre_ping=True,
    )


def create_checkpoint_pool(database_url: str, max_size: int) -> AsyncConnectionPool:
    return AsyncConnectionPool(
        _with_driver(database_url, "postgresql"),
        open=False,
        max_size=max_size,
        kwargs={
            "autocommit": True,
            "prepare_threshold": 0,
            "row_factory": dict_row,
            "options": "-c search_path=graph",
        },
    )


class CheckpointSchemaError(RuntimeError):
    pass


class PostgresCheckpointer:
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._saver = AsyncPostgresSaver(pool)  # type: ignore[arg-type]

    def saver(self) -> AsyncPostgresSaver:
        return self._saver

    async def discard(self, run_id: object) -> None:
        await self._saver.adelete_thread(str(run_id))

    async def ensure_migrated(self) -> None:
        """The API never runs DDL; it refuses to start if the checkpoint tables are behind."""
        expected = len(BasePostgresSaver.MIGRATIONS) - 1
        async with self._pool.connection() as connection:
            cursor = await connection.execute("SELECT max(v) FROM checkpoint_migrations")
            row = await cursor.fetchone()
        current = cast(dict[str, Any], row).get("max") if row else None
        if current is None or current < expected:
            raise CheckpointSchemaError(
                f"graph checkpoints at migration {current}, expected {expected}: "
                "run the migrations first"
            )
