import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Room } from '../types';
import { RoomBuilder } from './RoomBuilder';

export function RoomEditor() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [addingRoom, setAddingRoom] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.rooms
      .list()
      .then((roomList) => {
        setRooms(roomList);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }

  useEffect(refresh, []);

  async function deleteRoom(id: number) {
    if (!window.confirm('Delete this room? This cannot be undone.')) return;
    try {
      await api.rooms.remove(id);
      if (editingRoom?.id === id) setEditingRoom(null);
      setError(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <h2>Rooms</h2>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Floor</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <td>{room.name}</td>
              <td>{room.floor}</td>
              <td>
                <button
                  onClick={() => {
                    setAddingRoom(false);
                    setEditingRoom(room);
                  }}
                >
                  Edit
                </button>
                <button onClick={() => deleteRoom(room.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editingRoom || addingRoom ? (
        <>
          <h3>{editingRoom ? `Edit ${editingRoom.name}` : 'Add room'}</h3>
          <RoomBuilder
            key={editingRoom?.id ?? 'new'}
            allRooms={rooms}
            editingRoom={editingRoom}
            onSaved={() => {
              setAddingRoom(false);
              setEditingRoom(null);
              refresh();
            }}
            onCancel={() => {
              setAddingRoom(false);
              setEditingRoom(null);
            }}
          />
        </>
      ) : (
        <button type="button" onClick={() => setAddingRoom(true)}>
          Add room
        </button>
      )}
    </div>
  );
}
