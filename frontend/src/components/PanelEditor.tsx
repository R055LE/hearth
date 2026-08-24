import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Circuit, CircuitPoint, Panel, Room } from '../types';

interface PanelValues {
  name: string;
  room_id: number | null;
  amperage: number | null;
  fed_from_panel_id: number | null;
}

interface CircuitValues {
  breaker_label: string;
  amperage: number | null;
  poles: number;
  panel_sticker_text: string | null;
  verified_description: string | null;
}

export function PanelEditor({
  onViewCircuit,
}: {
  onViewCircuit: (circuitId: number, floor: string) => void;
}) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [circuitPoints, setCircuitPoints] = useState<CircuitPoint[]>([]);
  const [addingPanel, setAddingPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    return Promise.all([
      api.panels.list(),
      api.rooms.list(),
      api.circuits.list(),
      api.circuitPoints.list(),
    ])
      .then(([panelList, roomList, circuitList, pointList]) => {
        setPanels(panelList);
        setRooms(roomList);
        setCircuits(circuitList);
        setCircuitPoints(pointList);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createPanel(values: PanelValues) {
    try {
      await api.panels.create(values);
      setAddingPanel(false);
      setError(null);
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function deletePanel(id: number) {
    if (!window.confirm('Delete this panel? This cannot be undone.')) return;
    try {
      await api.panels.remove(id);
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function viewCircuit(circuitId: number) {
    const point = circuitPoints.find((candidate) => candidate.circuit_id === circuitId);
    const floor = rooms.find((room) => room.id === point?.room_id)?.floor;
    if (floor) onViewCircuit(circuitId, floor);
  }

  return (
    <section aria-labelledby="panels-heading">
      <h2 id="panels-heading">Panels &amp; circuits</h2>
      {error && <p className="error">{error}</p>}
      {panels.map((panel) => (
        <PanelCard
          key={panel.id}
          panel={panel}
          panels={panels}
          rooms={rooms}
          circuits={circuits.filter((circuit) => circuit.panel_id === panel.id)}
          circuitPoints={circuitPoints}
          onViewCircuit={viewCircuit}
          onDeletePanel={() => deletePanel(panel.id)}
          onChange={refresh}
          onError={setError}
        />
      ))}

      <div className="panel-add">
        {addingPanel ? (
          <>
            <h3>Add panel</h3>
            <PanelForm
              ariaLabel="Add panel"
              initial={{ name: '', room_id: null, amperage: null, fed_from_panel_id: null }}
              rooms={rooms}
              upstreamPanels={panels}
              submitLabel="Create panel"
              cancelLabel="Cancel adding panel"
              onSave={createPanel}
              onCancel={() => setAddingPanel(false)}
            />
          </>
        ) : (
          <button type="button" onClick={() => setAddingPanel(true)}>Add panel</button>
        )}
      </div>
    </section>
  );
}

function PanelCard({
  panel,
  panels,
  rooms,
  circuits,
  circuitPoints,
  onViewCircuit,
  onDeletePanel,
  onChange,
  onError,
}: {
  panel: Panel;
  panels: Panel[];
  rooms: Room[];
  circuits: Circuit[];
  circuitPoints: CircuitPoint[];
  onViewCircuit: (circuitId: number) => void;
  onDeletePanel: () => void;
  onChange: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [editingPanel, setEditingPanel] = useState(false);
  const [addingCircuit, setAddingCircuit] = useState(false);
  const room = rooms.find((candidate) => candidate.id === panel.room_id);
  const fedFromName = panels.find((candidate) => candidate.id === panel.fed_from_panel_id)?.name;
  const feedsPanels = panels.filter((candidate) => candidate.fed_from_panel_id === panel.id);
  const upstreamPanels = panels.filter((candidate) => canFeedPanel(candidate, panel.id, panels));
  const sortedCircuits = [...circuits].sort((left, right) =>
    left.breaker_label.localeCompare(right.breaker_label, undefined, { numeric: true }),
  );
  const pointCount = (circuitId: number) =>
    circuitPoints.filter((point) => point.circuit_id === circuitId).length;
  const mappedCircuitCount = circuits.filter((circuit) => pointCount(circuit.id) > 0).length;
  const mappedPointCount = circuits.reduce((total, circuit) => total + pointCount(circuit.id), 0);
  const unverifiedCount = circuits.filter((circuit) => !circuit.verified_description).length;

  async function updatePanel(values: PanelValues) {
    try {
      await api.panels.update(panel.id, values);
      setEditingPanel(false);
      onError(null);
      await onChange();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function createCircuit(values: CircuitValues) {
    try {
      await api.circuits.create({ panel_id: panel.id, ...values });
      setAddingCircuit(false);
      onError(null);
      await onChange();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function updateCircuit(id: number, values: CircuitValues) {
    try {
      await api.circuits.update(id, values);
      onError(null);
      await onChange();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function deleteCircuit(id: number) {
    if (!window.confirm('Delete this circuit? This cannot be undone.')) return;
    try {
      await api.circuits.remove(id);
      onError(null);
      await onChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="panel-card" aria-labelledby={`panel-${panel.id}-heading`}>
      <header className="panel-card-header">
        <div>
          <h3 id={`panel-${panel.id}-heading`}>
            {panel.name}
            {panel.amperage && <span className="panel-amperage"> {panel.amperage}A</span>}
          </h3>
          {!editingPanel && (
            <>
              <p className="panel-location">Location: {room?.name ?? 'not recorded'}</p>
              <p className="panel-feed">
                {fedFromName ? `Fed from ${fedFromName}.` : 'No parent panel recorded.'}
                {feedsPanels.length > 0 &&
                  ` Feeds ${feedsPanels.map((child) => child.name).join(', ')}.`}
              </p>
            </>
          )}
        </div>
        {!editingPanel && (
          <div className="panel-header-actions">
            <button
              type="button"
              aria-label={`Edit panel ${panel.name}`}
              onClick={() => {
                onError(null);
                setEditingPanel(true);
              }}
            >
              Edit panel
            </button>
            <button
              type="button"
              aria-label={`Delete panel ${panel.name}`}
              onClick={onDeletePanel}
            >
              Delete panel
            </button>
          </div>
        )}
      </header>

      {editingPanel && (
        <PanelForm
          ariaLabel={`Edit panel ${panel.name}`}
          initial={panel}
          rooms={rooms}
          upstreamPanels={upstreamPanels}
          submitLabel="Save panel"
          cancelLabel="Cancel panel edit"
          onSave={updatePanel}
          onCancel={() => {
            onError(null);
            setEditingPanel(false);
          }}
        />
      )}

      <p className="panel-coverage" aria-label={`${panel.name} mapping coverage`}>
        <span>{circuits.length} {circuits.length === 1 ? 'circuit' : 'circuits'}</span>
        <span>{mappedCircuitCount} with mapped points</span>
        <span>{mappedPointCount} total points</span>
        <span>{unverifiedCount} need verification</span>
      </p>

      <div className="breaker-directory" role="region" aria-label={`${panel.name} breaker directory`}>
        {sortedCircuits.length === 0 ? (
          <p>No circuits in this panel yet.</p>
        ) : (
          sortedCircuits.map((circuit) => (
            <CircuitCard
              key={circuit.id}
              circuit={circuit}
              panelName={panel.name}
              mappedPoints={pointCount(circuit.id)}
              onView={() => onViewCircuit(circuit.id)}
              onSave={(values) => updateCircuit(circuit.id, values)}
              onDelete={() => deleteCircuit(circuit.id)}
              onError={onError}
            />
          ))
        )}
      </div>

      <div className="circuit-add">
        {addingCircuit ? (
          <CircuitForm
            ariaLabel={`Add circuit to ${panel.name}`}
            initial={{
              breaker_label: '',
              amperage: null,
              poles: 1,
              panel_sticker_text: null,
              verified_description: null,
            }}
            submitLabel="Add circuit"
            cancelLabel="Cancel adding circuit"
            onSave={createCircuit}
            onCancel={() => setAddingCircuit(false)}
          />
        ) : (
          <button type="button" onClick={() => setAddingCircuit(true)}>
            Add circuit to {panel.name}
          </button>
        )}
      </div>
    </section>
  );
}

function CircuitCard({
  circuit,
  panelName,
  mappedPoints,
  onView,
  onSave,
  onDelete,
  onError,
}: {
  circuit: Circuit;
  panelName: string;
  mappedPoints: number;
  onView: () => void;
  onSave: (values: CircuitValues) => Promise<boolean>;
  onDelete: () => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const verified = Boolean(circuit.verified_description);
  const title = circuit.verified_description ?? circuit.panel_sticker_text ?? 'Unlabeled circuit';

  return (
    <article
      className={`breaker-slot${mappedPoints === 0 ? ' unmapped' : ''}`}
      style={{ minHeight: `${Math.max(circuit.poles, 1) * 5}rem` }}
      data-circuit-id={circuit.id}
      data-poles={circuit.poles}
    >
      <div className="breaker-handle">
        <small>Breaker</small>
        <strong>{circuit.breaker_label}</strong>
        <small>{circuit.poles} pole{circuit.poles === 1 ? '' : 's'}</small>
      </div>
      {editing ? (
        <CircuitForm
          className="breaker-edit-form"
          ariaLabel={`Edit breaker ${circuit.breaker_label}`}
          initial={circuit}
          submitLabel="Save breaker"
          cancelLabel="Cancel breaker edit"
          onSave={async (values) => {
            const saved = await onSave(values);
            if (saved) setEditing(false);
            return saved;
          }}
          onCancel={() => {
            onError(null);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <div className="breaker-details">
            <h4>{title}</h4>
            {circuit.amperage && <p>{circuit.amperage}A</p>}
            {circuit.verified_description && circuit.panel_sticker_text && (
              <p>Panel says: {circuit.panel_sticker_text}</p>
            )}
            <div className="status-badges">
              <span className={`status-badge ${mappedPoints > 0 ? 'mapped' : 'warning'}`}>
                {mappedPoints > 0
                  ? `${mappedPoints} mapped point${mappedPoints === 1 ? '' : 's'}`
                  : 'Unmapped'}
              </span>
              <span className={`status-badge ${verified ? 'verified' : 'warning'}`}>
                {verified ? 'Verified' : 'Needs verification'}
              </span>
            </div>
          </div>
          <div className="breaker-actions">
            <button type="button" onClick={onView} disabled={mappedPoints === 0}>
              View breaker {circuit.breaker_label} on floorplan
            </button>
            <button
              type="button"
              aria-label={`Edit breaker ${circuit.breaker_label}`}
              onClick={() => {
                onError(null);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              aria-label={`Delete breaker ${circuit.breaker_label} from ${panelName}`}
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function PanelForm({
  ariaLabel,
  initial,
  rooms,
  upstreamPanels,
  submitLabel,
  cancelLabel,
  onSave,
  onCancel,
}: {
  ariaLabel: string;
  initial: PanelValues;
  rooms: Room[];
  upstreamPanels: Panel[];
  submitLabel: string;
  cancelLabel: string;
  onSave: (values: PanelValues) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [roomId, setRoomId] = useState<number | ''>(initial.room_id ?? '');
  const [amperage, setAmperage] = useState(initial.amperage?.toString() ?? '');
  const [fedFrom, setFedFrom] = useState<number | ''>(initial.fed_from_panel_id ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      name,
      room_id: roomId === '' ? null : roomId,
      amperage: amperage === '' ? null : Number(amperage),
      fed_from_panel_id: fedFrom === '' ? null : fedFrom,
    });
    setSaving(false);
  }

  return (
    <form aria-label={ariaLabel} onSubmit={submit} className="editor-form">
      <div className="field-grid">
        <label>
          Panel name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Panel location
          <select value={roomId} onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Not recorded</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
        </label>
        <label>
          Panel amperage
          <input type="number" value={amperage} onChange={(e) => setAmperage(e.target.value)} />
        </label>
        <label>
          Fed from panel
          <select value={fedFrom} onChange={(e) => setFedFrom(e.target.value ? Number(e.target.value) : '')}>
            <option value="">No parent panel</option>
            {upstreamPanels.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : submitLabel}</button>
        <button type="button" aria-label={cancelLabel} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

function CircuitForm({
  ariaLabel,
  className = '',
  initial,
  submitLabel,
  cancelLabel,
  onSave,
  onCancel,
}: {
  ariaLabel: string;
  className?: string;
  initial: CircuitValues;
  submitLabel: string;
  cancelLabel: string;
  onSave: (values: CircuitValues) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [breakerLabel, setBreakerLabel] = useState(initial.breaker_label);
  const [amperage, setAmperage] = useState(initial.amperage?.toString() ?? '');
  const [poles, setPoles] = useState(initial.poles.toString());
  const [stickerText, setStickerText] = useState(initial.panel_sticker_text ?? '');
  const [verifiedDescription, setVerifiedDescription] = useState(
    initial.verified_description ?? '',
  );
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      breaker_label: breakerLabel,
      amperage: amperage === '' ? null : Number(amperage),
      poles: Number(poles),
      panel_sticker_text: stickerText || null,
      verified_description: verifiedDescription || null,
    });
    setSaving(false);
  }

  return (
    <form aria-label={ariaLabel} onSubmit={submit} className={`editor-form ${className}`.trim()}>
      <div className="field-grid circuit-fields">
        <label>
          Breaker label
          <input value={breakerLabel} onChange={(e) => setBreakerLabel(e.target.value)} required autoFocus />
        </label>
        <label>
          Breaker amperage
          <input type="number" value={amperage} onChange={(e) => setAmperage(e.target.value)} />
        </label>
        <label>
          Breaker poles
          <select value={poles} onChange={(e) => setPoles(e.target.value)}>
            <option value="1">1 pole</option>
            <option value="2">2 poles</option>
          </select>
        </label>
        <label>
          Panel sticker
          <input value={stickerText} onChange={(e) => setStickerText(e.target.value)} />
        </label>
        <label>
          Verified description
          <input
            value={verifiedDescription}
            onChange={(e) => setVerifiedDescription(e.target.value)}
          />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : submitLabel}</button>
        <button type="button" aria-label={cancelLabel} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

function canFeedPanel(candidate: Panel, panelId: number, panels: Panel[]) {
  let current: Panel | undefined = candidate;
  const visited = new Set<number>();
  while (current && !visited.has(current.id)) {
    if (current.id === panelId) return false;
    visited.add(current.id);
    current = panels.find((panel) => panel.id === current?.fed_from_panel_id);
  }
  return current == null;
}
