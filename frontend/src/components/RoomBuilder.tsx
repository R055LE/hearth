import { useEffect, useId, useMemo, useState, useImperativeHandle, useRef } from 'react';
import { api } from '../api';
import { closureGapFt, wallsToPolygon, wallsToVertices, resolveMeasurementStart, wallDraftError } from '../wallWalk';
import type { StartPoint, Turn, Wall } from '../wallWalk';
import { polygonError, previewRoomPoints } from '../floorplanGeometry';
import type { CircuitPoint, Floor, MeasurementSource, Point, Room } from '../types';

export interface WallEditorHandle {
  save: () => Promise<boolean>;
  cancel: () => void;
  requestLeave: (proceed: () => void) => void;
}
export interface WallPreview { polygon: Point[]; points: CircuitPoint[] }
export type GeometryGuard = React.MutableRefObject<((proceed: () => void) => void) | null>;

function sourceProblem(room: Room | null, rooms: Room[]): string | null {
  if (!room) return null;
  const source = room.measurement_source;
  if (!source) return 'This room has no saved measurements. The saved outline is authoritative. Re-measure to replace it.';
  const start = resolveMeasurementStart(source, rooms, room.floor, room.id);
  if (!start) return 'The saved anchor is missing or invalid. Choose a valid attachment or absolute placement before saving.';
  const polygon = wallsToPolygon(start, source.walls);
  if (wallDraftError(start, source.walls) || polygonError(polygon) || polygon.length !== room.polygon.length || polygon.some((p, i) => p.some((n, axis) => Math.abs(n - room.polygon[i][axis]) > 1e-9))) return 'Saved measurements or the anchor no longer match the saved outline. Review a replacement draft before saving.';
  return null;
}

const HEADINGS: { label: string; direction: string; deg: number }[] = [
  { label: '↑', direction: 'up', deg: 270 },
  { label: '↓', direction: 'down', deg: 90 },
  { label: '←', direction: 'left', deg: 180 },
  { label: '→', direction: 'right', deg: 0 },
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
  shapeMode: 'rectangle' | 'walls';
  placementMode: 'fresh' | 'anchor';
  start: StartPoint;
  anchorRoomId: number | '';
  anchorWallIndex: number;
  anchorCorner: 'start' | 'end';
  anchorOffsetIn: string;
  anchorHeadingDeg: number;
  walls: Wall[];
}

