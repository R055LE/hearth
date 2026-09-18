from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.command import upgrade
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from hearth.database import Base


def test_migrations_match_model_metadata(migrated_engine):
    with migrated_engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)

    assert differences == []


def test_maintenance_migration_upgrades_existing_database():
    engine = create_engine("sqlite://", poolclass=StaticPool)
    config = Config(Path(__file__).parents[1] / "alembic.ini")

    with engine.begin() as connection:
        config.attributes["connection"] = connection
        upgrade(config, "33d2cd5f232c")
        connection.execute(
            text(
                "INSERT INTO rooms (name, floor, polygon, measurement_source) "
                "VALUES ('Garage', 'main', '[[0, 0]]', NULL)"
            )
        )
        upgrade(config, "head")

        assert connection.execute(text("SELECT name FROM rooms")).scalar_one() == "Garage"
        assert {
            "maintenance_tasks",
            "maintenance_completions",
        }.issubset(inspect(connection).get_table_names())

    engine.dispose()


def test_retirement_migration_preserves_existing_maintenance_history():
    engine = create_engine("sqlite://", poolclass=StaticPool)
    config = Config(Path(__file__).parents[1] / "alembic.ini")

    with engine.begin() as connection:
        config.attributes["connection"] = connection
        upgrade(config, "b4e8a2c1f6d9")
        connection.execute(
            text(
                "INSERT INTO maintenance_tasks "
                "(id, title, due_date, recurrence_days, notes, is_active) "
                "VALUES (1, 'Replace filter', '2026-09-01', 90, 'Keep this', 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO maintenance_completions "
                "(id, task_id, scheduled_for, completed_on) "
                "VALUES (1, 1, '2026-06-01', '2026-06-02')"
            )
        )

        upgrade(config, "head")

        assert connection.execute(
            text(
                "SELECT title, due_date, recurrence_days, notes, is_active, retired "
                "FROM maintenance_tasks WHERE id = 1"
            )
        ).one() == ("Replace filter", "2026-09-01", 90, "Keep this", 1, 0)
        assert connection.execute(
            text(
                "SELECT task_id, scheduled_for, completed_on "
                "FROM maintenance_completions WHERE id = 1"
            )
        ).one() == (1, "2026-06-01", "2026-06-02")

    engine.dispose()
