import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Point, Room } from '../types';

function parsePolygon(text: string): Point[] | null {
  try {
    const value = JSON.parse(text);
    if (
      Array.isArray(value) &&
      value.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'))
    ) {
      return value as Point[];
    }
    return null;
  } catch {
    return null;
  }
}

export function RoomEditor() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('main');
  const [polygonText, setPolygonText] = useState('[[0,0],[10,0],[10,10],[0,10]]');
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.rooms.list().then(setRooms);
  }

  useEffect(refresh, []);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    const polygon = parsePolygon(polygonText);
    if (!polygon) {
      setError('Polygon must be JSON like [[0,0],[10,0],[10,10],[0,10]]');
      return;
    }
    setError(null);
    await api.rooms.create({ name, floor, polygon });
    setName('');
    refresh();
  }

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
            <th>Polygon</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <td>{room.name}</td>
              <td>{room.floor}</td>
              <td>{JSON.stringify(room.polygon)}</td>
              <td>
                <button onClick={() => deleteRoom(room.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Add room</h3>
      <form onSubmit={createRoom} className="stacked-form">
        <label>
          Name: <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Floor: <input value={floor} onChange={(e) => setFloor(e.target.value)} required />
        </label>
        <label>
          Polygon (JSON points):{' '}
          <textarea value={polygonText} onChange={(e) => setPolygonText(e.target.value)} rows={2} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Create room</button>
      </form>
    </div>
  );
}