function initialFormState(editingRoom: Room | null, floors: Floor[], initialFloor?: string | null): FormState {
  const base: FormState = {
    name: '',
    floor: floors.find((item) => item.name === initialFloor)?.name ?? floors[0]?.name ?? '',
    // Rectangle entry is the common path for new rooms; editing always walks walls because
    // the shape is already fixed and must not be silently re-derived from length × width.
    shapeMode: editingRoom ? 'walls' : 'rectangle',
    placementMode: 'fresh',
    start: { x: 0, y: 0, heading_deg: 0 },
    anchorRoomId: '',
    anchorWallIndex: 0,
    anchorCorner: 'start',
    anchorOffsetIn: '0',
    anchorHeadingDeg: 0,
    walls: [],
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
  return {
    ...base,
    name: editingRoom.name,
    floor: editingRoom.floor,
    placementMode: 'anchor',
    start: { x: fallbackX, y: fallbackY, heading_deg: anchorStart.heading_deg },
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
  floors,
  initialFloor,
  editingRoom = null,
  onSaved,
  onCancel,
  editorRef,
  onPreview,
  embedded = false,
  navigationGuard,
}: {
  allRooms: Room[];
  floors: Floor[];
  initialFloor?: string | null;
  editingRoom?: Room | null;
  onSaved: (room: Room) => void | Promise<void>;
  editorRef?: React.Ref<WallEditorHandle>;
  onPreview?: (preview: WallPreview | null) => void;
  embedded?: boolean;
  navigationGuard?: GeometryGuard;
  onCancel?: () => void;
}) {
  const formId = useId();
  const initial = initialFormState(editingRoom, floors, initialFloor);
  const [name, setName] = useState(initial.name);
  const [floor, setFloor] = useState(initial.floor);
  const [shapeMode, setShapeMode] = useState<'rectangle' | 'walls'>(initial.shapeMode);
  const [rectLengthFt, setRectLengthFt] = useState('');
  const [rectWidthFt, setRectWidthFt] = useState('');
  const [placementMode, setPlacementMode] = useState<'fresh' | 'anchor'>(initial.placementMode);
  const [start, setStart] = useState<StartPoint>(initial.start);
  const [anchorRoomId, setAnchorRoomId] = useState<number | ''>(initial.anchorRoomId);
  const [anchorWallIndex, setAnchorWallIndex] = useState(initial.anchorWallIndex);
  const [anchorCorner, setAnchorCorner] = useState<'start' | 'end'>(initial.anchorCorner);
  const [anchorOffsetIn, setAnchorOffsetIn] = useState(initial.anchorOffsetIn);
  const [anchorHeadingDeg, setAnchorHeadingDeg] = useState(initial.anchorHeadingDeg);
  const [walkedWalls, setWalkedWalls] = useState<Wall[]>(initial.walls);
  const [draftFeet, setDraftFeet] = useState('');
  const [draftInches, setDraftInches] = useState('');
  const [draftTurn, setDraftTurn] = useState<'left' | 'right' | 'straight' | 'custom'>('right');
  const [draftCustomDeg, setDraftCustomDeg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<CircuitPoint[]>([]);
  const [pointLoadAttempt, setPointLoadAttempt] = useState(0);
  const [loadingPoints, setLoadingPoints] = useState(Boolean(editingRoom));
  const [pointsLoaded, setPointsLoaded] = useState(!editingRoom);
  const [problem] = useState(() => sourceProblem(editingRoom, allRooms));
  const [recovering, setRecovering] = useState(!problem);
  const [placementConfirmed, setPlacementConfirmed] = useState(!problem || editingRoom?.measurement_source?.start.mode !== 'anchor');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [destination, setDestination] = useState<(() => void) | null>(null);
  const leaveRef = useRef<HTMLDivElement>(null);
  const leaveFocus = useRef<HTMLElement | null>(null);
  const editorContainer = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const circuitPointCount = points.length;
  function requestLeave(proceed: () => void) {
    if (saving) return;
    if (dirty) { leaveFocus.current = document.activeElement as HTMLElement; setDestination(() => proceed); }
    else proceed();
  }
  function dismissLeave() {
    setDestination(null);
    leaveFocus.current?.focus();
  }
  function cancel() {
    if (saving) return;
    if (destination) dismissLeave();
    else onCancel?.();
  }
  useImperativeHandle(editorRef, () => ({ save, requestLeave, cancel }));
  useEffect(() => { if (destination) leaveRef.current?.focus(); }, [destination]);
  useEffect(() => {
    if (!navigationGuard || !editingRoom) return;
    navigationGuard.current = requestLeave;
    return () => { navigationGuard.current = null; };
  });
  useEffect(() => { if (editingRoom) (problem ? editorContainer.current : formRef.current)?.focus(); }, [editingRoom, problem]);

  // Rectangle mode uses the same four-wall representation as the measured path, so saved
  // geometry round-trips through Edit geometry.
  const rectWalls = useMemo<Wall[] | null>(() => {
    const lengthFt = Number(rectLengthFt);
    const widthFt = Number(rectWidthFt);
    if (!Number.isFinite(lengthFt) || !Number.isFinite(widthFt) || lengthFt <= 0 || widthFt <= 0) {
      return null;
    }
    const side = (ft: number): Wall => ({ length_in: ft * 12, turn: 'right' });
    return [side(lengthFt), side(widthFt), side(lengthFt), side(widthFt)];
  }, [rectLengthFt, rectWidthFt]);
  const walls = useMemo<Wall[]>(
    () => (shapeMode === 'rectangle' ? (rectWalls ?? []) : walkedWalls),
    [shapeMode, rectWalls, walkedWalls],
  );

  useEffect(() => {
    if (!editingRoom) return;
    api.floorplan.get(editingRoom.floor).then((fp) => {
      setPoints(fp.circuit_points.filter((p) => p.room_id === editingRoom.id));
      setPointsLoaded(true);
      setError(null);
    }).catch((err) => setError(`Could not load mapped points: ${String(err)}`)).finally(() => setLoadingPoints(false));
  }, [editingRoom, pointLoadAttempt]);

  const roomsOnFloor = useMemo(() => allRooms.filter((r) => r.floor === floor), [allRooms, floor]);
  // Excludes editingRoom itself — anchoring a room to its own previous save would recompute its
  // start point from the polygon each save just wrote, walking the room across the floor.
  const anchorableRooms = useMemo(
    () => roomsOnFloor.filter((r) => r.id !== editingRoom?.id),
    [roomsOnFloor, editingRoom],
  );
  const anchorRoom = useMemo(
    () => anchorableRooms.find((r) => r.id === anchorRoomId) ?? null,
    [anchorableRooms, anchorRoomId],
  );
  const anchorWalls = useMemo(() => (anchorRoom ? roomWalls(anchorRoom) : []), [anchorRoom]);
  // True only when the current anchor selection actually resolves to a real wall on a room
  // that still exists — false if the room was deleted, or the wall index is left over from
  // a different room's wall list after switching the Room dropdown. resolvedStart and submit()
  // both key off this so they never disagree about what "anchored" means.
  const anchorValid =
    placementMode === 'anchor' && anchorRoom !== null && anchorWallIndex >= 0 && anchorWallIndex < anchorWalls.length && Math.hypot(anchorWalls[anchorWallIndex].to[0] - anchorWalls[anchorWallIndex].from[0], anchorWalls[anchorWallIndex].to[1] - anchorWalls[anchorWallIndex].from[1]) > 0;

  const resolvedStart = useMemo<StartPoint>(() => {
    if (!anchorValid || !anchorRoom) return start;
    const wall = anchorWalls[anchorWallIndex];
    const [fromX, fromY] = anchorCorner === 'start' ? wall.from : wall.to;
    const [toX, toY] = anchorCorner === 'start' ? wall.to : wall.from;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const wallLen = Math.hypot(dx, dy) || 1;
    const offsetFt = Number(anchorOffsetIn) / 12;
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
  const polygon = useMemo(() => wallsToPolygon(resolvedStart, walls), [resolvedStart, walls]);
  const geometryError = (!placementConfirmed ? 'Confirm a valid attachment or choose absolute placement.' : null) || wallDraftError(resolvedStart, walls) || polygonError(polygon) ||
    (placementMode === 'anchor' && (!anchorValid || !Number.isFinite(Number(anchorOffsetIn))) ? 'Select a valid anchor room, wall and offset.' : null);
  const closed = !geometryError;
  const pointPreview = useMemo(() => editingRoom && polygon.length >= 3 && !geometryError
    ? previewRoomPoints(editingRoom.polygon, polygon, points) : null, [editingRoom, polygon, points, geometryError]);
  useEffect(() => {
    onPreview?.(recovering && !geometryError ? { polygon, points: pointPreview?.points ?? [] } : null);
  }, [onPreview, recovering, geometryError, polygon, pointPreview]);

  const bounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const room of roomsOnFloor) {
      for (const [x, y] of room.polygon) {
        xs.push(x);
        ys.push(y);
      }
    }
    for (const v of recovering ? vertices : []) {
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
  }, [roomsOnFloor, vertices, recovering]);

  function addWall() {
    const feet = draftFeet === '' ? 0 : Number(draftFeet);
    const inches = draftInches === '' ? 0 : Number(draftInches);
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) {
      setError('Wall length must be a number.');
      return;
    }
    const length_in = feet * 12 + inches;
    if (length_in <= 0) {
      setError('Wall length must be greater than zero.');
      return;
    }
    if (draftTurn === 'custom' && !Number.isFinite(Number(draftCustomDeg))) { setError('Turn must be finite.'); return; }
    const turn: Turn = draftTurn === 'custom' ? { deg: Number(draftCustomDeg) } : draftTurn;
    setDirty(true);
    setWalkedWalls((w) => [...w, { length_in, turn }]);
    setDraftFeet('');
    setDraftInches('');
    setError(null);
  }

  function undoLastWall() {
    setDirty(true);
    setWalkedWalls((w) => w.slice(0, -1));
  }

  function updateWallLength(index: number, part: 'feet' | 'inches', value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    setWalkedWalls((current) =>
      current.map((wall, wallIndex) => {
        if (wallIndex !== index) return wall;
        const feet = Math.floor(wall.length_in / 12);
        const inches = wall.length_in - feet * 12;
        return {
          ...wall,
          length_in: part === 'feet' ? value * 12 + inches : feet * 12 + value,
        };
      }),
    );
  }

  function updateWallTurn(index: number, value: 'left' | 'right' | 'straight' | 'custom') {
    setWalkedWalls((current) =>
      current.map((wall, wallIndex) => {
        if (wallIndex !== index) return wall;
        if (value !== 'custom') return { ...wall, turn: value };
        return { ...wall, turn: typeof wall.turn === 'string' ? { deg: 0 } : wall.turn };
      }),
    );
  }

  function updateCustomTurn(index: number, value: number) {
    if (!Number.isFinite(value)) return;
    setWalkedWalls((current) =>
      current.map((wall, wallIndex) =>
        wallIndex === index ? { ...wall, turn: { deg: value } } : wall,
      ),
    );
  }

  function removeWall(index: number) {
    setDirty(true);
    setWalkedWalls((current) => current.filter((_, wallIndex) => wallIndex !== index));
  }

  async function save(): Promise<boolean> {
    if (saving || !recovering) return false;
    if (geometryError || pointPreview?.outside || !pointsLoaded) {
      setError(geometryError || (pointPreview?.outside ? 'Room shape would leave a mapped circuit point outside the room.' : 'Wait for mapped points to load.'));
      return false;
    }
    const sourceStart: MeasurementSource['start'] =
      anchorValid && anchorRoom
        ? {
            mode: 'anchor',
            anchor_room_id: anchorRoom.id,
            wall_index: anchorWallIndex,
            corner: anchorCorner,
            offset_in: Number(anchorOffsetIn),
            heading_deg: anchorHeadingDeg,
          }
        : { mode: 'absolute', x: start.x, y: start.y, heading_deg: start.heading_deg };
    const measurement_source: MeasurementSource = { unit: 'ft_in', start: sourceStart, walls };
    setSaving(true);
    let saved: Room;
    try {
      saved = editingRoom
        ? await api.rooms.update(editingRoom.id, { polygon, measurement_source })
        : await api.rooms.create({ name, floor, polygon, measurement_source });
    } catch (err) {
      setError(`Failed to ${editingRoom ? 'save' : 'create'} room: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
      return false;
    }
    setError(null);
    setDirty(false);
    setSaving(false);
    await onSaved(saved);
    return true;
  }

  async function saveAndLeave() {
    const proceed = destination;
    if (await save()) { setDestination(null); proceed?.(); }
  }

  return (
    <div ref={editorContainer} tabIndex={-1} className={`room-builder${embedded ? ' embedded' : ''}`} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); cancel(); }
    }}>
      {destination && <div ref={leaveRef} tabIndex={-1} role="alertdialog" aria-label="Unsaved room geometry">
        <p>Save your geometry changes before leaving?</p>
        <div className="form-actions">
          <button type="button" onClick={saveAndLeave} disabled={saving}>Save and continue</button>
          <button type="button" onClick={() => { const proceed = destination; setDestination(null); proceed(); }} disabled={saving}>Discard and continue</button>
          <button type="button" onClick={dismissLeave} disabled={saving}>Stay</button>
        </div>
      </div>}
      {problem && <div className="geometry-recovery">
        <p>{problem}</p>
        {!recovering && <div className="form-actions">
          {editingRoom?.measurement_source && <button type="button" onClick={() => { setRecovering(true); setDirty(true); }}>Review saved measurements as replacement</button>}
          <button type="button" onClick={() => { setWalkedWalls([]); setPlacementMode('fresh'); setPlacementConfirmed(true); setStart({ x: editingRoom?.polygon[0]?.[0] ?? 0, y: editingRoom?.polygon[0]?.[1] ?? 0, heading_deg: 0 }); setRecovering(true); setDirty(true); }}>Re-measure room</button>
        </div>}
      </div>}
      <form ref={formRef} tabIndex={-1} aria-label={editingRoom ? `Edit geometry for ${editingRoom.name}` : 'Create room'} id={formId} className="stacked-form" onChange={() => setDirty(true)} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <fieldset className="geometry-fields" disabled={saving || !recovering} hidden={!recovering}>
        {!editingRoom && <div className="field-grid room-basics">
          <label>
            Name: <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Floor: <select value={floor} onChange={(e) => setFloor(e.target.value)} required>
              {floors.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
          </label>
        </div>}

        {circuitPointCount > 0 && (
          <p>
            This room has {circuitPointCount} circuit point(s). Moving the whole room moves them with it;
            resizing a floorplan-aligned rectangle keeps their relative positions. Other shape changes
            must keep every point inside the room.
          </p>
        )}

        {!editingRoom && (
          <fieldset className="room-shape">
            <legend>Shape</legend>
            <div className="shape-options">
              <label>
                <input
                  type="radio"
                  checked={shapeMode === 'rectangle'}
                  onChange={() => setShapeMode('rectangle')}
                />
                Rectangle (length and width)
              </label>
              <label>
                <input
                  type="radio"
                  checked={shapeMode === 'walls'}
                  onChange={() => setShapeMode('walls')}
                />
                Walk the walls (irregular shapes)
              </label>
            </div>
            {shapeMode === 'rectangle' && (
              <div className="field-grid rectangle-dimensions">
                <label>
                  Length (ft):{' '}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label="Rectangle length in feet"
                    value={rectLengthFt}
                    onChange={(e) => setRectLengthFt(e.target.value)}
                  />
                </label>
                <label>
                  Width (ft):{' '}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label="Rectangle width in feet"
                    value={rectWidthFt}
                    onChange={(e) => setRectWidthFt(e.target.value)}
                  />
                </label>
              </div>
            )}
          </fieldset>
        )}

        <details
          className={`room-placement${editingRoom || shapeMode === 'walls' ? ' required' : ''}`}
          open={editingRoom || shapeMode === 'walls' ? true : undefined}
        >
          <summary>Position and direction (optional)</summary>
          <fieldset onChange={() => setPlacementConfirmed(true)}>
            <legend>Placement</legend>
            <label>
              <input
                type="radio"
                checked={placementMode === 'fresh'}
                onChange={() => setPlacementMode('fresh')}
              />
              Start fresh
            </label>
            {anchorableRooms.length > 0 && (
              <label>
                <input
                  type="radio"
                  checked={placementMode === 'anchor'}
                  onChange={() => setPlacementMode('anchor')}
                />
                Attach to existing room
              </label>
            )}

            {placementMode === 'anchor' && !placementConfirmed && <button type="button" disabled={!anchorValid} onClick={() => { setPlacementConfirmed(true); setDirty(true); }}>Confirm selected attachment</button>}
            {placementMode === 'fresh' ? (
              <>
                <label>
                  X (ft):{' '}
                  <input
                    type="number"
                    step="any"
                    value={start.x}
                    onChange={(e) => setStart((s) => ({ ...s, x: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Y (ft):{' '}
                  <input
                    type="number"
                    step="any"
                    value={start.y}
                    onChange={(e) => setStart((s) => ({ ...s, y: Number(e.target.value) }))}
                  />
                </label>
                <label>First wall heading (degrees): <input type="number" step="any" value={start.heading_deg} onChange={(e) => setStart((s) => ({ ...s, heading_deg: Number(e.target.value) }))} /></label>
                <div className="heading-buttons">
                  {HEADINGS.map((h) => (
                    <button
                      key={h.deg}
                      type="button"
                      className={start.heading_deg === h.deg ? 'active' : ''}
                      aria-label={`First wall direction ${h.direction}`}
                      aria-pressed={start.heading_deg === h.deg}
                      onClick={() => { setDirty(true); setPlacementConfirmed(true); setStart((s) => ({ ...s, heading_deg: h.deg })); }}
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
                    {!anchorRoom && anchorRoomId !== '' && <option value={anchorRoomId} disabled>Invalid saved anchor</option>}
                    <option value="" disabled>
                      Select a room
                    </option>
                    {anchorableRooms.map((r) => (
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
                      {anchorWallIndex >= anchorWalls.length && <option value={anchorWallIndex} disabled>Invalid saved wall</option>}
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
                  <input type="number" step="any" value={anchorOffsetIn} onChange={(e) => setAnchorOffsetIn(e.target.value)} />
                </label>
                <label>First wall heading (degrees): <input type="number" step="any" value={anchorHeadingDeg} onChange={(e) => setAnchorHeadingDeg(Number(e.target.value))} /></label>
                <div className="heading-buttons">
                  {HEADINGS.map((h) => (
                    <button
                      key={h.deg}
                      type="button"
                      className={anchorHeadingDeg === h.deg ? 'active' : ''}
                      aria-label={`First wall direction ${h.direction}`}
                      aria-pressed={anchorHeadingDeg === h.deg}
                      onClick={() => { setDirty(true); setPlacementConfirmed(true); setAnchorHeadingDeg(h.deg); }}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </fieldset>
        </details>

        {shapeMode === 'walls' && (
          <fieldset>
            <legend>Walls</legend>
            <p>
              Start at the placement point and walk the first wall in the chosen direction. After each wall the draft
              turns right by default. Change any turn with its dropdown. The shape closes when the last wall ends back
              where the walk started.
            </p>
          <ul className="wall-list">
            {walls.map((w, i) => (
              <li key={i} className="wall-row">
                <strong>Wall {i + 1}</strong>
                <label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label={`Wall ${i + 1} feet`}
                    value={Math.floor(w.length_in / 12)}
                    onChange={(e) => updateWallLength(i, 'feet', e.target.valueAsNumber)}
                  />{' '}
                  ft
                </label>
                <label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label={`Wall ${i + 1} inches`}
                    value={w.length_in - Math.floor(w.length_in / 12) * 12}
                    onChange={(e) => updateWallLength(i, 'inches', e.target.valueAsNumber)}
                  />{' '}
                  in
                </label>
                <select
                  aria-label={`Wall ${i + 1} turn`}
                  value={typeof w.turn === 'string' ? w.turn : 'custom'}
                  onChange={(e) => updateWallTurn(i, e.target.value as 'left' | 'right' | 'straight' | 'custom')}
                >
                  <option value="left">Turn left</option>
                  <option value="right">Turn right</option>
                  <option value="straight">Straight</option>
                  <option value="custom">Custom angle</option>
                </select>
                {typeof w.turn !== 'string' && (
                  <label>
                    <input
                      type="number"
                      step="any"
                      aria-label={`Wall ${i + 1} custom turn degrees`}
                      value={w.turn.deg}
                      onChange={(e) => updateCustomTurn(i, e.target.valueAsNumber)}
                    />{' '}
                    deg
                  </label>
                )}
                <button className="wall-remove" type="button" onClick={() => removeWall(i)}>
                  Remove wall {i + 1}
                </button>
              </li>
            ))}
          </ul>
          <div className="wall-entry">
            <input
              type="number"
              step="any"
              placeholder="ft"
              aria-label="New wall feet"
              value={draftFeet}
              onChange={(e) => setDraftFeet(e.target.value)}
            />
            <input
              type="number"
              step="any"
              placeholder="in"
              aria-label="New wall inches"
              value={draftInches}
              onChange={(e) => setDraftInches(e.target.value)}
            />
            <select
              aria-label="New wall turn"
              value={draftTurn}
              onChange={(e) => setDraftTurn(e.target.value as typeof draftTurn)}
            >
              <option value="left">Turn left</option>
              <option value="right">Turn right</option>
              <option value="straight">Straight</option>
              <option value="custom">Custom angle</option>
            </select>
            {draftTurn === 'custom' && (
              <input
                type="number"
                step="any"
                placeholder="deg"
                aria-label="New wall custom turn degrees"
                value={draftCustomDeg}
                onChange={(e) => setDraftCustomDeg(e.target.value)}
              />
            )}
          </div>
          <div className="form-actions wall-entry-actions">
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
        )}


        </fieldset>
        {recovering && geometryError && <p role="status">{geometryError}</p>}
        {recovering && pointPreview && <p role={pointPreview.outside ? 'alert' : 'status'}>
          {pointPreview.outside ? 'Room shape would leave a mapped circuit point outside the room.' : pointPreview.policy === 'translation' ? 'Mapped points move with the room.' : pointPreview.policy === 'resize' ? 'Mapped points keep their relative positions in the rectangle.' : 'Mapped points stay at their saved coordinates.'}
        </p>}
        {error && <p className="error" role="alert">{error}</p>}
        {editingRoom && !pointsLoaded && <button type="button" disabled={loadingPoints} onClick={() => { setLoadingPoints(true); setPointLoadAttempt((n) => n + 1); }}>{loadingPoints ? 'Loading mapped points…' : 'Retry loading mapped points'}</button>}
      </form>

      <div className="room-builder-preview">
        {!embedded && <svg viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} className="floorplan-svg">
          {roomsOnFloor.map((room) => (
            <polygon
              key={room.id}
              points={room.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
              className={room.id === anchorRoomId ? 'room-polygon anchor-room' : 'room-polygon'}
            />
          ))}
          {recovering && vertices.length > 1 && (
            <polyline points={vertices.map((v) => `${v.x},${v.y}`).join(' ')} className="draft-room-outline" />
          )}
          {recovering && pointPreview?.points.map((p) => <circle key={p.id} cx={p.x} cy={p.y} r="0.15"><title>{p.label ?? p.kind}</title></circle>)}
        </svg>}
        <div className="form-actions room-builder-actions">
          <button
            type="submit"
            form={formId}
            disabled={!closed || !recovering || saving || !pointsLoaded || Boolean(pointPreview?.outside)}
          >
            {saving ? 'Saving…' : editingRoom ? 'Save room' : 'Create room'}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
