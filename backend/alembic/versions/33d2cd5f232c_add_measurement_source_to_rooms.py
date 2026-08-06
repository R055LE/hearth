"""add measurement_source to rooms

Revision ID: 33d2cd5f232c
Revises: d7e8453e9723
Create Date: 2026-08-06 16:42:49.352951

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '33d2cd5f232c'
down_revision: Union[str, Sequence[str], None] = 'd7e8453e9723'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('rooms', sa.Column('measurement_source', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('rooms', 'measurement_source')
