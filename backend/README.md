# hearth backend

FastAPI + SQLAlchemy + SQLite service for the hearth home-info tracker.

## Dev setup

```
uv sync --locked --extra dev
uv run --locked alembic upgrade head
uv run --locked uvicorn hearth.main:app --reload
```

## Tests

```
uv run --locked pytest
```
