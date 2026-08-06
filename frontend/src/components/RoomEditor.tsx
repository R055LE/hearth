import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Room } from '../types';
import { RoomBuilder } from './RoomBuilder';

export function RoomEditor() {
  const [rooms, setRooms] = useState<Room[]>([]);

  function refresh() {
    api.rooms.list().then(setRooms);
  }

  useEffect(refresh, []);

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
            <th />
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <td>{room.name}</td>
              <td>{room.floor}</td>
              <td>
                <button onClick={() => deleteRoom(room.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Add room</h3>
      <RoomBuilder allRooms={rooms} onSaved={refresh} />
    </div>
  );
}
