# Native floorplan measurement entry — design

Date: 2026-08-06

## Problem

Room shapes today are entered as raw JSON polygon vertices (`RoomEditor.tsx`'s
`polygon` textarea, e.g. `[[0,0],[10,0],[10,10],[0,10]]`) — the user has to
hand-compute absolute coordinates in the floor's shared per-floor coordinate
space for every corner of every room, with no help placing rooms next to
each other. That's the only floorplan-input path in the app right now.

Ross's actual floorplan was built in floorplancreator.net, not drawio — the
committed `scripts/import_drawio.py` importer doesn't apply to his real
workflow. floorplancreator.net's exports are raster images gated behind a
paid tier, not vector/polygon data, so there's no clean automated import
path from it either. Rather than build tooling around a paywalled external
export, floorplan input is being split into two independent features:

1. An optional background-image tracing layer (not designed here).
2. **Native measurement entry** — this document. The primary,
   dependency-free path: type what you measured with a tape measure, get a
   room polygon out.

## Scope

In scope: entering room shapes by wall length + turn direction ("walk the
perimeter"), placing rooms relative to already-placed rooms on the same
floor, and persisting the measurements so a room can be corrected later
without hand-editing vertices.

Out of scope: 3D / curved geometry (flagged by Ross as a maybe-someday need
for the sunroom, explicitly not designed for here — a different kind of tool
than what hearth is), self-intersection detection, and automatic
recomputation of rooms anchored to a room that gets edited later (see
"Rejected: full relational recipe" below).

## Data model

One new nullable JSON column on `Room`, no new table:

```python
class Room(Base):
    ...
    polygon: Mapped[list[list[float]]] = mapped_column(JSON, nullable=False)  # unchanged
    measurement_source: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # new
```

`polygon` is unchanged — still absolute per-floor coordinates in decimal
feet, still the only field the renderer (`FloorplanView.tsx`) reads.

`measurement_source` is opaque to the backend: stored and echoed back
as-is, never interpreted server-side. All parsing/computation happens in
the frontend wizard. Shape:

```jsonc
{
  "unit": "ft_in",
  "start": { "mode": "absolute", "x": 0, "y": 0, "heading_deg": 0 }
  // or: { "mode": "anchor", "anchor_room_id": 3, "wall_index": 2,
  //       "corner": "start", "offset_in": 24, "heading_deg": 90 }
  "walls": [
    { "length_in": 150, "turn": "left" },   // "left" | "right" | "straight" | {"deg": -30}
    { "length_in": 120, "turn": "left" }
  ]
}
```

`start.x`/`start.y` are decimal feet, matching `polygon`'s existing unit
(they become the polygon's first vertex directly). Wall lengths and anchor
offsets are inches (`length_in`, `offset_in`), matching how they're typed
in the ft/in wizard fields.

Backend changes: add `measurement_source: dict | None = None` to
`RoomBase`/`RoomCreate`/`RoomUpdate`/`RoomRead` in `schemas.py`, plus an
Alembic migration adding the column.

## Geometry

Wall-walk → polygon is a pure TypeScript function: given a start point +
heading and an ordered list of `{length, turn}`, rotate the heading by each
turn and extend by each length, converting `length_in` to feet for the
emitted vertices. Units: user types feet + inches (matches how a tape
measure reads); everything is stored as decimal feet in `polygon` to match
the existing coordinate space, with the original `length_in` integers kept
in `measurement_source` for exact rehydration into the wizard.

## Placement

Two starting modes, chosen per room:

- **Absolute start** — X/Y (default 0,0) + a starting heading. Used for the
  first room on a floor, or any room the user doesn't want anchored to
  another.
- **Anchor to an existing room** — reference room + which of its walls
  (derived from that room's existing `polygon`, consecutive vertex pairs —
  no new read endpoint needed) + which corner of that wall to start from +
  an offset along it (ft/in, default 0) + a heading for the new room's
  first wall. Mirrors pacing out a house room by room from a known point.

## API surface

No new endpoints. `POST /rooms` and `PATCH /rooms/{id}` already accept the
full room shape; they just gain the optional `measurement_source` field.
Placement-by-anchor reads walls from polygons the frontend already has via
`GET /rooms` / `GET /api/floorplan/{floor}`.

## UI flow

Replaces the raw-JSON textarea in `RoomEditor.tsx` with a wizard (new
component, e.g. `RoomBuilder.tsx`), reusing `FloorplanView`'s SVG rendering
for a live preview of the in-progress room drawn in context alongside every
room already placed on that floor.

1. **Name + floor** — same fields as today.
2. **Placement** — radio choice; "Attach to existing room" only offered if
   the floor already has rooms.
   - *Start fresh*: numeric X/Y + starting heading via four arrow buttons
     (↑↓←→), with a custom-degree field for non-rectilinear starts.
   - *Attach to existing room*: pick a room, click one of its walls on the
     live preview (walls highlight on hover), pick a corner, an offset
     along that wall, and a heading for the new room's first wall
     (defaulting to "away from" the anchor wall).
3. **Wall walk** — repeating rows: `Wall N: [length ft] [length in] Turn:
   [Left 90°|Right 90°|Straight|Custom°]`. "Add wall" appends a row and
   redraws the live preview immediately. "Undo last wall" removes the most
   recent row. The preview always shows the in-progress polygon over the
   rest of the floor, so a wrong turn is visible before more walls compound
   the error.
4. **Close shape** — validates the pen returns to the start point within a
   small epsilon (~1 inch). On success, shows the final polygon and a
   submit button. On failure, shows the gap distance and keeps the user in
   the wall-walk step to fix it. No auto-filled closing wall — every wall
   that was measured gets entered; the app catches the arithmetic mistake.

Editing an existing room reopens the same wizard pre-filled from
`measurement_source` (placement + wall list), recomputes on save, and
overwrites `polygon`. No propagation to rooms anchored to the one being
edited (see "Rejected" below).

## Error handling

- **Closure check** — described above; blocks submit with a visible gap
  distance rather than silently storing an open shape.
- **Self-intersection** — not validated. Rare for a rectilinear room and
  real geometry work to detect in general; explicitly deferred.
- **Stale anchor on edit** — if a room was anchored to another room that's
  since been deleted, reopening the wizard falls back to "absolute start"
  using the last computed start point, with a note that the original
  anchor is gone. Doesn't block editing.
- **Malformed ft/in input** — inline validation error, same pattern
  `RoomEditor.tsx` already uses for its polygon field today.

## Testing

- **Backend**: `measurement_source` is opaque and uninterpreted server-side
  — a round-trip check (create/update with it set, read it back) alongside
  existing room CRUD tests. No new backend logic to test.
- **Frontend**: the wall-walk → polygon function is the one piece of real
  logic here and worth unit testing (square, L-shape, closure-failure case,
  custom-angle case). No test runner exists in the frontend today — CI only
  lints and builds it (`.github/workflows/ci.yml`). Adding vitest (Vite-native,
  zero-config with this setup) is in scope for this feature, scoped to
  testing that one pure function — not broader component/UI testing — plus
  a `frontend test` step added to the existing CI job.

## Rejected approaches

- **Compute-and-forget** — wizard runs entirely client-side, `POST`s only
  the final `polygon`, identical to today's flow minus the raw-JSON UX.
  Rejected: the whole point is to make a mismeasured wall correctable
  later without hand-editing vertices; this would throw that recipe away
  the moment it's submitted.
- **Full relational recipe with auto-recompute chains** — model walls and
  placement anchors as real rows, so fixing one room's wall length ripples
  through every room anchored to it. Rejected on YAGNI grounds: this is a
  house entered once by one person, not a continuously-re-edited layout —
  the cascade-recompute complexity doesn't match the actual workflow.
