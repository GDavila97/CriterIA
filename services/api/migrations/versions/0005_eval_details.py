"""Evaluation details for F5: batch configuration, per-run details and the case metadata.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"
EMPTY = sa.text("'{}'::jsonb")


def upgrade() -> None:
    op.add_column("eval_case", sa.Column("domain", sa.Text), schema=SCHEMA)
    op.add_column(
        "eval_case",
        sa.Column("seeded_problems", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        schema=SCHEMA,
    )
    op.add_column("eval_batch", sa.Column("display_name", sa.Text), schema=SCHEMA)
    op.add_column("eval_batch", sa.Column("temperature", sa.Float), schema=SCHEMA)
    op.add_column(
        "eval_batch",
        sa.Column("judge_same_provider", sa.Boolean, nullable=False, server_default=sa.false()),
        schema=SCHEMA,
    )
    op.add_column(
        "eval_batch",
        sa.Column("settings", JSONB, nullable=False, server_default=EMPTY),
        schema=SCHEMA,
    )
    op.add_column(
        "eval_result",
        sa.Column("completed", sa.Boolean, nullable=False, server_default=sa.true()),
        schema=SCHEMA,
    )
    op.add_column("eval_result", sa.Column("error_code", sa.Text), schema=SCHEMA)
    op.add_column(
        "eval_result",
        sa.Column("details", JSONB, nullable=False, server_default=EMPTY),
        schema=SCHEMA,
    )
    # One human score per run and criterion, so publishing the session again changes nothing.
    op.create_unique_constraint(
        "human_score_once", "human_score", ["batch_id", "case_id", "criterion"], schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_constraint("human_score_once", "human_score", schema=SCHEMA)
    for table, column in (
        ("eval_result", "details"),
        ("eval_result", "error_code"),
        ("eval_result", "completed"),
        ("eval_batch", "settings"),
        ("eval_batch", "judge_same_provider"),
        ("eval_batch", "temperature"),
        ("eval_batch", "display_name"),
        ("eval_case", "seeded_problems"),
        ("eval_case", "domain"),
    ):
        op.drop_column(table, column, schema=SCHEMA)
