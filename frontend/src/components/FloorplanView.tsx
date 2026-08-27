import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { roomContainingPoint } from '../floorplanGeometry';
import type { Circuit, CircuitPoint, Floorplan, Panel, Room } from '../types';

type InteractionMode = 'idle' | 'add' | 'walk' | 'edit' | 'move';
type PointDraft = Omit<CircuitPoint, 'id'>;

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
  onOpenRooms,
}: {
  initialCircuitId?: number;
  initialFloor?: string;
  onOpenRooms: () => void;
}) {
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [floor, setFloor] = useState<string>(initialFloor ?? '');
  const [plan, setPlan] = useState<Floorplan>({ rooms: [], circuit_points: [] });
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [selectedCircuitId, setSelectedCircuitId] = useState<number | null>(initialCircuitId ?? null);
  const [mode, setMode] = useState<InteractionMode>('idle');
  const [draftPoint, setDraftPoint] = useState<PointDraft | null>(null);
  const [walkCircuitId, setWalkCircuitId] = useState<number | ''>('');
  const [walkKind, setWalkKind] = useState('outlet');
  const [walkCreatedIds, setWalkCreatedIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const floors = useMemo(
    () => Array.from(new Set(allRooms.map((r) => r.floor))).sort(),
    [allRooms],
  );

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

  const bounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const room of plan.rooms) {
      for (const [x, y] of room.polygon) {
        xs.push(x);
        ys.push(y);
      }
    }
    for (const point of plan.circuit_points) {
      xs.push(point.x);
      ys.push(point.y);
    }
    if (xs.length === 0) return { minX: 0, minY: 0, width: 100, height: 100 };
    const pad = 5;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(...xs) - minX + pad;
    const height = Math.max(...ys) - minY + pad;
    return { minX, minY, width, height };
  }, [plan]);

  function circuitLabel(circuitId: number): string {
    const circuit = circuits.find((c) => c.id === circuitId);
    if (!circuit) return `circuit #${circuitId}`;
    const panel = panels.find((p) => p.id === circuit.panel_id);
    return `${panel?.name ?? 'unknown panel'} — breaker ${circuit.breaker_label}`;
  }

  function finishInteraction() {
    setMode('idle');
    setDraftPoint(null);
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
    setSelectedCircuitId(circuitId);
    setWalkCircuitId(circuitId);
    setWalkCreatedIds([]);
    setDraftPoint(null);
    setMode('walk');
  }

  function selectPoint(point: CircuitPoint) {
    if (mode !== 'idle') return;
    setSelectedPointId(point.id);
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
    setSelectedCircuitId(null);
    setFloor(nextFloor);
  }

  function handleSvgClick(evt: React.MouseEvent<SVGSVGElement>) {
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
  const selectedCircuit = circuits.find((c) => c.id === selectedCircuitId) ?? null;
  const activeEdit = mode === 'edit' || mode === 'move';

  return (
    <section aria-labelledby="floorplan-heading">
      <h2 id="floorplan-heading">Floorplan</h2>
      <div className={`floorplan-layout${mode === 'walk' ? ' walking' : ''}`}>
        <div className="floorplan-main">
          {error && <p className="error">{error}</p>}
          <div className="floorplan-toolbar">
            <label>
              Floor:{' '}
              <select value={floor} onChange={(e) => handleFloorChange(e.target.value)}>
                {floors.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={startAdd}
              disabled={activeEdit || mode === 'walk' || plan.rooms.length === 0}
            >
              {mode === 'add' ? 'Cancel add point' : 'Add point'}
            </button>
            <button
              onClick={startWalk}
              disabled={activeEdit || mode === 'add' || circuits.length === 0 || plan.rooms.length === 0}
            >
              {mode === 'walk' ? 'Finish circuit walk' : 'Walk circuit'}
            </button>
          </div>

          {plan.rooms.length === 0 ? (
            <div>
              <p>Add a room before placing points on the floorplan.</p>
              <button type="button" onClick={onOpenRooms}>Add a room</button>
            </div>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
              className="floorplan-svg"
              onClick={handleSvgClick}
            >
              <title>{`Floorplan for ${floor}`}</title>
              {plan.rooms.map((room) => {
                const [cx, cy] = centroid(room.polygon);
                const label = roomLabelLayout(room.name, room.polygon);
                const points = room.polygon.map(([x, y]) => `${x},${y}`).join(' ');
                return (
                  <g key={room.id}>
                    <clipPath id={`room-label-clip-${room.id}`}>
                      <polygon points={points} />
                    </clipPath>
                    <polygon points={points} className="room-polygon" />
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
              {plan.circuit_points.map((storedPoint) => {
                const point =
                  activeEdit && storedPoint.id === selectedPointId && draftPoint
                    ? { ...storedPoint, ...draftPoint }
                    : storedPoint;
                const isSelectedPoint = point.id === selectedPointId;
                const isSelectedCircuit = point.circuit_id === selectedCircuitId;
                return (
                  <circle
                    key={point.id}
                    cx={point.x}
                    cy={point.y}
                    r={isSelectedPoint ? 2.2 : 1.5}
                    fill={colorForKind(point.kind)}
                    stroke={isSelectedCircuit ? '#f97316' : 'none'}
                    strokeWidth={0.6}
                    className="point-marker"
                    role="button"
                    tabIndex={0}
                    aria-label={pointAccessibleLabel(point)}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectPoint(point);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      selectPoint(point);
                    }}
                  >
                    <title>{pointAccessibleLabel(point)}</title>
                  </circle>
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
          {draftPoint ? (
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
            <div className="info-card">
              <h3>{selectedPoint.kind}</h3>
              {selectedPoint.label && <p>{selectedPoint.label}</p>}
              <p>Room: {allRooms.find((r) => r.id === selectedPoint.room_id)?.name}</p>
              <p>Circuit: {circuitLabel(selectedPoint.circuit_id)}</p>
              {selectedCircuit?.verified_description && (
                <p>Confirmed: {selectedCircuit.verified_description}</p>
              )}
              {selectedCircuit?.panel_sticker_text && (
                <p>Panel says: {selectedCircuit.panel_sticker_text}</p>
              )}
              <div className="form-actions">
                <button type="button" onClick={() => beginEdit(false)}>Edit point</button>
                <button type="button" onClick={() => beginEdit(true)}>Move point</button>
                <button type="button" onClick={deleteSelectedPoint}>Delete point</button>
              </div>
            </div>
          ) : mode === 'add' ? (
            <p>Click the floorplan to choose a location for the new point.</p>
          ) : mode !== 'walk' ? (
            <p>Click a point on the floorplan, or a circuit below, to see details.</p>
          ) : null}

          {mode === 'walk' && (
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

          {mode !== 'walk' && (
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
