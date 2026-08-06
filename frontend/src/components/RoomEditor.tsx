import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Room } from '../types';
import { RoomBuilder } from './RoomBuilder';

export function RoomEditor() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);

  function refresh() {
    api.rooms.list().then(setRooms);
  }

  useEffect(refresh, []);

  async function deleteRoom(id: number) {
    await api.rooms.remove(id);
    if (editingRoom?.id === id) setEditingRoom(null);
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
                <button onClick={() => setEditingRoom(room)}>Edit</button>
                <button onClick={() => deleteRoom(room.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{editingRoom ? `Edit ${editingRoom.name}` : 'Add room'}</h3>
      <RoomBuilder
        key={editingRoom?.id ?? 'new'}
        allRooms={rooms}
        editingRoom={editingRoom}
        onSaved={() => {
          setEditingRoom(null);
          refresh();
        }}
        onCancel={() => setEditingRoom(null)}
      />
    </div>
  );
}
