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
  const anchorStart = source.start;
  const anchorStillExists = allRooms.some((r) => r.id === anchorStart.anchor_room_id);
  if (!anchorStillExists) {
    return {
      ...base,
      name: editingRoom.name,
      floor: editingRoom.floor,
      start: { x: fallbackX, y: fallbackY, heading_deg: anchorStart.heading_deg },
      walls: source.walls,
      staleAnchorNotice: true,
    };
  }
  return {
    ...base,
    name: editingRoom.name,
    floor: editingRoom.floor,
    placementMode: 'anchor',
    anchorRoomId: anchorStart.anchor_room_id,
    anchorWallIndex: anchorStart.wall_index,
    anchorCorner: anchorStart.corner,
    anchorOffsetIn: String(anchorStart.offset_in),
    anchorHeadingDeg: anchorStart.heading_deg,
    walls: source.walls,
  };
}

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

  const roomsOnFloor = useMemo(() => allRooms.filter((r) => r.floor === floor), [allRooms, floor]);
  const anchorRoom = useMemo(
    () => roomsOnFloor.find((r) => r.id === anchorRoomId) ?? null,
    [roomsOnFloor, anchorRoomId],
  );
  const anchorWalls = useMemo(() => (anchorRoom ? roomWalls(anchorRoom) : []), [anchorRoom]);
  // True only when the current anchor selection actually resolves to a real wall on a room
  // that still exists — false if the room was deleted, or the wall index is left over from
  // a different room's wall list after switching the Room dropdown. resolvedStart and submit()
  // both key off this so they never disagree about what "anchored" means.
  const anchorValid =
    placementMode === 'anchor' && anchorRoom !== null && anchorWallIndex < anchorWalls.length;

  const resolvedStart = useMemo<StartPoint>(() => {
    if (!anchorValid || !anchorRoom) return start;
    const wall = anchorWalls[anchorWallIndex];
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
    anchorValid,
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
    if (placementMode === 'anchor' && !anchorValid) {
      setError('Anchor room or wall is no longer valid — reselect a room and wall.');
      return;
    }
    const polygon = wallsToPolygon(resolvedStart, walls);
    const sourceStart: MeasurementSource['start'] =
      anchorValid && anchorRoom
        ? {
            mode: 'anchor',
            anchor_room_id: anchorRoom.id,
            wall_index: anchorWallIndex,
            corner: anchorCorner,
            offset_in: Number(anchorOffsetIn) || 0,
            heading_deg: anchorHeadingDeg,
          }
        : { mode: 'absolute', x: start.x, y: start.y, heading_deg: start.heading_deg };
    const measurement_source: MeasurementSource = { unit: 'ft_in', start: sourceStart, walls };
    try {
      if (editingRoom) {
        await api.rooms.update(editingRoom.id, { name, floor, polygon, measurement_source });
      } else {
        await api.rooms.create({ name, floor, polygon, measurement_source });
      }
    } catch (err) {
      setError(
        `Failed to ${editingRoom ? 'save' : 'create'} room: ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return;
    }
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
