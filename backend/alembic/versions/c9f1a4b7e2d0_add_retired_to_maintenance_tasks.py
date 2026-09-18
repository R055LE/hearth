"""add retired to maintenance tasks

Revision ID: c9f1a4b7e2d0
Revises: b4e8a2c1f6d9
Create Date: 2026-09-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9f1a4b7e2d0"
down_revision: Union[str, Sequence[str], None] = "b4e8a2c1f6d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "maintenance_tasks",
        sa.Column("retired", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("maintenance_tasks", "retired")
