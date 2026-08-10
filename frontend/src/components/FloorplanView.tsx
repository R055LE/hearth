import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { Circuit, CircuitPoint, Floorplan, Panel, Room } from '../types';

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

export function FloorplanView() {
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [floor, setFloor] = useState<string>('');
  const [plan, setPlan] = useState<Floorplan>({ rooms: [], circuit_points: [] });
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [selectedCircuitId, setSelectedCircuitId] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [draftPoint, setDraftPoint] = useState<{ x: number; y: number } | null>(null);
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

  function refresh() {
    const floorplan = floor ? api.floorplan.get(floor) : Promise.resolve(plan);
    Promise.all([floorplan, api.circuits.list()])
      .then(([nextPlan, circuitList]) => {
        setPlan(nextPlan);
        setCircuits(circuitList);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }

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

  function selectPoint(point: CircuitPoint) {
    setSelectedPointId(point.id);
    setSelectedCircuitId(point.circuit_id);
    setAddMode(false);
    setDraftPoint(null);
  }

  function handleSvgClick(evt: React.MouseEvent<SVGSVGElement>) {
    if (!addMode || !svgRef.current) return;
    if ((evt.target as SVGElement).tagName === 'circle') return;
    setDraftPoint(getSvgPoint(svgRef.current, evt));
  }

  async function deleteSelectedPoint() {
    if (selectedPointId == null) return;
    try {
      await api.circuitPoints.remove(selectedPointId);
      setSelectedPointId(null);
      setSelectedCircuitId(null);
      setError(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const selectedPoint = plan.circuit_points.find((p) => p.id === selectedPointId) ?? null;
  const selectedCircuit = circuits.find((c) => c.id === selectedCircuitId) ?? null;

  return (
    <div className="floorplan-layout">
      <div className="floorplan-main">
        {error && <p className="error">{error}</p>}
        <div className="floorplan-toolbar">
          <label>
            Floor:{' '}
            <select value={floor} onChange={(e) => setFloor(e.target.value)}>
              {floors.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              setAddMode((v) => !v);
              setDraftPoint(null);
            }}
          >
            {addMode ? 'Cancel add point' : 'Add point'}
          </button>
        </div>

        {plan.rooms.length === 0 ? (
          <p>No rooms on this floor yet — add some in the Rooms tab.</p>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
            className="floorplan-svg"
            onClick={handleSvgClick}
          >
            {plan.rooms.map((room) => {
              const [cx, cy] = centroid(room.polygon);
              return (
                <g key={room.id}>
                  <polygon
                    points={room.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
                    className="room-polygon"
                  />
                  <text x={cx} y={cy} className="room-label" textAnchor="middle">
                    {room.name}
                  </text>
                </g>
              );
            })}
            {plan.circuit_points.map((point) => {
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
                  onClick={(e) => {
                    e.stopPropagation();
                    selectPoint(point);
                  }}
                />
              );
            })}
            {draftPoint && (
              <circle cx={draftPoint.x} cy={draftPoint.y} r={2} fill="none" stroke="#f97316" strokeWidth={0.5} />
            )}
          </svg>
        )}
      </div>

      <div className="floorplan-sidebar">
        {draftPoint ? (
          <AddPointForm
            x={draftPoint.x}
            y={draftPoint.y}
            rooms={plan.rooms}
            circuits={circuits}
            panels={panels}
            onCancel={() => setDraftPoint(null)}
            onCreated={() => {
              setDraftPoint(null);
              setAddMode(false);
              refresh();
            }}
          />
        ) : selectedPoint ? (
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
            <button onClick={deleteSelectedPoint}>Delete point</button>
          </div>
        ) : (
          <p>Click a point on the floorplan, or a circuit below, to see details.</p>
        )}

        <h3>Circuits</h3>
        <ul className="circuit-list">
          {panels.map((panel) => (
            <li key={panel.id}>
              <strong>{panel.name}</strong>
              <ul>
                {circuits
                  .filter((c) => c.panel_id === panel.id)
                  .map((circuit) => (
                    <li
                      key={circuit.id}
                      className={circuit.id === selectedCircuitId ? 'selected' : ''}
                      onClick={() => {
                        setSelectedCircuitId(circuit.id);
                        setSelectedPointId(null);
                      }}
                    >
                      Breaker {circuit.breaker_label}
                      {circuit.verified_description ? ` — ${circuit.verified_description}` : ''}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AddPointForm({
  x,
  y,
  rooms,
  circuits,
  panels,
  onCancel,
  onCreated,
}: {
  x: number;
  y: number;
  rooms: Room[];
  circuits: Circuit[];
  panels: Panel[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [roomId, setRoomId] = useState<number | ''>(rooms[0]?.id ?? '');
  const [circuitId, setCircuitId] = useState<number | ''>(circuits[0]?.id ?? '');
  const [kind, setKind] = useState('outlet');
  const [label, setLabel] = useState('');
  const [coords, setCoords] = useState({ x, y });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (roomId === '' || circuitId === '') return;
    try {
      await api.circuitPoints.create({
        room_id: roomId,
        circuit_id: circuitId,
        kind,
        x: coords.x,
        y: coords.y,
        label: label || null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="info-card" onSubmit={submit}>
      <h3>Add point</h3>
      {error && <p className="error">{error}</p>}
      <label>
        Room:{' '}
        <select value={roomId} onChange={(e) => setRoomId(Number(e.target.value))}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Circuit:{' '}
        <select value={circuitId} onChange={(e) => setCircuitId(Number(e.target.value))}>
          {circuits.map((c) => (
            <option key={c.id} value={c.id}>
              {panels.find((p) => p.id === c.panel_id)?.name} — breaker {c.breaker_label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Kind:{' '}
        <input value={kind} onChange={(e) => setKind(e.target.value)} list="kind-options" />
        <datalist id="kind-options">
          <option value="outlet" />
          <option value="switch" />
          <option value="light" />
          <option value="appliance" />
          <option value="smoke_detector" />
        </datalist>
      </label>
      <label>
        Label: <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label>
        X:{' '}
        <input
          type="number"
          value={coords.x}
          onChange={(e) => setCoords((c) => ({ ...c, x: Number(e.target.value) }))}
        />
      </label>
      <label>
        Y:{' '}
        <input
          type="number"
          value={coords.y}
          onChange={(e) => setCoords((c) => ({ ...c, y: Number(e.target.value) }))}
        />
      </label>
      <div className="form-actions">
        <button type="submit" disabled={rooms.length === 0 || circuits.length === 0}>
          Create
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {(rooms.length === 0 || circuits.length === 0) && (
        <p>Need at least one room and one circuit before adding a point.</p>
      )}
    </form>
  );
}
