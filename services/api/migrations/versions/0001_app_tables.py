"""App tables: settings, credentials, usage, runs, history and evaluation.

Revision ID: 0001
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"
NOW = sa.text("now()")
EVAL_TABLES = ("eval_case", "eval_batch", "eval_result", "human_score")


def _timestamps() -> list[sa.Column[object]]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    ]


def upgrade() -> None:
    # user_id is text without a foreign key until Better Auth creates auth.user in F4.
    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.Text, primary_key=True),
        sa.Column("save_history", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("default_provider", sa.Text),
        sa.Column("default_tier", sa.Text),
        sa.Column("judge_provider", sa.Text),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        schema=SCHEMA,
    )
    op.create_table(
        "provider_credential",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("provider", sa.Text, nullable=False),
        sa.Column("ciphertext", sa.LargeBinary, nullable=False),
        sa.Column("nonce", sa.LargeBinary, nullable=False),
        sa.Column("key_version", sa.Integer, nullable=False),
        sa.Column("last4", sa.Text, nullable=False),
        sa.Column("base_url", sa.Text),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("user_id", "provider", name="provider_credential_user_provider"),
        schema=SCHEMA,
    )
    op.create_table(
        "credential_check",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        schema=SCHEMA,
    )
    op.create_index(
        "credential_check_user_time", "credential_check", ["user_id", "checked_at"], schema=SCHEMA
    )
    op.create_table(
        "usage_daily",
        sa.Column("user_id", sa.Text, primary_key=True),
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("runs", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        schema=SCHEMA,
    )
    op.create_table(
        "global_usage_daily",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("runs", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        schema=SCHEMA,
    )
    op.create_table(
        "run_start",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("uses_server_key", sa.Boolean, nullable=False),
        schema=SCHEMA,
    )
    op.create_index("run_start_user_time", "run_start", ["user_id", "started_at"], schema=SCHEMA)
    op.create_table(
        "run",
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
        *_timestamps(),
        schema=SCHEMA,
    )
    op.create_index("run_user", "run", ["user_id"], schema=SCHEMA)
    op.create_index("run_updated", "run", ["updated_at"], schema=SCHEMA)
    op.create_table(
        "run_event",
        sa.Column(
            "run_id",
            UUID(as_uuid=True),
            sa.ForeignKey(f"{SCHEMA}.run.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("seq", sa.Integer, primary_key=True),
        sa.Column("type", sa.Text, nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        schema=SCHEMA,
    )
    op.create_table(
        "saved_run",
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
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        schema=SCHEMA,
    )
    op.create_index(
        "saved_run_user_created",
        "saved_run",
        ["user_id", sa.text("created_at DESC")],
        schema=SCHEMA,
    )
    op.create_table(
        "eval_case",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("difficulty", sa.Text, nullable=False),
        sa.Column("tags", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        schema=SCHEMA,
    )
    op.create_table(
        "eval_batch",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("provider", sa.Text, nullable=False),
        sa.Column("model", sa.Text, nullable=False),
        sa.Column("prompt_version", sa.Text, nullable=False),
        sa.Column("judge_model", sa.Text, nullable=False),
        sa.Column("judge_version", sa.Text, nullable=False),
        sa.Column("output_mode", sa.Text, nullable=False),
        sa.Column("git_sha", sa.Text, nullable=False),
        sa.Column("notes", sa.Text),
        schema=SCHEMA,
    )
    op.create_table(
        "eval_result",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "batch_id",
            UUID(as_uuid=True),
            sa.ForeignKey(f"{SCHEMA}.eval_batch.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "case_id",
            UUID(as_uuid=True),
            sa.ForeignKey(f"{SCHEMA}.eval_case.id"),
            nullable=False,
        ),
        sa.Column("artifacts", JSONB, nullable=False),
        sa.Column("valid_output", sa.Boolean, nullable=False),
        sa.Column("review_rounds", sa.Integer, nullable=False),
        sa.Column("latency_ms", sa.Integer, nullable=False),
        sa.Column("tokens_in", sa.Integer, nullable=False),
        sa.Column("tokens_out", sa.Integer, nullable=False),
        sa.Column("cost_usd", sa.Numeric(12, 6)),
        sa.Column("scores", JSONB, nullable=False),
        schema=SCHEMA,
    )
    op.create_index("eval_result_batch", "eval_result", ["batch_id"], schema=SCHEMA)
    op.create_table(
        "human_score",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "batch_id",
            UUID(as_uuid=True),
            sa.ForeignKey(f"{SCHEMA}.eval_batch.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "case_id",
            UUID(as_uuid=True),
            sa.ForeignKey(f"{SCHEMA}.eval_case.id"),
            nullable=False,
        ),
        sa.Column("criterion", sa.Text, nullable=False),
        sa.Column("score", sa.Integer, nullable=False),
        schema=SCHEMA,
    )
    # Alembic creates its version table before this migration, so it inherits the API grants.
    op.execute(f"REVOKE INSERT, UPDATE, DELETE ON {SCHEMA}.alembic_version FROM api_role")
    # The API only reads evaluation results; the evaluation CLI only inserts them.
    for table in EVAL_TABLES:
        op.execute(f"REVOKE INSERT, UPDATE, DELETE ON {SCHEMA}.{table} FROM api_role")
        op.execute(f"GRANT INSERT ON {SCHEMA}.{table} TO eval_writer")


def downgrade() -> None:
    for table in (
        "human_score",
        "eval_result",
        "eval_batch",
        "eval_case",
        "saved_run",
        "run_event",
        "run",
        "run_start",
        "global_usage_daily",
        "usage_daily",
        "credential_check",
        "provider_credential",
        "user_settings",
    ):
        op.drop_table(table, schema=SCHEMA)
