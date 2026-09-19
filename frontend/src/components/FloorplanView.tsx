import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import {
  axisAlignedRectangle,
  mapPointBetweenRectangles,
  rectanglePolygon,
  roomContainingPoint,
  suggestedRectangleOrigin,
} from '../floorplanGeometry';
import type { AxisAlignedRectangle } from '../floorplanGeometry';
import type { Circuit, CircuitPoint, Floorplan, MeasurementSource, Panel, Room } from '../types';

type InteractionMode = 'idle' | 'add' | 'walk' | 'edit' | 'move' | 'room';
type PointDraft = Omit<CircuitPoint, 'id'>;
type RoomDraft = {
  roomId: number | null;
  name: string;
  floor: string;
  length: string;
  width: string;
  x: string;
  y: string;
};

function rectangleFromDraft(draft: RoomDraft): AxisAlignedRectangle | null {
  const rectangle = {
    x: Number(draft.x),
    y: Number(draft.y),
    length: Number(draft.length),
    width: Number(draft.width),
  };
  return Object.values(rectangle).every(Number.isFinite) && rectangle.length > 0 && rectangle.width > 0
    ? rectangle
    : null;
}

function rectangleMeasurement(rectangle: AxisAlignedRectangle): MeasurementSource {
  const side = (feet: number) => ({ length_in: feet * 12, turn: 'right' as const });
  return {
    unit: 'ft_in',
    start: { mode: 'absolute', x: rectangle.x, y: rectangle.y, heading_deg: 0 },
    walls: [side(rectangle.length), side(rectangle.width), side(rectangle.length), side(rectangle.width)],
  };
}

function getSvgPoint(svg: SVGSVGElement, evt: React.MouseEvent): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: Math.round(transformed.x * 10) / 10, y: Math.round(transformed.y * 10) / 10 };
}

function centroid(polygon: [number, number][]): [number, number] {
  const n = polygon.length || 1;
  const [sx, sy] = polygon.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / n, sy / n];
}

function splitRoomLabel(words: string[], lineCount: number): string[] {
  const lines: string[] = [];
  let wordIndex = 0;

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    if (lineIndex === lineCount - 1) {
      lines.push(words.slice(wordIndex).join(' '));
      break;
    }

    const linesLeft = lineCount - lineIndex;
    const targetLength = words.slice(wordIndex).join(' ').length / linesLeft;
    const lastWordIndex = words.length - (linesLeft - 1);
    let line = words[wordIndex];
    wordIndex += 1;

    while (wordIndex < lastWordIndex) {
      const candidate = `${line} ${words[wordIndex]}`;
      if (
        Math.abs(candidate.length - targetLength) > Math.abs(line.length - targetLength)
      ) {
        break;
      }
      line = candidate;
      wordIndex += 1;
    }
    lines.push(line);
  }

  return lines;
}

function roomLabelLayout(name: string, polygon: [number, number][]) {
  const words = name.trim().split(/\s+/);
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  let best = { lines: [name], fontSize: 0 };

  for (let lineCount = 1; lineCount <= Math.min(6, words.length); lineCount += 1) {
    const lines = splitRoomLabel(words, lineCount);
    const longestLine = Math.max(...lines.map((line) => line.length));
    const fontSize = Math.min(
      3,
      (width * 0.9) / (longestLine * 0.6),
      (height * 0.8) / (lineCount * 1.1),
    );
    if (fontSize > best.fontSize) best = { lines, fontSize };
  }

  return { ...best, lineHeight: best.fontSize * 1.1 };
}

const KIND_COLORS: Record<string, string> = {
  outlet: '#2563eb',
  switch: '#7c3aed',
  light: '#d97706',
  appliance: '#059669',
  smoke_detector: '#dc2626',
};

function colorForKind(kind: string): string {
  return KIND_COLORS[kind] ?? '#6b7280';
}

function pointAccessibleLabel(point: CircuitPoint): string {
  return `${point.kind}: ${point.label ?? `point ${point.id}`}`;
}

