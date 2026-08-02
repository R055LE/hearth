export type Point = [number, number];

export interface Room {
  id: number;
  name: string;
  floor: string;
  polygon: Point[];
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
