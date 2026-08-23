from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from hearth.database import Base


def test_migrations_match_model_metadata(migrated_engine):
    with migrated_engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)

    assert differences == []