export function FloorplanView({
  initialCircuitId,
  initialFloor,
  initialWalking = false,
  onOpenRooms,
}: {
  initialCircuitId?: number;
  initialFloor?: string;
  initialWalking?: boolean;
  onOpenRooms: () => void;
}) {
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [floor, setFloor] = useState<string>(initialFloor ?? '');
  const [plan, setPlan] = useState<Floorplan>({ rooms: [], circuit_points: [] });
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [selectedCircuitId, setSelectedCircuitId] = useState<number | null>(initialCircuitId ?? null);
  const [mode, setMode] = useState<InteractionMode>(initialWalking ? 'walk' : 'idle');
  const [draftPoint, setDraftPoint] = useState<PointDraft | null>(null);
  const [roomDraft, setRoomDraft] = useState<RoomDraft | null>(null);
  const [walkCircuitId, setWalkCircuitId] = useState<number | ''>(initialWalking ? initialCircuitId ?? '' : '');
  const [walkKind, setWalkKind] = useState('outlet');
  const [walkCreatedIds, setWalkCreatedIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointDetailsRef = useRef<HTMLDivElement>(null);

  function revealPointDetails() {
    if (!window.matchMedia('(max-width: 700px)').matches) return;
    pointDetailsRef.current?.focus({ preventScroll: true });
    pointDetailsRef.current?.scrollIntoView({ block: 'start' });
  }

  useEffect(() => {
    if (mode === 'idle' && selectedPointId !== null) revealPointDetails();
    if (mode === 'move' && window.matchMedia('(max-width: 700px)').matches) returnToPoint(selectedPointId);
  }, [mode, selectedPointId]);

  function returnToPoint(pointId: number | null) {
    const marker = svgRef.current?.querySelector<SVGCircleElement>(
      `[data-point-id="${pointId}"]`,
    );
    marker?.focus({ preventScroll: true });
    marker?.scrollIntoView({ block: 'center' });
  }

  const floors = useMemo(() => {
    const names = new Set(allRooms.map((room) => room.floor));
    if (floor) names.add(floor);
    if (names.size === 0) names.add('main');
    return Array.from(names).sort();
  }, [allRooms, floor]);

  useEffect(() => {
    Promise.all([api.rooms.list(), api.panels.list(), api.circuits.list()])
      .then(([rooms, panelList, circuitList]) => {
        setAllRooms(rooms);
        setPanels(panelList);
        setCircuits(circuitList);
        setError(null);
        if (!floor && rooms.length > 0) setFloor(rooms[0].floor);
      })
      .catch((err) => setError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!floor) return;
    api.floorplan
      .get(floor)
      .then((floorplan) => {
        setPlan(floorplan);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }, [floor]);

  const draftRectangle = roomDraft ? rectangleFromDraft(roomDraft) : null;
  const draftPolygon = draftRectangle ? rectanglePolygon(draftRectangle) : null;
  const displayedRooms = roomDraft
    ? allRooms.filter((room) => room.floor === roomDraft.floor)
    : plan.rooms;
  const editedRoom = roomDraft?.roomId == null
    ? null
    : allRooms.find((room) => room.id === roomDraft.roomId) ?? null;
  const editedRectangle = editedRoom ? axisAlignedRectangle(editedRoom.polygon) : null;
  const displayedRoomIds = new Set(displayedRooms.map((room) => room.id));
  const pointsOnDisplayedFloor = plan.circuit_points.filter((point) =>
    displayedRoomIds.has(point.room_id),
  );
  const displayedPoints = editedRoom && editedRectangle && draftRectangle
    ? pointsOnDisplayedFloor.map((point) => {
        if (point.room_id !== editedRoom.id) return point;
        const [x, y] = mapPointBetweenRectangles(
          [point.x, point.y],
          editedRectangle,
          draftRectangle,
        );
        return { ...point, x, y };
      })
    : pointsOnDisplayedFloor;

  const bounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const room of displayedRooms) {
      for (const [x, y] of room.polygon) {
        xs.push(x);
        ys.push(y);
      }
    }
    for (const [x, y] of draftPolygon ?? []) {
      xs.push(x);
      ys.push(y);
    }
    for (const point of displayedPoints) {
      xs.push(point.x);
      ys.push(point.y);
    }
    if (xs.length === 0) return { minX: 0, minY: 0, width: 100, height: 100 };
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const pad = Math.max(1, span * 0.05);
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(...xs) - minX + pad;
    const height = Math.max(...ys) - minY + pad;
    return { minX, minY, width, height };
  }, [displayedRooms, displayedPoints, draftPolygon]);

  function circuitLabel(circuitId: number): string {
    const circuit = circuits.find((c) => c.id === circuitId);
    if (!circuit) return `circuit #${circuitId}`;
    const panel = panels.find((p) => p.id === circuit.panel_id);
    return `${panel?.name ?? 'unknown panel'} — breaker ${circuit.breaker_label}`;
  }

  function finishInteraction() {
    setMode('idle');
    setDraftPoint(null);
    setRoomDraft(null);
  }

  function finishWalk() {
    if (walkCircuitId !== '') setSelectedCircuitId(walkCircuitId);
    setWalkCreatedIds([]);
    finishInteraction();
  }

  function startAdd() {
    if (plan.rooms.length === 0) return;
    if (mode === 'add') {
      finishInteraction();
      return;
    }
    setSelectedPointId(null);
    setSelectedRoomId(null);
    setDraftPoint(null);
    setMode('add');
  }

  function startWalk() {
    if (mode === 'walk') {
      finishWalk();
      return;
    }
    const circuitId = selectedCircuitId ?? circuits[0]?.id;
    if (circuitId == null) return;
    setSelectedPointId(null);
    setSelectedRoomId(null);
    setSelectedCircuitId(circuitId);
    setWalkCircuitId(circuitId);
    setWalkCreatedIds([]);
    setDraftPoint(null);
    setMode('walk');
  }

  function selectPoint(point: CircuitPoint) {
    if (mode !== 'idle') return;
    if (selectedPointId === point.id) revealPointDetails();
    setSelectedPointId(point.id);
    setSelectedRoomId(null);
    setSelectedCircuitId(point.circuit_id);
    setDraftPoint(null);
  }

  function beginEdit(move: boolean) {
    const point = plan.circuit_points.find((candidate) => candidate.id === selectedPointId);
    if (!point) return;
    const { id: _id, ...draft } = point;
    setDraftPoint(draft);
    setMode(move ? 'move' : 'edit');
  }

  function handleFloorChange(nextFloor: string) {
    if (mode === 'walk') setWalkCreatedIds([]);
    finishInteraction();
    setSelectedPointId(null);
    setSelectedRoomId(null);
    setSelectedCircuitId(null);
    setFloor(nextFloor);
  }

  function startRoomCreate() {
    const roomFloor = floor || allRooms[0]?.floor || 'main';
    const [x, y] = suggestedRectangleOrigin(
      allRooms.filter((room) => room.floor === roomFloor),
    );
    setRoomDraft({
      roomId: null,
      name: '',
      floor: roomFloor,
      length: '10',
      width: '10',
      x: String(x),
      y: String(y),
    });
    setFloor(roomFloor);
    setSelectedPointId(null);
    setSelectedRoomId(null);
    setDraftPoint(null);
    setMode('room');
    setError(null);
  }

  function selectRoom(room: Room) {
    if (mode !== 'idle') return;
    setSelectedRoomId(room.id);
    setSelectedPointId(null);
    setDraftPoint(null);
  }

  function startRoomEdit(room: Room) {
    const rectangle = axisAlignedRectangle(room.polygon);
    if (!rectangle) return;
    setRoomDraft({
      roomId: room.id,
      name: room.name,
      floor: room.floor,
      length: String(rectangle.length),
      width: String(rectangle.width),
      x: String(rectangle.x),
      y: String(rectangle.y),
    });
    setSelectedPointId(null);
    setDraftPoint(null);
    setMode('room');
    setError(null);
  }

  function changeRoomDraft(change: Partial<RoomDraft>) {
    if (change.floor != null) setFloor(change.floor);
    setRoomDraft((current) => (current ? { ...current, ...change } : current));
  }

  async function saveRoomDraft() {
    if (!roomDraft) return;
    const rectangle = rectangleFromDraft(roomDraft);
    if (!rectangle || !roomDraft.name.trim() || !roomDraft.floor.trim()) return;
    const payload = {
      name: roomDraft.name,
      floor: roomDraft.floor,
      polygon: rectanglePolygon(rectangle),
      measurement_source: rectangleMeasurement(rectangle),
    };
    setSaving(true);
    let saved: Room;
    try {
      saved = roomDraft.roomId == null
        ? await api.rooms.create(payload)
        : await api.rooms.update(roomDraft.roomId, {
            name: payload.name,
            polygon: payload.polygon,
            measurement_source: payload.measurement_source,
          });
    } catch (err) {
      setError(
        `Failed to ${roomDraft.roomId == null ? 'create' : 'save'} room: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      setSaving(false);
      return;
    }

    const localRooms = [
      ...allRooms.filter((room) => room.id !== saved.id),
      saved,
    ];
    setAllRooms(localRooms);
    setPlan({
      rooms: [
        ...displayedRooms.filter((room) => room.id !== saved.id),
        saved,
      ],
      circuit_points: displayedPoints,
    });
    setFloor(saved.floor);
    setSelectedRoomId(saved.id);
    setRoomDraft(null);
    setMode('idle');
    setError(null);

    try {
      const [rooms, floorplan] = await Promise.all([
        api.rooms.list(),
        api.floorplan.get(saved.floor),
      ]);
      setAllRooms(rooms);
      setPlan(floorplan);
    } catch (err) {
      setError(
        `Room saved, but the floorplan could not refresh: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    setSaving(false);
  }

  function handleSvgClick(evt: React.MouseEvent<SVGSVGElement>) {
    if (roomDraft && svgRef.current) {
      const point = getSvgPoint(svgRef.current, evt);
      changeRoomDraft({ x: String(point.x), y: String(point.y) });
      return;
    }
    if (!svgRef.current || !['add', 'walk', 'move'].includes(mode)) return;
    if ((evt.target as SVGElement).tagName === 'circle') return;

    const point = getSvgPoint(svgRef.current, evt);
    const inferredRoom = roomContainingPoint(plan.rooms, [point.x, point.y]);
    if (mode === 'move') {
      setDraftPoint((current) =>
        current
          ? { ...current, ...point, room_id: inferredRoom?.id ?? current.room_id }
          : current,
      );
      return;
    }

    setDraftPoint((current) => {
      const roomId = inferredRoom?.id ?? current?.room_id ?? plan.rooms[0]?.id;
      const circuitId =
        mode === 'walk'
          ? walkCircuitId
          : current?.circuit_id ?? selectedCircuitId ?? circuits[0]?.id;
      if (roomId == null || circuitId === '' || circuitId == null) return current;
      return {
        room_id: roomId,
        circuit_id: circuitId,
        kind: mode === 'walk' ? walkKind : current?.kind ?? 'outlet',
        x: point.x,
        y: point.y,
        label: current?.label ?? null,
      };
    });
  }

  function changeDraft(change: Partial<PointDraft>) {
    setDraftPoint((current) => (current ? { ...current, ...change } : current));
  }

  async function saveDraft() {
    if (!draftPoint) return;
    setSaving(true);
    try {
      if (mode === 'edit' || mode === 'move') {
        if (selectedPointId == null) return;
        const saved = await api.circuitPoints.update(selectedPointId, draftPoint);
        setPlan((current) => ({
          ...current,
          circuit_points: current.circuit_points.map((point) =>
            point.id === saved.id ? saved : point,
          ),
        }));
        setSelectedCircuitId(saved.circuit_id);
        finishInteraction();
      } else {
        const saved = await api.circuitPoints.create(draftPoint);
        setPlan((current) => ({
          ...current,
          circuit_points: [...current.circuit_points, saved],
        }));
        if (mode === 'walk') {
          setWalkCreatedIds((ids) => [...ids, saved.id]);
          setDraftPoint(null);
        } else {
          setSelectedPointId(saved.id);
          setSelectedCircuitId(saved.circuit_id);
          finishInteraction();
        }
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function undoLastWalkPoint() {
    const pointId = walkCreatedIds.at(-1);
    if (pointId == null) return;
    try {
      await api.circuitPoints.remove(pointId);
      setPlan((current) => ({
        ...current,
        circuit_points: current.circuit_points.filter((point) => point.id !== pointId),
      }));
      setWalkCreatedIds((ids) => ids.slice(0, -1));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteSelectedPoint() {
    if (selectedPointId == null) return;
    if (!window.confirm('Delete this point? This cannot be undone.')) return;
    try {
      await api.circuitPoints.remove(selectedPointId);
      setPlan((current) => ({
        ...current,
        circuit_points: current.circuit_points.filter((point) => point.id !== selectedPointId),
      }));
      setSelectedPointId(null);
      setSelectedCircuitId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const selectedPoint = plan.circuit_points.find((p) => p.id === selectedPointId) ?? null;
  const selectedRoom = allRooms.find((room) => room.id === selectedRoomId) ?? null;
  const selectedCircuit = circuits.find((c) => c.id === selectedCircuitId) ?? null;
  const activeEdit = mode === 'edit' || mode === 'move';
  const markerRadius = Math.max(bounds.width, bounds.height) * 0.018;

  return (
    <section aria-labelledby="floorplan-heading">
      <h2 id="floorplan-heading">Floorplan</h2>
      <div
        className={`floorplan-layout${mode === 'walk' ? ' walking' : ''}${
          mode === 'room' ? ' room-authoring' : ''
        }`}
      >
        <div className="floorplan-main">
          {error && <p className="error">{error}</p>}
          <div className="floorplan-toolbar">
            <label>
              Floor:{' '}
              <select
                value={floor || floors[0]}
                onChange={(e) => handleFloorChange(e.target.value)}
                disabled={mode === 'room'}
              >
                {floors.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={startRoomCreate} disabled={mode !== 'idle'}>
              Add room
            </button>
            <button
              onClick={startAdd}
              disabled={activeEdit || mode === 'walk' || mode === 'room' || plan.rooms.length === 0}
            >
              {mode === 'add' ? 'Cancel add point' : 'Add point'}
            </button>
            <button
              onClick={startWalk}
              disabled={activeEdit || mode === 'add' || mode === 'room' || circuits.length === 0 || plan.rooms.length === 0}
            >
              {mode === 'walk' ? 'Finish circuit walk' : 'Walk circuit'}
            </button>
          </div>

          {displayedRooms.length === 0 && !roomDraft ? (
            <div>
              {selectedCircuit ? (
                <>
                  <p>Add a room before mapping {circuitLabel(selectedCircuit.id)}.</p>
                  <p>Then return to this breaker and choose Map breaker.</p>
                </>
              ) : (
                <p>Add a room before placing points on the floorplan.</p>
              )}
              <button type="button" onClick={startRoomCreate}>Add a rectangular room</button>{' '}
              <button type="button" onClick={onOpenRooms}>Add a measured or irregular room</button>
            </div>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
              className="floorplan-svg"
              onClick={handleSvgClick}
            >
              <title>{`Floorplan for ${floor}`}</title>
              {displayedRooms.map((room) => {
                const [cx, cy] = centroid(room.polygon);
                const label = roomLabelLayout(room.name, room.polygon);
                const points = room.polygon.map(([x, y]) => `${x},${y}`).join(' ');
                const isSelected = room.id === selectedRoomId;
                return (
                  <g
                    key={room.id}
                    role="button"
                    tabIndex={mode === 'idle' ? 0 : -1}
                    aria-label={`Room: ${room.name}`}
                    aria-pressed={isSelected}
                    onClick={(event) => {
                      if (mode !== 'idle') return;
                      event.stopPropagation();
                      selectRoom(room);
                    }}
                    onKeyDown={(event) => {
                      if (mode !== 'idle' || (event.key !== 'Enter' && event.key !== ' ')) return;
                      event.preventDefault();
                      selectRoom(room);
                    }}
                  >
                    <clipPath id={`room-label-clip-${room.id}`}>
                      <polygon points={points} />
                    </clipPath>
                    <polygon
                      points={points}
                      className={`room-polygon${isSelected ? ' selected-room' : ''}`}
                    />
                    <text
                      className="room-label"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      clipPath={`url(#room-label-clip-${room.id})`}
                      style={{ fontSize: label.fontSize }}
                    >
                      {label.lines.map((line, index) => (
                        <tspan
                          key={`${line}-${index}`}
                          x={cx}
                          y={cy + (index - (label.lines.length - 1) / 2) * label.lineHeight}
                        >
                          {line}{index < label.lines.length - 1 ? ' ' : ''}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              })}
              {draftPolygon && (
                <polygon
                  points={draftPolygon.map(([x, y]) => `${x},${y}`).join(' ')}
                  className="draft-room-polygon"
                  strokeWidth={2}
                  strokeDasharray="8 6"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
              {displayedPoints.map((storedPoint) => {
                const point =
                  activeEdit && storedPoint.id === selectedPointId && draftPoint
                    ? { ...storedPoint, ...draftPoint }
                    : storedPoint;
                const isSelectedPoint = point.id === selectedPointId;
                const isSelectedCircuit = point.circuit_id === selectedCircuitId;
                return (
                  <Fragment key={point.id}>
                    <circle
                      data-point-id={point.id}
                      cx={point.x}
                      cy={point.y}
                      r={markerRadius}
                      fill="transparent"
                      stroke="transparent"
                      strokeWidth={32}
                      vectorEffect="non-scaling-stroke"
                      className="point-marker"
                      role="button"
                      tabIndex={mode === 'room' ? -1 : 0}
                      aria-pressed={isSelectedPoint}
                      aria-label={pointAccessibleLabel(point)}
                      onClick={(e) => {
                        if (mode === 'room') return;
                        e.stopPropagation();
                        selectPoint(point);
                      }}
                      onKeyDown={(e) => {
                        if (mode === 'room' || (e.key !== 'Enter' && e.key !== ' ')) return;
                        e.preventDefault();
                        selectPoint(point);
                      }}
                    >
                      <title>{pointAccessibleLabel(point)}</title>
                    </circle>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={markerRadius}
                      fill={colorForKind(point.kind)}
                      stroke={isSelectedCircuit ? '#f97316' : '#fff'}
                      strokeWidth={isSelectedPoint ? 3 : 2}
                      vectorEffect="non-scaling-stroke"
                      className="point-symbol"
                      pointerEvents="none"
                    />
                  </Fragment>
                );
              })}
              {draftPoint && !activeEdit && (
                <circle
                  cx={draftPoint.x}
                  cy={draftPoint.y}
                  r={2}
                  fill="none"
                  stroke="#f97316"
                  strokeWidth={0.5}
                  pointerEvents="none"
                />
              )}
            </svg>
          )}
        </div>

        <div className={`floorplan-sidebar${mode === 'walk' ? ' walk-sidebar' : ''}`}>
          {roomDraft ? (
            <RoomDraftForm
              draft={roomDraft}
              saving={saving}
              onChange={changeRoomDraft}
              onCancel={finishInteraction}
              onSubmit={saveRoomDraft}
            />
          ) : draftPoint ? (
            <PointForm
              point={draftPoint}
              rooms={plan.rooms}
              circuits={circuits}
              panels={panels}
              title={activeEdit ? 'Edit point' : mode === 'walk' ? 'Next point' : 'Add point'}
              submitLabel={activeEdit ? 'Save point' : mode === 'walk' ? 'Add point' : 'Create'}
              showCircuitAndKind={mode !== 'walk'}
              moveMode={mode === 'move'}
              saving={saving}
              onPointChange={changeDraft}
              onMove={() => setMode('move')}
              onCancel={() => {
                if (mode === 'walk') setDraftPoint(null);
                else finishInteraction();
              }}
              onSubmit={saveDraft}
            />
          ) : selectedPoint && mode === 'idle' ? (
            <div
              className="info-card point-details"
              ref={pointDetailsRef}
              role="region"
              aria-label="Selected point"
              tabIndex={-1}
            >
              <h3>{selectedPoint.kind}</h3>
              <p>Circuit: {circuitLabel(selectedPoint.circuit_id)}</p>
              {selectedPoint.label && <p>{selectedPoint.label}</p>}
              <p>Room: {allRooms.find((r) => r.id === selectedPoint.room_id)?.name}</p>
              {selectedCircuit?.verified_description && (
                <p>Confirmed: {selectedCircuit.verified_description}</p>
              )}
              {selectedCircuit?.panel_sticker_text && (
                <p>Panel says: {selectedCircuit.panel_sticker_text}</p>
              )}
              <div className="form-actions">
                <button className="back-to-map" type="button" onClick={() => returnToPoint(selectedPointId)}>Back to map</button>
                <button type="button" onClick={() => beginEdit(false)}>Edit point</button>
                <button type="button" onClick={() => beginEdit(true)}>Move point</button>
                <button type="button" onClick={deleteSelectedPoint}>Delete point</button>
              </div>
            </div>
          ) : selectedRoom && mode === 'idle' ? (
            <div className="info-card room-details" role="region" aria-label="Selected room">
              <h3>{selectedRoom.name}</h3>
              <p>Floor: {selectedRoom.floor}</p>
              {axisAlignedRectangle(selectedRoom.polygon) ? (
                <button type="button" onClick={() => startRoomEdit(selectedRoom)}>
                  Edit room on map
                </button>
              ) : (
                <>
                  <p>This room uses measured or irregular geometry.</p>
                  <button type="button" onClick={onOpenRooms}>Open geometry editor</button>
                </>
              )}
            </div>
          ) : mode === 'add' ? (
            <p>Click the floorplan to choose a location for the new point.</p>
          ) : mode !== 'walk' ? (
            <p>Select a room or point on the floorplan, or a circuit below, to see details.</p>
          ) : null}

          {mode === 'walk' && plan.rooms.length > 0 && (
            <div className="info-card walk-controls">
              <h3>Circuit walk</h3>
              <label>
                Circuit:{' '}
                <select
                  value={walkCircuitId}
                  onChange={(e) => {
                    const circuitId = Number(e.target.value);
                    setWalkCircuitId(circuitId);
                    setSelectedCircuitId(circuitId);
                    changeDraft({ circuit_id: circuitId });
                  }}
                >
                  {circuits.map((circuit) => (
                    <option key={circuit.id} value={circuit.id}>
                      {circuitLabel(circuit.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kind:{' '}
                <input
                  value={walkKind}
                  onChange={(e) => {
                    setWalkKind(e.target.value);
                    changeDraft({ kind: e.target.value });
                  }}
                  list="circuit-walk-kind-options"
                />
                <KindOptions id="circuit-walk-kind-options" />
              </label>
              <p aria-live="polite">
                {walkCreatedIds.length} {walkCreatedIds.length === 1 ? 'point' : 'points'} added this walk.
              </p>
              {!draftPoint && <p>Tap the floorplan to place the next point.</p>}
              <div className="form-actions">
                <button type="button" onClick={undoLastWalkPoint} disabled={walkCreatedIds.length === 0}>
                  Undo last point
                </button>
                <button type="button" onClick={finishWalk}>Finish walk</button>
              </div>
            </div>
          )}

          {mode !== 'walk' && mode !== 'room' && (
            <>
              <h3>Circuits</h3>
              <ul className="circuit-list">
                {panels.map((panel) => (
                  <li key={panel.id}>
                    <strong>{panel.name}</strong>
                    <ul>
                      {circuits
                        .filter((c) => c.panel_id === panel.id)
                        .map((circuit) => (
                          <li key={circuit.id}>
                            <button
                              type="button"
                              className={circuit.id === selectedCircuitId ? 'selected' : ''}
                              onClick={() => {
                                setSelectedCircuitId(circuit.id);
                                setSelectedPointId(null);
                              }}
                            >
                              Breaker {circuit.breaker_label}
                              {circuit.verified_description ? ` — ${circuit.verified_description}` : ''}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function RoomDraftForm({
  draft,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: RoomDraft;
  saving: boolean;
  onChange: (change: Partial<RoomDraft>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const rectangle = rectangleFromDraft(draft);
  const valid = rectangle !== null && draft.name.trim() !== '' && draft.floor.trim() !== '';
  return (
    <form
      className="info-card room-draft-form"
      aria-label={draft.roomId == null ? 'Add room' : 'Edit room'}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h3>{draft.roomId == null ? 'Add room' : `Edit ${draft.name}`}</h3>
      <p className="placement-instruction">
        Tap or click the map to place the room. Saved rooms stay visible until Save.
      </p>
      <label>
        Name
        <input
          aria-label="Room name"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          required
        />
      </label>
      <label>
        Floor
        <input
          aria-label="Room floor"
          value={draft.floor}
          onChange={(event) => onChange({ floor: event.target.value })}
          disabled={draft.roomId !== null}
          required
        />
      </label>
      <div className="room-dimensions">
        <label>
          Length (ft)
          <input
            type="number"
            min="0.1"
            step="0.1"
            aria-label="Room length in feet"
            value={draft.length}
            onChange={(event) => onChange({ length: event.target.value })}
            required
          />
        </label>
        <label>
          Width (ft)
          <input
            type="number"
            min="0.1"
            step="0.1"
            aria-label="Room width in feet"
            value={draft.width}
            onChange={(event) => onChange({ width: event.target.value })}
            required
          />
        </label>
      </div>
      <details>
        <summary>Fine position (optional)</summary>
        <div className="room-position">
          <label>
            X (ft)
            <input
              type="number"
              step="0.1"
              aria-label="Room X position in feet"
              value={draft.x}
              onChange={(event) => onChange({ x: event.target.value })}
            />
          </label>
          <label>
            Y (ft)
            <input
              type="number"
              step="0.1"
              aria-label="Room Y position in feet"
              value={draft.y}
              onChange={(event) => onChange({ y: event.target.value })}
            />
          </label>
        </div>
      </details>
      <div className="form-actions">
        <button type="submit" disabled={!valid || saving}>
          {saving ? 'Saving…' : 'Save room'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

function KindOptions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      <option value="outlet" />
      <option value="switch" />
      <option value="light" />
      <option value="appliance" />
      <option value="smoke_detector" />
    </datalist>
  );
}

function PointForm({
  point,
  rooms,
  circuits,
  panels,
  title,
  submitLabel,
  showCircuitAndKind,
  moveMode,
  saving,
  onPointChange,
  onMove,
  onCancel,
  onSubmit,
}: {
  point: PointDraft;
  rooms: Room[];
  circuits: Circuit[];
  panels: Panel[];
  title: string;
  submitLabel: string;
  showCircuitAndKind: boolean;
  moveMode: boolean;
  saving: boolean;
  onPointChange: (change: Partial<PointDraft>) => void;
  onMove: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form className="info-card point-form" onSubmit={submit}>
      <h3>{title}</h3>
      {moveMode && <p>Tap the floorplan to choose the new location.</p>}
      <label>
        Room:{' '}
        <select value={point.room_id} onChange={(e) => onPointChange({ room_id: Number(e.target.value) })}>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </label>
      {showCircuitAndKind && (
        <>
          <label>
            Circuit:{' '}
            <select
              value={point.circuit_id}
              onChange={(e) => onPointChange({ circuit_id: Number(e.target.value) })}
            >
              {circuits.map((circuit) => (
                <option key={circuit.id} value={circuit.id}>
                  {panels.find((panel) => panel.id === circuit.panel_id)?.name} — breaker {circuit.breaker_label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind:{' '}
            <input
              value={point.kind}
              onChange={(e) => onPointChange({ kind: e.target.value })}
              list="point-kind-options"
            />
            <KindOptions id="point-kind-options" />
          </label>
        </>
      )}
      <label>
        Label:{' '}
        <input value={point.label ?? ''} onChange={(e) => onPointChange({ label: e.target.value || null })} />
      </label>
      <label>
        X:{' '}
        <input
          type="number"
          step="0.1"
          value={point.x}
          onChange={(e) => onPointChange({ x: Number(e.target.value) })}
        />
      </label>
      <label>
        Y:{' '}
        <input
          type="number"
          step="0.1"
          value={point.y}
          onChange={(e) => onPointChange({ y: Number(e.target.value) })}
        />
      </label>
      <div className="form-actions">
        <button type="submit" disabled={saving || rooms.length === 0 || circuits.length === 0}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {showCircuitAndKind && !moveMode && submitLabel === 'Save point' && (
          <button type="button" onClick={onMove}>Move on floorplan</button>
        )}
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
