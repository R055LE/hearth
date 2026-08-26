"""add maintenance schedules

Revision ID: b4e8a2c1f6d9
Revises: 33d2cd5f232c
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b4e8a2c1f6d9"
down_revision: Union[str, Sequence[str], None] = "33d2cd5f232c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "maintenance_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("room_id", sa.Integer(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("recurrence_days", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.CheckConstraint(
            "recurrence_days IS NULL OR recurrence_days > 0",
            name="ck_maintenance_tasks_recurrence_days_positive",
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "maintenance_completions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("scheduled_for", sa.Date(), nullable=False),
        sa.Column("completed_on", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["maintenance_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("maintenance_completions")
    op.drop_table("maintenance_tasks")
