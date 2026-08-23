import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Circuit, CircuitPoint, Panel, Room } from '../types';

export function PanelEditor({
  onViewCircuit,
}: {
  onViewCircuit: (circuitId: number, floor: string) => void;
}) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [circuitPoints, setCircuitPoints] = useState<CircuitPoint[]>([]);

  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState<number | ''>('');
  const [amperage, setAmperage] = useState('');
  const [fedFrom, setFedFrom] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    Promise.all([
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

  async function createPanel(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.panels.create({
        name,
        room_id: roomId === '' ? null : roomId,
        amperage: amperage === '' ? null : Number(amperage),
        fed_from_panel_id: fedFrom === '' ? null : fedFrom,
      });
      setName('');
      setAmperage('');
      setError(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deletePanel(id: number) {
    if (!window.confirm('Delete this panel? This cannot be undone.')) return;
    try {
      await api.panels.remove(id);
      setError(null);
      refresh();
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
          room={rooms.find((room) => room.id === panel.room_id)}
          fedFromName={panels.find((candidate) => candidate.id === panel.fed_from_panel_id)?.name}
          feedsPanels={panels.filter((candidate) => candidate.fed_from_panel_id === panel.id)}
          circuits={circuits.filter((circuit) => circuit.panel_id === panel.id)}
          circuitPoints={circuitPoints}
          onViewCircuit={viewCircuit}
          onDeletePanel={() => deletePanel(panel.id)}
          onChange={refresh}
          onError={setError}
        />
      ))}

      <h3>Add panel</h3>
      <form onSubmit={createPanel} className="stacked-form">
        <label>
          Name: <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Location:{' '}
          <select value={roomId} onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">(none)</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amperage: <input type="number" value={amperage} onChange={(e) => setAmperage(e.target.value)} />
        </label>
        <label>
          Fed from (subpanel of):{' '}
          <select value={fedFrom} onChange={(e) => setFedFrom(e.target.value ? Number(e.target.value) : '')}>
            <option value="">(main panel)</option>
            {panels.map((panel) => (
              <option key={panel.id} value={panel.id}>
                {panel.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Create panel</button>
      </form>
    </section>
  );
}

function PanelCard({
  panel,
  room,
  fedFromName,
  feedsPanels,
  circuits,
  circuitPoints,
  onViewCircuit,
  onDeletePanel,
  onChange,
  onError,
}: {
  panel: Panel;
  room?: Room;
  fedFromName?: string;
  feedsPanels: Panel[];
  circuits: Circuit[];
  circuitPoints: CircuitPoint[];
  onViewCircuit: (circuitId: number) => void;
  onDeletePanel: () => void;
  onChange: () => void;
  onError: (message: string | null) => void;
}) {
  const [breakerLabel, setBreakerLabel] = useState('');
  const [circuitAmperage, setCircuitAmperage] = useState('');
  const [poles, setPoles] = useState('1');
  const [stickerText, setStickerText] = useState('');
  const [verifiedDescription, setVerifiedDescription] = useState('');

  const sortedCircuits = [...circuits].sort((left, right) =>
    left.breaker_label.localeCompare(right.breaker_label, undefined, { numeric: true }),
  );
  const pointCount = (circuitId: number) =>
    circuitPoints.filter((point) => point.circuit_id === circuitId).length;
  const mappedCircuitCount = circuits.filter((circuit) => pointCount(circuit.id) > 0).length;
  const mappedPointCount = circuits.reduce((total, circuit) => total + pointCount(circuit.id), 0);
  const unverifiedCount = circuits.filter((circuit) => !circuit.verified_description).length;

  async function createCircuit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.circuits.create({
        panel_id: panel.id,
        breaker_label: breakerLabel,
        amperage: circuitAmperage === '' ? null : Number(circuitAmperage),
        poles: Number(poles),
        panel_sticker_text: stickerText || null,
        verified_description: verifiedDescription || null,
      });
      setBreakerLabel('');
      setCircuitAmperage('');
      setStickerText('');
      setVerifiedDescription('');
      onError(null);
      onChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteCircuit(id: number) {
    if (!window.confirm('Delete this circuit? This cannot be undone.')) return;
    try {
      await api.circuits.remove(id);
      onError(null);
      onChange();
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
          <p className="panel-location">Location: {room?.name ?? 'not recorded'}</p>
          <p className="panel-feed">
            {fedFromName ? `Fed from ${fedFromName}.` : 'No parent panel recorded.'}
            {feedsPanels.length > 0 && ` Feeds ${feedsPanels.map((child) => child.name).join(', ')}.`}
          </p>
        </div>
        <button type="button" onClick={onDeletePanel}>Delete panel</button>
      </header>

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
          sortedCircuits.map((circuit) => {
            const mappedPoints = pointCount(circuit.id);
            const verified = Boolean(circuit.verified_description);
            const title =
              circuit.verified_description ?? circuit.panel_sticker_text ?? 'Unlabeled circuit';
            return (
              <article
                key={circuit.id}
                className={`breaker-slot${mappedPoints === 0 ? ' unmapped' : ''}`}
                style={{ minHeight: `${Math.max(circuit.poles, 1) * 5}rem` }}
                data-poles={circuit.poles}
              >
                <div className="breaker-handle">
                  <small>Breaker</small>
                  <strong>{circuit.breaker_label}</strong>
                  <small>{circuit.poles} pole{circuit.poles === 1 ? '' : 's'}</small>
                </div>
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
                  <button
                    type="button"
                    onClick={() => onViewCircuit(circuit.id)}
                    disabled={mappedPoints === 0}
                  >
                    View breaker {circuit.breaker_label} on floorplan
                  </button>
                  <button type="button" onClick={() => deleteCircuit(circuit.id)}>Delete</button>
                </div>
              </article>
            );
          })
        )}
      </div>

      <form onSubmit={createCircuit} className="inline-form circuit-form">
        <input
          placeholder="Breaker # (e.g. 12)"
          value={breakerLabel}
          onChange={(e) => setBreakerLabel(e.target.value)}
          required
        />
        <input
          placeholder="Amps"
          type="number"
          value={circuitAmperage}
          onChange={(e) => setCircuitAmperage(e.target.value)}
        />
        <select value={poles} onChange={(e) => setPoles(e.target.value)}>
          <option value="1">1 pole</option>
          <option value="2">2 pole</option>
        </select>
        <input
          placeholder="Panel sticker says"
          value={stickerText}
          onChange={(e) => setStickerText(e.target.value)}
        />
        <input
          placeholder="Confirmed to actually power"
          value={verifiedDescription}
          onChange={(e) => setVerifiedDescription(e.target.value)}
        />
        <button type="submit">Add circuit</button>
      </form>
    </section>
  );
}
