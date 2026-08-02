import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Circuit, Panel, Room } from '../types';

export function PanelEditor() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [circuits, setCircuits] = useState<Circuit[]>([]);

  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState<number | ''>('');
  const [amperage, setAmperage] = useState('');
  const [fedFrom, setFedFrom] = useState<number | ''>('');

  function refresh() {
    api.panels.list().then(setPanels);
    api.circuits.list().then(setCircuits);
  }

  useEffect(() => {
    api.rooms.list().then(setRooms);
    refresh();
  }, []);

  async function createPanel(e: React.FormEvent) {
    e.preventDefault();
    await api.panels.create({
      name,
      room_id: roomId === '' ? null : roomId,
      amperage: amperage === '' ? null : Number(amperage),
      fed_from_panel_id: fedFrom === '' ? null : fedFrom,
    });
    setName('');
    setAmperage('');
    refresh();
  }

  async function deletePanel(id: number) {
    await api.panels.remove(id);
    refresh();
  }

  return (
    <div>
      <h2>Panels &amp; circuits</h2>
      {panels.map((panel) => (
        <PanelCard
          key={panel.id}
          panel={panel}
          room={rooms.find((r) => r.id === panel.room_id)}
          fedFromName={panels.find((p) => p.id === panel.fed_from_panel_id)?.name}
          circuits={circuits.filter((c) => c.panel_id === panel.id)}
          onDeletePanel={() => deletePanel(panel.id)}
          onChange={refresh}
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
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
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
            {panels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Create panel</button>
      </form>
    </div>
  );
}

function PanelCard({
  panel,
  room,
  fedFromName,
  circuits,
  onDeletePanel,
  onChange,
}: {
  panel: Panel;
  room?: Room;
  fedFromName?: string;
  circuits: Circuit[];
  onDeletePanel: () => void;
  onChange: () => void;
}) {
  const [breakerLabel, setBreakerLabel] = useState('');
  const [circuitAmperage, setCircuitAmperage] = useState('');
  const [poles, setPoles] = useState('1');
  const [stickerText, setStickerText] = useState('');
  const [verifiedDescription, setVerifiedDescription] = useState('');

  async function createCircuit(e: React.FormEvent) {
    e.preventDefault();
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
    onChange();
  }

  async function deleteCircuit(id: number) {
    await api.circuits.remove(id);
    onChange();
  }

  return (
    <div className="panel-card">
      <div className="panel-card-header">
        <strong>{panel.name}</strong>
        {panel.amperage && <span> ({panel.amperage}A)</span>}
        {room && <span> — {room.name}</span>}
        {fedFromName && <span> — fed from {fedFromName}</span>}
        <button onClick={onDeletePanel}>Delete panel</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Breaker</th>
            <th>Amps</th>
            <th>Poles</th>
            <th>Panel says</th>
            <th>Confirmed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {circuits.map((circuit) => (
            <tr key={circuit.id}>
              <td>{circuit.breaker_label}</td>
              <td>{circuit.amperage ?? ''}</td>
              <td>{circuit.poles}</td>
              <td>{circuit.panel_sticker_text}</td>
              <td>{circuit.verified_description}</td>
              <td>
                <button onClick={() => deleteCircuit(circuit.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={createCircuit} className="inline-form">
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
    </div>
  );
}
