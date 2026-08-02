from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from hearth.routers import circuit_points, circuits, floorplan, panels, rooms

# Schema is managed by Alembic (`alembic upgrade head`), not created here —
# run migrations before starting the app.

app = FastAPI(title="hearth")

api = FastAPI()
api.include_router(rooms.router)
api.include_router(panels.router)
api.include_router(circuits.router)
api.include_router(circuit_points.router)
api.include_router(floorplan.router)
app.mount("/api", api)

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "static"
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
