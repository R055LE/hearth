"""add named floors

Revision ID: e4a1b2c3d4e5
Revises: c9f1a4b7e2d0
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4a1b2c3d4e5"
down_revision: Union[str, Sequence[str], None] = "c9f1a4b7e2d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "floors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.UniqueConstraint("name", name="uq_floors_name"),
    )
    connection = op.get_bind()
    connection.execute(sa.text("INSERT INTO floors (name) SELECT DISTINCT floor FROM rooms"))
    if connection.execute(sa.text("SELECT COUNT(*) FROM floors")).scalar_one() == 0:
        connection.execute(sa.text("INSERT INTO floors (name) VALUES ('main')"))


def downgrade() -> None:
    op.drop_table("floors")
