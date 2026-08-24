import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Room } from '../types';
import { RoomBuilder } from './RoomBuilder';

export function RoomEditor() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [addingRoom, setAddingRoom] = useState(false);
  const [editingDetails, setEditingDetails] = useState<Room | null>(null);
  const [editingGeometry, setEditingGeometry] = useState<Room | null>(null);
  const [detailsName, setDetailsName] = useState('');
  const [detailsFloor, setDetailsFloor] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
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
      if (editingDetails?.id === id) setEditingDetails(null);
      if (editingGeometry?.id === id) setEditingGeometry(null);
      setError(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function beginDetailsEdit(room: Room) {
    setAddingRoom(false);
    setEditingGeometry(null);
    setEditingDetails(room);
    setDetailsName(room.name);
    setDetailsFloor(room.floor);
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDetails) return;
    setSavingDetails(true);
    try {
      await api.rooms.update(editingDetails.id, { name: detailsName, floor: detailsFloor });
      setEditingDetails(null);
      setError(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDetails(false);
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
                <div className="form-actions">
                  <button
                    type="button"
                    aria-label={`Edit room details for ${room.name}`}
                    onClick={() => beginDetailsEdit(room)}
                  >
                    Edit details
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit room geometry for ${room.name}`}
                    onClick={() => {
                      setAddingRoom(false);
                      setEditingDetails(null);
                      setEditingGeometry(room);
                    }}
                  >
                    Edit geometry
                  </button>
                  <button onClick={() => deleteRoom(room.id)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editingDetails ? (
        <form
          className="editor-form"
          aria-label={`Edit room details for ${editingDetails.name}`}
          onSubmit={saveDetails}
        >
          <h3>Edit room details for {editingDetails.name}</h3>
          <div className="field-grid">
            <label>
              Name
              <input
                aria-label="Room name"
                value={detailsName}
                onChange={(e) => setDetailsName(e.target.value)}
                required
              />
            </label>
            <label>
              Floor
              <input
                aria-label="Room floor"
                value={detailsFloor}
                onChange={(e) => setDetailsFloor(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={savingDetails}>
              {savingDetails ? 'Saving…' : 'Save details'}
            </button>
            <button type="button" onClick={() => setEditingDetails(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : editingGeometry || addingRoom ? (
        <>
          <h3>{editingGeometry ? `Edit geometry for ${editingGeometry.name}` : 'Add room'}</h3>
          <RoomBuilder
            key={editingGeometry?.id ?? 'new'}
            allRooms={rooms}
            editingRoom={editingGeometry}
            onSaved={() => {
              setAddingRoom(false);
              setEditingGeometry(null);
              refresh();
            }}
            onCancel={() => {
              setAddingRoom(false);
              setEditingGeometry(null);
            }}
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditingDetails(null);
            setEditingGeometry(null);
            setAddingRoom(true);
          }}
        >
          Add room
        </button>
      )}
    </div>
  );
}
