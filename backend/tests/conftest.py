from pathlib import Path

import pytest
from alembic.command import upgrade
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from hearth.database import get_db
from hearth.main import api


@pytest.fixture
def migrated_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    config = Config(Path(__file__).parents[1] / "alembic.ini")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        upgrade(config, "head")
    yield engine
    engine.dispose()


@pytest.fixture
def client(migrated_engine):
    engine = migrated_engine
    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    api.dependency_overrides[get_db] = override_get_db
    with TestClient(api, raise_server_exceptions=False) as test_client:
        yield test_client
    api.dependency_overrides.clear()
