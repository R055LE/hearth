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
    try {
      await api.rooms.create({ name, floor, polygon, measurement_source });
    } catch (err) {
      setError('Failed to create room: ' + (err instanceof Error ? err.message : String(err)));
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
