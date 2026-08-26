export type Point = [number, number];

import type { Turn } from './wallWalk';

export interface MeasurementSource {
  unit: 'ft_in';
  start:
    | { mode: 'absolute'; x: number; y: number; heading_deg: number }
    | {
        mode: 'anchor';
        anchor_room_id: number;
        wall_index: number;
        corner: 'start' | 'end';
        offset_in: number;
        heading_deg: number;
      };
  walls: { length_in: number; turn: Turn }[];
}

export interface Room {
  id: number;
  name: string;
  floor: string;
  polygon: Point[];
  measurement_source?: MeasurementSource | null;
}

export interface Panel {
  id: number;
  name: string;
  room_id: number | null;
  amperage: number | null;
  fed_from_panel_id: number | null;
}

export interface Circuit {
  id: number;
  panel_id: number;
  breaker_label: string;
  amperage: number | null;
  poles: number;
  panel_sticker_text: string | null;
  verified_description: string | null;
}

export interface CircuitPoint {
  id: number;
  circuit_id: number;
  room_id: number;
  kind: string;
  x: number;
  y: number;
  label: string | null;
}

export interface Floorplan {
  rooms: Room[];
  circuit_points: CircuitPoint[];
}

export interface MaintenanceCompletion {
  id: number;
  task_id: number;
  scheduled_for: string;
  completed_on: string;
}

export interface MaintenanceTask {
  id: number;
  title: string;
  room_id: number | null;
  due_date: string;
  recurrence_days: number | null;
  notes: string | null;
  is_active: boolean;
  completions: MaintenanceCompletion[];
}
