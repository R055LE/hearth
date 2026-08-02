# hearth backend

FastAPI + SQLAlchemy + SQLite service for the hearth home-info tracker.

## Dev setup

```
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn hearth.main:app --reload
```

## Tests

```
uv run pytest
```
