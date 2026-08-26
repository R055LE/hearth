import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { MaintenanceTask, Room } from '../types';

interface TaskValues {
  title: string;
  room_id: number | null;
  due_date: string;
  recurrence_days: number | null;
  notes: string | null;
}

function localDate(): string {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function groupFor(task: MaintenanceTask, today: string) {
  if (!task.is_active) return 'completed';
  if (task.due_date < today) return 'overdue';
  if (task.due_date === today) return 'today';
  return 'upcoming';
}

const GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
] as const;

export function MaintenanceView() {
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = localDate();

  function refresh() {
    return Promise.all([api.maintenanceTasks.list(), api.rooms.list()])
      .then(([taskList, roomList]) => {
        setTasks(taskList);
        setRooms(roomList);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }

  useEffect(() => {
    refresh();
  }, []);

  const groupedTasks = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        tasks: tasks
          .filter((task) => groupFor(task, today) === group.key)
          .sort((left, right) => left.due_date.localeCompare(right.due_date)),
      })),
    [tasks, today],
  );

  async function createTask(values: TaskValues) {
    try {
      await api.maintenanceTasks.create(values);
      setAdding(false);
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  return (
    <section aria-labelledby="maintenance-heading">
      <h2 id="maintenance-heading">Maintenance</h2>
      {error && <p className="error">{error}</p>}
      {tasks.length === 0 && !adding && <p>No maintenance tasks yet.</p>}

      {groupedTasks.map(
        (group) =>
          group.tasks.length > 0 && (
            <section
              key={group.key}
              className="maintenance-group"
              aria-labelledby={`maintenance-${group.key}`}
            >
              <h3 id={`maintenance-${group.key}`}>{group.label}</h3>
              <div className="maintenance-list">
                {group.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    rooms={rooms}
                    status={group.label}
                    onChange={refresh}
                    onError={setError}
                  />
                ))}
              </div>
            </section>
          ),
      )}

      <div className="maintenance-add">
        {adding ? (
          <TaskForm
            ariaLabel="Add maintenance task"
            initial={{
              title: '',
              room_id: null,
              due_date: today,
              recurrence_days: null,
              notes: null,
            }}
            rooms={rooms}
            submitLabel="Create task"
            cancelLabel="Cancel adding task"
            onSave={createTask}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)}>Add task</button>
        )}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  rooms,
  status,
  onChange,
  onError,
}: {
  task: MaintenanceTask;
  rooms: Room[];
  status: string;
  onChange: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const headingId = `maintenance-task-${task.id}`;
  const room = rooms.find((candidate) => candidate.id === task.room_id);

  async function updateTask(values: TaskValues) {
    try {
      await api.maintenanceTasks.update(task.id, values);
      setEditing(false);
      onError(null);
      await onChange();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function completeTask(completedOn: string) {
    try {
      await api.maintenanceTasks.complete(task.id, completedOn);
      setCompleting(false);
      onError(null);
      await onChange();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  return (
    <article className="maintenance-card" aria-labelledby={headingId}>
      <header className="maintenance-card-header">
        <h4 id={headingId}>{task.title}</h4>
        <span className={`status-badge maintenance-${status.toLowerCase().replace(' ', '-')}`}>
          {status}
        </span>
      </header>

      {editing ? (
        <TaskForm
          ariaLabel={`Edit ${task.title}`}
          initial={task}
          rooms={rooms}
          scheduleLocked={!task.is_active}
          submitLabel="Save task"
          cancelLabel="Cancel task edit"
          onSave={updateTask}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="maintenance-meta">
            <span>{task.is_active ? `Next due ${task.due_date}` : `Last due ${task.due_date}`}</span>
            <span>{room?.name ?? 'No room'}</span>
            <span>{task.recurrence_days ? `Every ${task.recurrence_days} days` : 'One time'}</span>
          </div>
          {task.notes && <p>{task.notes}</p>}
          {!completing && (
            <div className="form-actions">
              {task.is_active && (
                <button
                  type="button"
                  aria-label={`Complete ${task.title}`}
                  onClick={() => setCompleting(true)}
                >
                  Complete
                </button>
              )}
              <button
                type="button"
                aria-label={`Edit ${task.title}`}
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            </div>
          )}
          {completing && (
            <CompletionForm
              task={task}
              onSave={completeTask}
              onCancel={() => setCompleting(false)}
            />
          )}
          {task.completions.length > 0 && (
            <details className="maintenance-history" open={!task.is_active}>
              <summary>History ({task.completions.length})</summary>
              <ul>
                {task.completions.map((completion) => (
                  <li key={completion.id}>
                    Completed {completion.completed_on} for {completion.scheduled_for}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </article>
  );
}

function TaskForm({
  ariaLabel,
  initial,
  rooms,
  scheduleLocked = false,
  submitLabel,
  cancelLabel,
  onSave,
  onCancel,
}: {
  ariaLabel: string;
  initial: TaskValues;
  rooms: Room[];
  scheduleLocked?: boolean;
  submitLabel: string;
  cancelLabel: string;
  onSave: (values: TaskValues) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [roomId, setRoomId] = useState(initial.room_id == null ? '' : String(initial.room_id));
  const [dueDate, setDueDate] = useState(initial.due_date);
  const [schedule, setSchedule] = useState(initial.recurrence_days == null ? 'once' : 'repeat');
  const [interval, setInterval] = useState(String(initial.recurrence_days ?? 30));
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const saved = await onSave({
      title: title.trim(),
      room_id: roomId ? Number(roomId) : null,
      due_date: dueDate,
      recurrence_days: schedule === 'repeat' ? Number(interval) : null,
      notes: notes.trim() || null,
    });
    if (!saved) setSaving(false);
  }

  return (
    <form className="editor-form maintenance-form" aria-label={ariaLabel} onSubmit={submit}>
      <div className="field-grid">
        <label>
          Task
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          Room
          <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            <option value="">No room</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
        </label>
        {!scheduleLocked && (
          <>
            <label>
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                required
              />
            </label>
            <label>
              Schedule
              <select value={schedule} onChange={(event) => setSchedule(event.target.value)}>
                <option value="once">One time</option>
                <option value="repeat">Repeat</option>
              </select>
            </label>
            {schedule === 'repeat' && (
              <label>
                Interval days
                <input
                  type="number"
                  min="1"
                  value={interval}
                  onChange={(event) => setInterval(event.target.value)}
                  required
                />
              </label>
            )}
          </>
        )}
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : submitLabel}</button>
        <button type="button" onClick={onCancel}>{cancelLabel}</button>
      </div>
    </form>
  );
}

function CompletionForm({
  task,
  onSave,
  onCancel,
}: {
  task: MaintenanceTask;
  onSave: (completedOn: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [completedOn, setCompletedOn] = useState(localDate());
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const saved = await onSave(completedOn);
    if (!saved) setSaving(false);
  }

  return (
    <form
      className="editor-form completion-form"
      aria-label={`Complete ${task.title}`}
      onSubmit={submit}
    >
      <label>
        Completion date
        <input
          type="date"
          value={completedOn}
          onChange={(event) => setCompletedOn(event.target.value)}
          required
        />
      </label>
      <div className="form-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save completion'}</button>
        <button type="button" onClick={onCancel}>Cancel completion</button>
      </div>
    </form>
  );
}
