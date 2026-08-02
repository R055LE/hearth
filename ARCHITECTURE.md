# Architecture

How hearth is put together and why, as of Phase 1 (floorplan + electrical circuits).
This is a design reference, not a spec — the code is the source of truth where they
disagree.

## Overview

Self-hosted home information tracker. Phase 1 covers rooms, electrical panels and
circuits, and an interactive floorplan that links the two: click an outlet/fixture
on the floorplan and see which breaker it's on, or click a breaker and see every
point it feeds highlighted on the floorplan. Maintenance scheduling and vendor/quote
records are later phases (see "Deferred" below) — not built yet, but the schema
doesn't need reworking to add them.

Stack: FastAPI + SQLAlchemy + SQLite on the backend, React + Vite + TypeScript SPA
on the frontend, single Docker image, no auth (tailnet/home-network access only for
now). This mirrors the only other long-running self-hosted app in this workspace
(`roger`): Python + SQLite + Docker/compose, pull-based GHCR deploy.

## Data model and the coordinate space

`rooms`, `panels`, `circuits`, and `circuit_points` are the four tables (see
`backend/hearth/models.py`). The one non-obvious piece: every room's `polygon` and
every `circuit_point`'s `x`/`y` live in the **same coordinate space per floor** —
there's no per-room-relative positioning. That's what lets the frontend render an
entire floor (all its rooms and all their points) in one `<svg>` with a single
`viewBox`, and it's why `GET /api/floorplan/{floor}` exists as a combined endpoint:
one call gets everything needed to draw a floor, instead of N+1 requests per room.

`circuits.panel_sticker_text` and `circuits.verified_description` are deliberately
separate fields — the panel label is kept even when it's known to be wrong, next to
what's actually been confirmed. That's the whole point of this project: the panel
directory lies, and this is the place that doesn't.

## Schema is Alembic-only

`main.py` does **not** call `Base.metadata.create_all()`. Schema changes go through
Alembic migrations exclusively (`alembic upgrade head`), because the schema is
expected to grow across phases (maintenance, vendors) and hand-written migrations
beat re-deriving `ALTER TABLE`s from diffed model state later. `alembic/env.py`
imports the app's own `engine`/`Base` rather than hardcoding a URL in `alembic.ini`,
so migrations always target whatever `DB_PATH` the app is actually configured with.

## Why the API is mounted at `/api`

`main.py` mounts a sub-app at `/api` *before* mounting `StaticFiles` at `/`. Route
order matters here: without the prefix, a frontend page route like `/rooms` (React
client-side routing) would collide with the API's `/rooms` (JSON). Prefixing the
API sidesteps that entirely rather than relying on route-matching order to save it.

## Frontend

Plain `fetch` + component state — no React Query or Redux. Floorplan rendering is
hand-rolled SVG (`<polygon>` for rooms, `<circle>` for circuit points), not a
diagramming library — the interaction surface (click a point, click a breaker,
place a new point) is simple enough that a library would be more API to learn than
code it replaces. Revisit both calls if the CRUD surface or floorplan interactions
grow substantially in a later phase.

## Docker: the non-root `/data` gotcha

The container runs as a fixed non-root user (uid/gid `10001`), and the rootfs is
read-only — the only writable path is the `/data` bind mount holding the SQLite
file. Docker auto-creates a missing bind-mount source directory as `root:root`,
which the non-root container user can't write into, so **the host-side `data/`
directory must be `chown 10001:10001`'d before the first `docker compose up`** or
the container crash-loops on "unable to open database file". This bit us once
during setup; `README.md` calls it out so it doesn't bite again.

## Deferred (Phase 2+)

- Maintenance scheduling (recurring tasks + history log).
- Vendors/quotes/documents (installer records, cost, warranty, attachments).
- Auth (single-user login or tighter tailnet-exposure hardening) — flagged by Ross
  as something to revisit, so nothing here hardcodes a single-implicit-user
  assumption that would make adding it later awkward.
- GHCR publish workflow + systemd-timer deploy to the actual host (roger's pattern)
  — deliberately not wired up yet; this repo only covers the app itself.
