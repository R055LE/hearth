from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.command import upgrade
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import MetaData, Table, create_engine, inspect, text
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


def test_floor_migration_preserves_existing_labels_geometry_and_references():
    engine = create_engine("sqlite://", poolclass=StaticPool)
    config = Config(Path(__file__).parents[1] / "alembic.ini")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        upgrade(config, "c9f1a4b7e2d0")
        for room_id, floor in enumerate(("main", "Main", " upper / attic ", "main"), 1):
            connection.execute(
                text(
                    "INSERT INTO rooms (id, name, floor, polygon, measurement_source) "
                    "VALUES (:id, 'Room', :floor, '[[0, 0], [10, 0], [10, 10]]', NULL)"
                ),
                {"id": room_id, "floor": floor},
            )
        statements = (
            "INSERT INTO panels (id, name, room_id) VALUES (1, 'Panel', 1)",
            "INSERT INTO circuits (id, panel_id, breaker_label) VALUES (1, 1, '1')",
            "INSERT INTO circuit_points (id, circuit_id, room_id, kind, x, y) "
            "VALUES (1, 1, 1, 'outlet', 2, 3)",
            "INSERT INTO maintenance_tasks (id, title, room_id, due_date) "
            "VALUES (1, 'Filter', 4, '2026-10-01')",
            "INSERT INTO maintenance_completions (id, task_id, scheduled_for, completed_on) "
            "VALUES (1, 1, '2026-09-01', '2026-09-02')",
        )
        for statement in statements:
            connection.execute(text(statement))
        table_names = (
            "rooms", "panels", "circuits", "circuit_points",
            "maintenance_tasks", "maintenance_completions",
        )
        tables = [Table(name, MetaData(), autoload_with=connection) for name in table_names]
        before = {
            table.name: connection.execute(table.select().order_by(table.c.id)).all()
            for table in tables
        }

        upgrade(config, "head")

        assert {row[0] for row in connection.execute(text("SELECT name FROM floors"))} == {
            "main", "Main", " upper / attic "
        }
        assert {
            table.name: connection.execute(table.select().order_by(table.c.id)).all()
            for table in tables
        } == before
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
    engine.dispose()
