import type { Circuit, CircuitPoint, Floorplan, Panel, Room } from './types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = `: ${body.detail}`;
    } catch {
      // The status still gives a useful error when the response is not JSON.
    }
    throw new Error(`${options?.method ?? 'GET'} ${path} failed: ${res.status}${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const del = (path: string) => request<void>(path, { method: 'DELETE' });
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const api = {
  rooms: {
    list: () => request<Room[]>('/rooms'),
    create: (room: Omit<Room, 'id'>) => post<Room>('/rooms', room),
    update: (id: number, room: Partial<Omit<Room, 'id'>>) => patch<Room>(`/rooms/${id}`, room),
    remove: (id: number) => del(`/rooms/${id}`),
  },
  panels: {
    list: () => request<Panel[]>('/panels'),
    create: (panel: Omit<Panel, 'id'>) => post<Panel>('/panels', panel),
    update: (id: number, panel: Partial<Omit<Panel, 'id'>>) => patch<Panel>(`/panels/${id}`, panel),
    remove: (id: number) => del(`/panels/${id}`),
    circuits: (id: number) => request<Circuit[]>(`/panels/${id}/circuits`),
  },
  circuits: {
    list: () => request<Circuit[]>('/circuits'),
    create: (circuit: Omit<Circuit, 'id'>) => post<Circuit>('/circuits', circuit),
    update: (id: number, circuit: Partial<Omit<Circuit, 'id'>>) =>
      patch<Circuit>(`/circuits/${id}`, circuit),
    remove: (id: number) => del(`/circuits/${id}`),
  },
  circuitPoints: {
    list: () => request<CircuitPoint[]>('/circuit-points'),
    create: (point: Omit<CircuitPoint, 'id'>) => post<CircuitPoint>('/circuit-points', point),
    update: (id: number, point: Partial<Omit<CircuitPoint, 'id'>>) =>
      patch<CircuitPoint>(`/circuit-points/${id}`, point),
    remove: (id: number) => del(`/circuit-points/${id}`),
  },
  floorplan: {
    get: (floor: string) => request<Floorplan>(`/floorplan/${encodeURIComponent(floor)}`),
  },
};
