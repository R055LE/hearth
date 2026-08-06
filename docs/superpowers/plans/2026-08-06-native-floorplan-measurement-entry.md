# Native Floorplan Measurement Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-JSON polygon textarea in `RoomEditor.tsx` with a wall-length-and-turn wizard that computes room polygons, lets a room be placed relative to one already on the floor, and persists the measurement recipe so a wrong wall length is fixable later without hand-editing vertices.

**Architecture:** One new nullable JSON column (`Room.measurement_source`) that the backend stores and returns opaquely, never interprets. A pure TypeScript geometry module (`wallWalk.ts`) turns a start point + ordered wall list into polygon vertices and a closure-gap check. A new `RoomBuilder.tsx` wizard component drives that module, rendering a live SVG preview and calling the existing `POST/PATCH /rooms` endpoints — no new API surface.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + SQLite (backend); React 19 + Vite + TypeScript (frontend); vitest (new, frontend-only).

Design spec: `docs/superpowers/specs/2026-08-06-native-floorplan-measurement-entry-design.md`

## Global Constraints

- Backend: Python 3.12+, schema changes go through Alembic only — `main.py` never calls `Base.metadata.create_all()`. `ruff check .` must pass (`select = ["E","F","I","UP","B","S"]`, line-length 100). `pytest` must pass.
- Frontend: React 19 + Vite + TS. `oxlint` must pass. `npm run build` (`tsc -b && vite build`) must succeed with no type errors.
- No new API endpoints — extend the existing `POST /rooms` / `PATCH /rooms/{id}` only.
- `measurement_source` is opaque JSON to the backend — store and return it verbatim, never parse or validate its contents server-side.
- Match existing frontend convention: API-shaped fields use snake_case directly in TS (no camelCase translation layer — see `types.ts`'s existing `room_id`, `panel_sticker_text`, etc.). Flat top-level modules under `frontend/src/`; React components only go in `frontend/src/components/`.
- No new runtime dependencies beyond `vitest` (dev-only, frontend).

---

### Task 1: Add `measurement_source` column to `Room`

**Files:**
- Modify: `backend/hearth/models.py`
- Modify: `backend/hearth/schemas.py`
- Create: `backend/alembic/versions/<generated>_add_measurement_source_to_rooms.py`
- Test: `backend/tests/test_rooms.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `models.Room.measurement_source: dict | None`; `schemas.RoomBase.measurement_source: dict | None = None` (inherited by `RoomCreate`/`RoomRead`); `schemas.RoomUpdate.measurement_source: dict | None = None`. `POST /rooms` and `PATCH /rooms/{id}` accept and return this field.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_rooms.py`:

```python
def test_create_room_with_measurement_source(client):
    source = {
        "unit": "ft_in",
        "start": {"mode": "absolute", "x": 0, "y": 0, "heading_deg": 0},
        "walls": [
            {"length_in": 120, "turn": "right"},
            {"length_in": 120, "turn": "right"},
            {"length_in": 120, "turn": "right"},
            {"length_in": 120, "turn": "right"},
        ],
    }
    resp = client.post(
        "/rooms",
        json={
            "name": "Kitchen",
            "floor": "main",
            "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]],
            "measurement_source": source,
        },
    )
    assert resp.status_code == 201
    room = resp.json()
    assert room["measurement_source"] == source

    resp = client.get(f"/rooms/{room['id']}")
    assert resp.json()["measurement_source"] == source


def test_create_room_without_measurement_source(client):
    resp = client.post(
        "/rooms", json={"name": "Garage", "floor": "main", "polygon": [[0, 0]]}
    )
    assert resp.status_code == 201
    assert resp.json()["measurement_source"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_rooms.py -v`
Expected: FAIL on `test_create_room_with_measurement_source` — the field doesn't exist on `RoomRead` yet, so `room["measurement_source"]` raises `KeyError` (pydantic silently drops the unrecognized input field, and the response has no such key).

- [ ] **Step 3: Add the column to the model**

In `backend/hearth/models.py`, in the `Room` class, after the `polygon` line:

```python
    # Ordered wall-walk + placement that produced `polygon`; opaque to the backend,
    # kept so a mismeasured wall is correctable without hand-editing vertices.
    measurement_source: Mapped[dict | None] = mapped_column(JSON, nullable=True)
```

- [ ] **Step 4: Add the field to the schemas**

In `backend/hearth/schemas.py`, add `measurement_source: dict | None = None` to both `RoomBase` and `RoomUpdate`:

```python
class RoomBase(BaseModel):
    name: str
    floor: str
    polygon: list[Point]
    measurement_source: dict | None = None


class RoomUpdate(BaseModel):
    name: str | None = None
    floor: str | None = None
    polygon: list[Point] | None = None
    measurement_source: dict | None = None
```

- [ ] **Step 5: Generate the Alembic migration**

Run: `cd backend && uv run alembic revision -m "add measurement_source to rooms"`

This creates `backend/alembic/versions/<hash>_add_measurement_source_to_rooms.py` with a freshly generated revision id and `down_revision` already pointing at the current head (`d7e8453e9723`). Leave those as generated. Replace the body:

```python
def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('rooms', sa.Column('measurement_source', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('rooms', 'measurement_source')
```

- [ ] **Step 6: Apply the migration and run the tests**

Run: `cd backend && uv run alembic upgrade head && uv run pytest -v`
Expected: all tests PASS, including the two new ones.

- [ ] **Step 7: Lint**

Run: `cd backend && uv run ruff check .`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/hearth/models.py backend/hearth/schemas.py backend/tests/test_rooms.py backend/alembic/versions/
git commit -m "Add measurement_source column to rooms"
```

---

### Task 2: Set up vitest and implement the wall-walk geometry module

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/wallWalk.ts`
- Test: `frontend/src/wallWalk.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: from `frontend/src/wallWalk.ts` — `type Turn = 'left' | 'right' | 'straight' | { deg: number }`, `interface Wall { length_in: number; turn: Turn }`, `interface StartPoint { x: number; y: number; heading_deg: number }`, `type PolygonPoint = [number, number]`, `turnAngleDeg(turn: Turn): number`, `wallsToVertices(start: StartPoint, walls: Wall[]): { x: number; y: number }[]`, `closureGapFt(start: StartPoint, walls: Wall[]): number`, `wallsToPolygon(start: StartPoint, walls: Wall[]): PolygonPoint[]`. From `frontend/src/types.ts` — `interface MeasurementSource { unit: 'ft_in'; start: {...}; walls: {...}[] }`, `Room.measurement_source?: MeasurementSource | null`.

- [ ] **Step 1: Add vitest**

In `frontend/package.json`, add to `devDependencies`:

```json
    "vitest": "^3.2.4",
```

And add a script:

```json
    "test": "vitest run",
```

Run: `cd frontend && npm install`

- [ ] **Step 2: Wire vitest into the Vite config**

In `frontend/vite.config.ts`, change the import and add a `test` block:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Backend runs separately in dev (uvicorn on :8000); production serves both from one origin.
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 3: Write the failing test**

Create `frontend/src/wallWalk.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { closureGapFt, turnAngleDeg, wallsToPolygon } from './wallWalk';

describe('turnAngleDeg', () => {
  it('resolves named and custom turns', () => {
    expect(turnAngleDeg('left')).toBe(-90);
    expect(turnAngleDeg('right')).toBe(90);
    expect(turnAngleDeg('straight')).toBe(0);
    expect(turnAngleDeg({ deg: -30 })).toBe(-30);
  });
});

describe('wallsToPolygon', () => {
  const start = { x: 0, y: 0, heading_deg: 0 };

  it('closes a simple square', () => {
    const walls = [
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
    ];
    expect(closureGapFt(start, walls)).toBeCloseTo(0, 6);
    expect(wallsToPolygon(start, walls)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it('closes an L-shape with a concave turn', () => {
    const walls = [
      { length_in: 240, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'left' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 240, turn: 'right' as const },
    ];
    expect(closureGapFt(start, walls)).toBeCloseTo(0, 6);
    expect(wallsToPolygon(start, walls)).toEqual([
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ]);
  });

  it('flags an open shape via closure gap', () => {
    const walls = [
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 100, turn: 'right' as const },
    ];
    expect(closureGapFt(start, walls)).toBeCloseTo(20 / 12, 3);
  });

  it('treats a custom-degree turn as equivalent to its named counterpart', () => {
    const named = [
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'straight' as const },
    ];
    const custom = [
      { length_in: 120, turn: { deg: 90 } },
      { length_in: 120, turn: { deg: 0 } },
    ];
    expect(wallsToPolygon(start, custom)).toEqual(wallsToPolygon(start, named));
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd frontend && npm run test`
Expected: FAIL — cannot find module `./wallWalk`.

- [ ] **Step 5: Implement the geometry module**

Create `frontend/src/wallWalk.ts`:

```ts
export type Turn = 'left' | 'right' | 'straight' | { deg: number };

export interface Wall {
  length_in: number;
  turn: Turn;
}

export interface StartPoint {
  x: number;
  y: number;
  heading_deg: number;
}

export type PolygonPoint = [number, number];

export function turnAngleDeg(turn: Turn): number {
  if (turn === 'left') return -90;
  if (turn === 'right') return 90;
  if (turn === 'straight') return 0;
  return turn.deg;
}

function headingVector(headingDeg: number): { x: number; y: number } {
  const rad = (headingDeg * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

export function wallsToVertices(start: StartPoint, walls: Wall[]): { x: number; y: number }[] {
  const vertices = [{ x: start.x, y: start.y }];
  let heading = start.heading_deg;
  let pos = { x: start.x, y: start.y };
  for (const wall of walls) {
    const lengthFt = wall.length_in / 12;
    const dir = headingVector(heading);
    pos = { x: pos.x + dir.x * lengthFt, y: pos.y + dir.y * lengthFt };
    vertices.push(pos);
    heading += turnAngleDeg(wall.turn);
  }
  return vertices;
}

export function closureGapFt(start: StartPoint, walls: Wall[]): number {
  if (walls.length === 0) return 0;
  const vertices = wallsToVertices(start, walls);
  const last = vertices[vertices.length - 1];
  return Math.hypot(last.x - start.x, last.y - start.y);
}

function roundFt(n: number): number {
  return Math.round(n * 10) / 10 || 0;
}

export function wallsToPolygon(start: StartPoint, walls: Wall[]): PolygonPoint[] {
  const vertices = wallsToVertices(start, walls);
  return vertices.slice(0, -1).map((v): PolygonPoint => [roundFt(v.x), roundFt(v.y)]);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npm run test`
Expected: all 6 tests PASS.

- [ ] **Step 7: Add the `measurement_source` type and wire it into `Room`**

In `frontend/src/types.ts`, add near the top (after the `Point` export):

```ts
import type { Turn } from './wallWalk';

export interface MeasurementSource {
  unit: 'ft_in';
  start:
    | { mode: 'absolute'; x: number; y: number; heading_deg: number }
    | {
        mode: 'anchor';
        anchor_room_id: number;
        wall_index: number;
        corner: 'start' | 'end';
        offset_in: number;
        heading_deg: number;
      };
  walls: { length_in: number; turn: Turn }[];
}
```

And add the field to `Room` (optional, so existing call sites that don't set it still typecheck):

```ts
export interface Room {
  id: number;
  name: string;
  floor: string;
  polygon: Point[];
  measurement_source?: MeasurementSource | null;
}
```

- [ ] **Step 8: Typecheck**

Run: `cd frontend && npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 9: Add the CI test step**

In `.github/workflows/ci.yml`, in the `frontend` job, add a test step before `Typecheck + build`:

```yaml
      - run: npm ci
      - name: Lint
        run: npm run lint
      - name: Test
        run: npm run test
      - name: Typecheck + build
        run: npm run build
```

- [ ] **Step 10: Lint**

Run: `cd frontend && npm run lint`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/wallWalk.ts frontend/src/wallWalk.test.ts frontend/src/types.ts .github/workflows/ci.yml
git commit -m "Add wall-walk geometry module with vitest"
```

---

### Task 3: Build the fresh-start room-builder wizard

**Files:**
- Create: `frontend/src/components/RoomBuilder.tsx`
- Modify: `frontend/src/components/RoomEditor.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `wallsToVertices`, `closureGapFt`, `wallsToPolygon`, `Turn`, `StartPoint` from `../wallWalk` (Task 2); `MeasurementSource`, `Room` from `../types` (Task 2); `api.rooms.create` from `../api`; `measurement_source` persisted by the backend (Task 1).
- Produces: `RoomBuilder({ allRooms: Room[]; onSaved: () => void })` exported from `frontend/src/components/RoomBuilder.tsx`.

- [ ] **Step 1: Add CSS for the wizard**

In `frontend/src/App.css`, add:

```css
.room-builder {
  display: flex;
  gap: 1.5rem;
}

.heading-buttons {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.heading-buttons button.active {
  font-weight: bold;
  color: #f97316;
}

.wall-list {
  list-style: none;
  padding-left: 0;
  margin-bottom: 0.5rem;
}

.draft-room-outline {
  fill: none;
  stroke: #f97316;
  stroke-width: 0.4;
}
```

- [ ] **Step 2: Create the wizard component**

Create `frontend/src/components/RoomBuilder.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { api } from '../api';
import { closureGapFt, wallsToPolygon, wallsToVertices } from '../wallWalk';
import type { StartPoint, Turn, Wall } from '../wallWalk';
import type { MeasurementSource, Room } from '../types';

const CLOSURE_EPSILON_FT = 1 / 12;

const HEADINGS: { label: string; deg: number }[] = [
  { label: '↑', deg: 270 },
  { label: '↓', deg: 90 },
  { label: '←', deg: 180 },
  { label: '→', deg: 0 },
];

export function RoomBuilder({ allRooms, onSaved }: { allRooms: Room[]; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('main');
  const [start, setStart] = useState<StartPoint>({ x: 0, y: 0, heading_deg: 0 });
  const [walls, setWalls] = useState<Wall[]>([]);
  const [draftFeet, setDraftFeet] = useState('');
  const [draftInches, setDraftInches] = useState('');
  const [draftTurn, setDraftTurn] = useState<'left' | 'right' | 'straight' | 'custom'>('right');
  const [draftCustomDeg, setDraftCustomDeg] = useState('');
  const [error, setError] = useState<string | null>(null);

  const roomsOnFloor = useMemo(() => allRooms.filter((r) => r.floor === floor), [allRooms, floor]);
  const vertices = useMemo(() => wallsToVertices(start, walls), [start, walls]);
  const gap = useMemo(() => closureGapFt(start, walls), [start, walls]);
  const closed = walls.length >= 3 && gap <= CLOSURE_EPSILON_FT;

  const bounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const room of roomsOnFloor) {
      for (const [x, y] of room.polygon) {
        xs.push(x);
        ys.push(y);
      }
    }
    for (const v of vertices) {
      xs.push(v.x);
      ys.push(v.y);
    }
    if (xs.length === 0) return { minX: 0, minY: 0, width: 20, height: 20 };
    const pad = 5;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(...xs) - minX + pad;
    const height = Math.max(...ys) - minY + pad;
    return { minX, minY, width, height };
  }, [roomsOnFloor, vertices]);

  function addWall() {
    const feet = draftFeet === '' ? 0 : Number(draftFeet);
    const inches = draftInches === '' ? 0 : Number(draftInches);
    if (Number.isNaN(feet) || Number.isNaN(inches)) {
      setError('Wall length must be a number.');
      return;
    }
    const length_in = feet * 12 + inches;
    if (length_in <= 0) {
      setError('Wall length must be greater than zero.');
      return;
    }
    const turn: Turn = draftTurn === 'custom' ? { deg: Number(draftCustomDeg) || 0 } : draftTurn;
    setWalls((w) => [...w, { length_in, turn }]);
    setDraftFeet('');
    setDraftInches('');
    setError(null);
  }

  function undoLastWall() {
    setWalls((w) => w.slice(0, -1));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!closed) {
      setError(`Shape doesn't close — off by ${(gap * 12).toFixed(1)}in. Adjust a wall length.`);
      return;
    }
    const polygon = wallsToPolygon(start, walls);
    const measurement_source: MeasurementSource = {
      unit: 'ft_in',
      start: { mode: 'absolute', x: start.x, y: start.y, heading_deg: start.heading_deg },
      walls,
    };
    await api.rooms.create({ name, floor, polygon, measurement_source });
    setName('');
    setWalls([]);
    setError(null);
    onSaved();
  }

  return (
    <div className="room-builder">
      <form className="stacked-form" onSubmit={submit}>
        <label>
          Name: <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Floor: <input value={floor} onChange={(e) => setFloor(e.target.value)} required />
        </label>

        <fieldset>
          <legend>Start point</legend>
          <label>
            X (ft):{' '}
            <input
              type="number"
              value={start.x}
              onChange={(e) => setStart((s) => ({ ...s, x: Number(e.target.value) }))}
            />
          </label>
          <label>
            Y (ft):{' '}
            <input
              type="number"
              value={start.y}
              onChange={(e) => setStart((s) => ({ ...s, y: Number(e.target.value) }))}
            />
          </label>
          <div className="heading-buttons">
            {HEADINGS.map((h) => (
              <button
                key={h.deg}
                type="button"
                className={start.heading_deg === h.deg ? 'active' : ''}
                onClick={() => setStart((s) => ({ ...s, heading_deg: h.deg }))}
              >
                {h.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Walls</legend>
          <ul className="wall-list">
            {walls.map((w, i) => (
              <li key={i}>
                {(w.length_in / 12).toFixed(2)}ft, turn{' '}
                {typeof w.turn === 'string' ? w.turn : `${w.turn.deg}°`}
              </li>
            ))}
          </ul>
          <div className="inline-form">
            <input
              type="number"
              placeholder="ft"
              value={draftFeet}
              onChange={(e) => setDraftFeet(e.target.value)}
            />
            <input
              type="number"
              placeholder="in"
              value={draftInches}
              onChange={(e) => setDraftInches(e.target.value)}
            />
            <select value={draftTurn} onChange={(e) => setDraftTurn(e.target.value as typeof draftTurn)}>
              <option value="left">Turn left</option>
              <option value="right">Turn right</option>
              <option value="straight">Straight</option>
              <option value="custom">Custom angle</option>
            </select>
            {draftTurn === 'custom' && (
              <input
                type="number"
                placeholder="deg"
                value={draftCustomDeg}
                onChange={(e) => setDraftCustomDeg(e.target.value)}
              />
            )}
            <button type="button" onClick={addWall}>
              Add wall
            </button>
            <button type="button" onClick={undoLastWall} disabled={walls.length === 0}>
              Undo last wall
            </button>
          </div>
          <p>
            {closed
              ? 'Shape closed ✓'
              : walls.length > 0
                ? `Gap: ${(gap * 12).toFixed(1)}in`
                : 'Add at least 3 walls'}
          </p>
        </fieldset>

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={!closed}>
          Create room
        </button>
      </form>

      <svg viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} className="floorplan-svg">
        {roomsOnFloor.map((room) => (
          <polygon
            key={room.id}
            points={room.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
            className="room-polygon"
          />
        ))}
        {vertices.length > 1 && (
          <polyline points={vertices.map((v) => `${v.x},${v.y}`).join(' ')} className="draft-room-outline" />
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Replace the raw-JSON form in `RoomEditor.tsx`**

Replace the full contents of `frontend/src/components/RoomEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Room } from '../types';
import { RoomBuilder } from './RoomBuilder';

export function RoomEditor() {
  const [rooms, setRooms] = useState<Room[]>([]);

  function refresh() {
    api.rooms.list().then(setRooms);
  }

  useEffect(refresh, []);

  async function deleteRoom(id: number) {
    await api.rooms.remove(id);
    refresh();
  }

  return (
    <div>
      <h2>Rooms</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Floor</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <td>{room.name}</td>
              <td>{room.floor}</td>
              <td>
                <button onClick={() => deleteRoom(room.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Add room</h3>
      <RoomBuilder allRooms={rooms} onSaved={refresh} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 5: Manual verification**

Start both dev servers if not already running:

```bash
cd backend && uv run uvicorn hearth.main:app --reload --port 8000 &
cd frontend && npm run dev &
```

Open `http://localhost:5173`, go to the Rooms tab. In "Add room": name `Kitchen`, floor `main`, start X=0 Y=0 heading `→` (east). Add four walls: `10ft 0in`, turn right × 4. After the fourth wall, the page should show "Shape closed ✓" and the preview should show a closed square. Click "Create room". Switch to the Floorplan tab, select floor `main`, and confirm the square renders at the same position a room created via the old textarea with `[[0,0],[10,0],[10,10],[0,10]]` would have.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/RoomBuilder.tsx frontend/src/components/RoomEditor.tsx frontend/src/App.css
git commit -m "Replace raw-JSON room form with a wall-walk wizard"
```

---

### Task 4: Add anchor-to-existing-room placement

**Files:**
- Modify: `frontend/src/components/RoomBuilder.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: Task 3's `RoomBuilder.tsx` (rewritten in place, same export signature: `RoomBuilder({ allRooms, onSaved })`).
- Produces: `RoomBuilder` now supports `placementMode: 'fresh' | 'anchor'`; the `measurement_source.start` it submits can be either `{mode:'absolute',...}` or `{mode:'anchor',...}`.

- [ ] **Step 1: Add CSS for the anchor highlight**

In `frontend/src/App.css`, add:

```css
.anchor-room {
  stroke: #f97316;
  stroke-width: 0.6;
}
```

- [ ] **Step 2: Replace `RoomBuilder.tsx` with the anchor-aware version**

Replace the full contents of `frontend/src/components/RoomBuilder.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { api } from '../api';
import { closureGapFt, wallsToPolygon, wallsToVertices } from '../wallWalk';
import type { StartPoint, Turn, Wall } from '../wallWalk';
import type { MeasurementSource, Room } from '../types';

const CLOSURE_EPSILON_FT = 1 / 12;

const HEADINGS: { label: string; deg: number }[] = [
  { label: '↑', deg: 270 },
  { label: '↓', deg: 90 },
  { label: '←', deg: 180 },
  { label: '→', deg: 0 },
];

function roomWalls(room: Room): { from: [number, number]; to: [number, number] }[] {
  return room.polygon.map((from, i) => ({
    from,
    to: room.polygon[(i + 1) % room.polygon.length],
  }));
}

export function RoomBuilder({ allRooms, onSaved }: { allRooms: Room[]; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('main');
  const [placementMode, setPlacementMode] = useState<'fresh' | 'anchor'>('fresh');
  const [start, setStart] = useState<StartPoint>({ x: 0, y: 0, heading_deg: 0 });
  const [anchorRoomId, setAnchorRoomId] = useState<number | ''>('');
  const [anchorWallIndex, setAnchorWallIndex] = useState(0);
  const [anchorCorner, setAnchorCorner] = useState<'start' | 'end'>('start');
  const [anchorOffsetIn, setAnchorOffsetIn] = useState('0');
  const [anchorHeadingDeg, setAnchorHeadingDeg] = useState(0);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [draftFeet, setDraftFeet] = useState('');
  const [draftInches, setDraftInches] = useState('');
  const [draftTurn, setDraftTurn] = useState<'left' | 'right' | 'straight' | 'custom'>('right');
  const [draftCustomDeg, setDraftCustomDeg] = useState('');
  const [error, setError] = useState<string | null>(null);

  const roomsOnFloor = useMemo(() => allRooms.filter((r) => r.floor === floor), [allRooms, floor]);
  const anchorRoom = useMemo(
    () => roomsOnFloor.find((r) => r.id === anchorRoomId) ?? null,
    [roomsOnFloor, anchorRoomId],
  );
  const anchorWalls = useMemo(() => (anchorRoom ? roomWalls(anchorRoom) : []), [anchorRoom]);

  const resolvedStart = useMemo<StartPoint>(() => {
    if (placementMode === 'fresh' || !anchorRoom) return start;
    const wall = anchorWalls[anchorWallIndex] ?? anchorWalls[0];
    if (!wall) return start;
    const [fromX, fromY] = anchorCorner === 'start' ? wall.from : wall.to;
    const [toX, toY] = anchorCorner === 'start' ? wall.to : wall.from;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const wallLen = Math.hypot(dx, dy) || 1;
    const offsetFt = (Number(anchorOffsetIn) || 0) / 12;
    return {
      x: fromX + (dx / wallLen) * offsetFt,
      y: fromY + (dy / wallLen) * offsetFt,
      heading_deg: anchorHeadingDeg,
    };
  }, [
    placementMode,
    anchorRoom,
    anchorWalls,
    anchorWallIndex,
    anchorCorner,
    anchorOffsetIn,
    anchorHeadingDeg,
    start,
  ]);

  const vertices = useMemo(() => wallsToVertices(resolvedStart, walls), [resolvedStart, walls]);
  const gap = useMemo(() => closureGapFt(resolvedStart, walls), [resolvedStart, walls]);
  const closed = walls.length >= 3 && gap <= CLOSURE_EPSILON_FT;

  const bounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const room of roomsOnFloor) {
      for (const [x, y] of room.polygon) {
        xs.push(x);
        ys.push(y);
      }
    }
    for (const v of vertices) {
      xs.push(v.x);
      ys.push(v.y);
    }
    if (xs.length === 0) return { minX: 0, minY: 0, width: 20, height: 20 };
    const pad = 5;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(...xs) - minX + pad;
    const height = Math.max(...ys) - minY + pad;
    return { minX, minY, width, height };
  }, [roomsOnFloor, vertices]);

  function addWall() {
    const feet = draftFeet === '' ? 0 : Number(draftFeet);
    const inches = draftInches === '' ? 0 : Number(draftInches);
    if (Number.isNaN(feet) || Number.isNaN(inches)) {
      setError('Wall length must be a number.');
      return;
    }
    const length_in = feet * 12 + inches;
    if (length_in <= 0) {
      setError('Wall length must be greater than zero.');
      return;
    }
    const turn: Turn = draftTurn === 'custom' ? { deg: Number(draftCustomDeg) || 0 } : draftTurn;
    setWalls((w) => [...w, { length_in, turn }]);
    setDraftFeet('');
    setDraftInches('');
    setError(null);
  }

  function undoLastWall() {
    setWalls((w) => w.slice(0, -1));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!closed) {
      setError(`Shape doesn't close — off by ${(gap * 12).toFixed(1)}in. Adjust a wall length.`);
      return;
    }
    const polygon = wallsToPolygon(resolvedStart, walls);
    const sourceStart: MeasurementSource['start'] =
      placementMode === 'fresh' || anchorRoomId === ''
        ? { mode: 'absolute', x: start.x, y: start.y, heading_deg: start.heading_deg }
        : {
            mode: 'anchor',
            anchor_room_id: anchorRoomId,
            wall_index: anchorWallIndex,
            corner: anchorCorner,
            offset_in: Number(anchorOffsetIn) || 0,
            heading_deg: anchorHeadingDeg,
          };
    const measurement_source: MeasurementSource = { unit: 'ft_in', start: sourceStart, walls };
    await api.rooms.create({ name, floor, polygon, measurement_source });
    setName('');
    setWalls([]);
    setError(null);
    onSaved();
  }

  return (
    <div className="room-builder">
      <form className="stacked-form" onSubmit={submit}>
        <label>
          Name: <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Floor: <input value={floor} onChange={(e) => setFloor(e.target.value)} required />
        </label>

        <fieldset>
          <legend>Placement</legend>
          <label>
            <input type="radio" checked={placementMode === 'fresh'} onChange={() => setPlacementMode('fresh')} />
            Start fresh
          </label>
          {roomsOnFloor.length > 0 && (
            <label>
              <input
                type="radio"
                checked={placementMode === 'anchor'}
                onChange={() => setPlacementMode('anchor')}
              />
              Attach to existing room
            </label>
          )}

          {placementMode === 'fresh' ? (
            <>
              <label>
                X (ft):{' '}
                <input
                  type="number"
                  value={start.x}
                  onChange={(e) => setStart((s) => ({ ...s, x: Number(e.target.value) }))}
                />
              </label>
              <label>
                Y (ft):{' '}
                <input
                  type="number"
                  value={start.y}
                  onChange={(e) => setStart((s) => ({ ...s, y: Number(e.target.value) }))}
                />
              </label>
              <div className="heading-buttons">
                {HEADINGS.map((h) => (
                  <button
                    key={h.deg}
                    type="button"
                    className={start.heading_deg === h.deg ? 'active' : ''}
                    onClick={() => setStart((s) => ({ ...s, heading_deg: h.deg }))}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <label>
                Room:{' '}
                <select value={anchorRoomId} onChange={(e) => setAnchorRoomId(Number(e.target.value))}>
                  <option value="" disabled>
                    Select a room
                  </option>
                  {roomsOnFloor.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {anchorRoom && (
                <label>
                  Wall:{' '}
                  <select value={anchorWallIndex} onChange={(e) => setAnchorWallIndex(Number(e.target.value))}>
                    {anchorWalls.map((w, i) => (
                      <option key={i} value={i}>
                        Wall {i + 1}: ({w.from[0]}, {w.from[1]}) → ({w.to[0]}, {w.to[1]})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Corner:{' '}
                <select value={anchorCorner} onChange={(e) => setAnchorCorner(e.target.value as 'start' | 'end')}>
                  <option value="start">Wall start</option>
                  <option value="end">Wall end</option>
                </select>
              </label>
              <label>
                Offset (in):{' '}
                <input type="number" value={anchorOffsetIn} onChange={(e) => setAnchorOffsetIn(e.target.value)} />
              </label>
              <div className="heading-buttons">
                {HEADINGS.map((h) => (
                  <button
                    key={h.deg}
                    type="button"
                    className={anchorHeadingDeg === h.deg ? 'active' : ''}
                    onClick={() => setAnchorHeadingDeg(h.deg)}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>Walls</legend>
          <ul className="wall-list">
            {walls.map((w, i) => (
              <li key={i}>
                {(w.length_in / 12).toFixed(2)}ft, turn{' '}
                {typeof w.turn === 'string' ? w.turn : `${w.turn.deg}°`}
              </li>
            ))}
          </ul>
          <div className="inline-form">
            <input
              type="number"
              placeholder="ft"
              value={draftFeet}
              onChange={(e) => setDraftFeet(e.target.value)}
            />
            <input
              type="number"
              placeholder="in"
              value={draftInches}
              onChange={(e) => setDraftInches(e.target.value)}
            />
            <select value={draftTurn} onChange={(e) => setDraftTurn(e.target.value as typeof draftTurn)}>
              <option value="left">Turn left</option>
              <option value="right">Turn right</option>
              <option value="straight">Straight</option>
              <option value="custom">Custom angle</option>
            </select>
            {draftTurn === 'custom' && (
              <input
                type="number"
                placeholder="deg"
                value={draftCustomDeg}
                onChange={(e) => setDraftCustomDeg(e.target.value)}
              />
            )}
            <button type="button" onClick={addWall}>
              Add wall
            </button>
            <button type="button" onClick={undoLastWall} disabled={walls.length === 0}>
              Undo last wall
            </button>
          </div>
          <p>
            {closed
              ? 'Shape closed ✓'
              : walls.length > 0
                ? `Gap: ${(gap * 12).toFixed(1)}in`
                : 'Add at least 3 walls'}
          </p>
        </fieldset>

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={!closed}>
          Create room
        </button>
      </form>

      <svg viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} className="floorplan-svg">
        {roomsOnFloor.map((room) => (
          <polygon
            key={room.id}
            points={room.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
            className={room.id === anchorRoomId ? 'room-polygon anchor-room' : 'room-polygon'}
          />
        ))}
        {vertices.length > 1 && (
          <polyline points={vertices.map((v) => `${v.x},${v.y}`).join(' ')} className="draft-room-outline" />
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 4: Manual verification**

With the dev servers running, in the Rooms tab: create room `A` fresh at X=0 Y=0 heading east, four `10ft 0in` walls turning right each time (same as Task 3's check) — this reproduces `[[0,0],[10,0],[10,10],[0,10]]`.

Then create room `B`: placement "Attach to existing room", room `A`, Wall 2 (should read `(10, 0) → (10, 10)`), corner "Wall start", offset `0`, heading `→` (east). Add four `10ft 0in` walls turning right each time. The live preview should show `B` immediately to the east of `A`, sharing the `x=10` edge. Confirm "Shape closed ✓" and submit. In the Floorplan tab, confirm `B`'s polygon is `[[10,0],[20,0],[20,10],[10,10]]` (check via the room list or `GET /api/rooms`) and that it renders flush against `A`'s east wall with no gap or overlap.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RoomBuilder.tsx frontend/src/App.css
git commit -m "Add anchor-to-existing-room placement to the room builder"
```

---

### Task 5: Wire up editing an existing room

**Files:**
- Modify: `frontend/src/components/RoomBuilder.tsx`
- Modify: `frontend/src/components/RoomEditor.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: Task 4's `RoomBuilder.tsx`; `api.rooms.update` from `../api`.
- Produces: `RoomBuilder({ allRooms, editingRoom?: Room | null, onSaved, onCancel? })` — extended signature. `RoomEditor.tsx` gains an Edit button per row.

- [ ] **Step 1: Add CSS for the form actions row**

`.form-actions` already exists in `frontend/src/App.css` (used by `FloorplanView.tsx`'s `AddPointForm`) — no new CSS needed.

- [ ] **Step 2: Add the initial-state resolver and edit-mode props to `RoomBuilder.tsx`**

In `frontend/src/components/RoomBuilder.tsx`, add this function above the `RoomBuilder` component (after `roomWalls`):

```tsx
interface FormState {
  name: string;
  floor: string;
  placementMode: 'fresh' | 'anchor';
  start: StartPoint;
  anchorRoomId: number | '';
  anchorWallIndex: number;
  anchorCorner: 'start' | 'end';
  anchorOffsetIn: string;
  anchorHeadingDeg: number;
  walls: Wall[];
  staleAnchorNotice: boolean;
}

function initialFormState(editingRoom: Room | null, allRooms: Room[]): FormState {
  const base: FormState = {
    name: '',
    floor: 'main',
    placementMode: 'fresh',
    start: { x: 0, y: 0, heading_deg: 0 },
    anchorRoomId: '',
    anchorWallIndex: 0,
    anchorCorner: 'start',
    anchorOffsetIn: '0',
    anchorHeadingDeg: 0,
    walls: [],
    staleAnchorNotice: false,
  };
  if (!editingRoom) return base;
  const source = editingRoom.measurement_source;
  const [fallbackX, fallbackY] = editingRoom.polygon[0] ?? [0, 0];
  if (!source) {
    return { ...base, name: editingRoom.name, floor: editingRoom.floor, start: { x: fallbackX, y: fallbackY, heading_deg: 0 } };
  }
  if (source.start.mode === 'absolute') {
    return {
      ...base,
      name: editingRoom.name,
      floor: editingRoom.floor,
      start: { x: source.start.x, y: source.start.y, heading_deg: source.start.heading_deg },
      walls: source.walls,
    };
  }
  const anchorStillExists = allRooms.some((r) => r.id === source.start.anchor_room_id);
  if (!anchorStillExists) {
    return {
      ...base,
      name: editingRoom.name,
      floor: editingRoom.floor,
      start: { x: fallbackX, y: fallbackY, heading_deg: source.start.heading_deg },
      walls: source.walls,
      staleAnchorNotice: true,
    };
  }
  return {
    ...base,
    name: editingRoom.name,
    floor: editingRoom.floor,
    placementMode: 'anchor',
    anchorRoomId: source.start.anchor_room_id,
    anchorWallIndex: source.start.wall_index,
    anchorCorner: source.start.corner,
    anchorOffsetIn: String(source.start.offset_in),
    anchorHeadingDeg: source.start.heading_deg,
    walls: source.walls,
  };
}
```

- [ ] **Step 3: Update the component signature and state initializers**

Replace the `RoomBuilder` function's opening (props line through the `error` state line) with:

```tsx
export function RoomBuilder({
  allRooms,
  editingRoom = null,
  onSaved,
  onCancel,
}: {
  allRooms: Room[];
  editingRoom?: Room | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const initial = initialFormState(editingRoom, allRooms);
  const [name, setName] = useState(initial.name);
  const [floor, setFloor] = useState(initial.floor);
  const [placementMode, setPlacementMode] = useState<'fresh' | 'anchor'>(initial.placementMode);
  const [start, setStart] = useState<StartPoint>(initial.start);
  const [anchorRoomId, setAnchorRoomId] = useState<number | ''>(initial.anchorRoomId);
  const [anchorWallIndex, setAnchorWallIndex] = useState(initial.anchorWallIndex);
  const [anchorCorner, setAnchorCorner] = useState<'start' | 'end'>(initial.anchorCorner);
  const [anchorOffsetIn, setAnchorOffsetIn] = useState(initial.anchorOffsetIn);
  const [anchorHeadingDeg, setAnchorHeadingDeg] = useState(initial.anchorHeadingDeg);
  const [walls, setWalls] = useState<Wall[]>(initial.walls);
  const [draftFeet, setDraftFeet] = useState('');
  const [draftInches, setDraftInches] = useState('');
  const [draftTurn, setDraftTurn] = useState<'left' | 'right' | 'straight' | 'custom'>('right');
  const [draftCustomDeg, setDraftCustomDeg] = useState('');
  const [error, setError] = useState<string | null>(null);
```

(This relies on the caller remounting `RoomBuilder` with a fresh `key` whenever `editingRoom` changes — added to `RoomEditor.tsx` in Step 5 below — so these `useState` initializers only need to run once per edit target, not resync on every render.)

- [ ] **Step 4: Branch the submit handler between create and update**

In the `submit` function, replace the single line `await api.rooms.create({ name, floor, polygon, measurement_source });` (the `const measurement_source = ...` line directly above it is unchanged) with:

```tsx
    if (editingRoom) {
      await api.rooms.update(editingRoom.id, { name, floor, polygon, measurement_source });
    } else {
      await api.rooms.create({ name, floor, polygon, measurement_source });
    }
```

And update the submit button plus add a Cancel button and the stale-anchor notice, replacing the form's closing section (from `{error && <p className="error">{error}</p>}` through the closing `</form>`):

```tsx
        {initial.staleAnchorNotice && (
          <p className="error">Original anchor room was deleted — placement reset to its last known position.</p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="submit" disabled={!closed}>
            {editingRoom ? 'Save room' : 'Create room'}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
```

- [ ] **Step 5: Add editing to `RoomEditor.tsx`**

Replace the full contents of `frontend/src/components/RoomEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Room } from '../types';
import { RoomBuilder } from './RoomBuilder';

export function RoomEditor() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);

  function refresh() {
    api.rooms.list().then(setRooms);
  }

  useEffect(refresh, []);

  async function deleteRoom(id: number) {
    await api.rooms.remove(id);
    if (editingRoom?.id === id) setEditingRoom(null);
    refresh();
  }

  return (
    <div>
      <h2>Rooms</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Floor</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <td>{room.name}</td>
              <td>{room.floor}</td>
              <td>
                <button onClick={() => setEditingRoom(room)}>Edit</button>
                <button onClick={() => deleteRoom(room.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{editingRoom ? `Edit ${editingRoom.name}` : 'Add room'}</h3>
      <RoomBuilder
        key={editingRoom?.id ?? 'new'}
        allRooms={rooms}
        editingRoom={editingRoom}
        onSaved={() => {
          setEditingRoom(null);
          refresh();
        }}
        onCancel={() => setEditingRoom(null)}
      />
    </div>
  );
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 7: Manual verification**

With rooms `A` and `B` from Task 4's check still present: click "Edit" on `A`. Confirm the wizard opens in "anchor"-free "Start fresh" mode with X=0, Y=0, heading east, and all four of its original walls listed, showing "Shape closed ✓" without touching anything. Click "Save room" with just the name unchanged — confirm no new room is created (room count stays the same) and `A` still renders identically in the Floorplan tab.

Now click "Edit" on `B`, confirm it opens in "Attach to existing room" mode with room `A` and Wall 2 pre-selected. Click "Cancel" — confirm the form clears without saving.

Then delete room `A`. Click "Edit" on `B` again: confirm placement falls back to "Start fresh" with X=10, Y=0 (its original computed start point) and the stale-anchor notice is visible. Click "Save room" and confirm `B`'s polygon is unchanged.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/RoomBuilder.tsx frontend/src/components/RoomEditor.tsx
git commit -m "Support editing rooms in the wall-walk wizard"
```
