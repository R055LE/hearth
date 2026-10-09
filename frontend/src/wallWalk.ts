export type Turn = 'left' | 'right' | 'straight' | { deg: number };

export interface Wall {
  length_in: number;
  turn: Turn;
}

export interface StartPoint {
  x: number;
  y: number;
  heading_deg: number;
}

export type PolygonPoint = [number, number];

export function turnAngleDeg(turn: Turn): number {
  if (turn === 'left') return -90;
  if (turn === 'right') return 90;
  if (turn === 'straight') return 0;
  return turn.deg;
}

function headingVector(headingDeg: number): { x: number; y: number } {
  const rad = (headingDeg * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

export function wallsToVertices(start: StartPoint, walls: Wall[]): { x: number; y: number }[] {
  const vertices = [{ x: start.x, y: start.y }];
  let heading = start.heading_deg;
  let pos = { x: start.x, y: start.y };
  for (const wall of walls) {
    const lengthFt = wall.length_in / 12;
    const dir = headingVector(heading);
    pos = { x: pos.x + dir.x * lengthFt, y: pos.y + dir.y * lengthFt };
    vertices.push(pos);
    heading += turnAngleDeg(wall.turn);
  }
  return vertices;
}

export function closureGapFt(start: StartPoint, walls: Wall[]): number {
  if (walls.length === 0) return 0;
  const vertices = wallsToVertices(start, walls);
  const last = vertices[vertices.length - 1];
  return Math.hypot(last.x - start.x, last.y - start.y);
}

function roundFt(n: number): number {
  return Math.round(n * 10) / 10 || 0;
}

export function wallsToPolygon(start: StartPoint, walls: Wall[]): PolygonPoint[] {
  const vertices = wallsToVertices(start, walls);
  return vertices.slice(0, -1).map((v): PolygonPoint => [roundFt(v.x), roundFt(v.y)]);
}

export function resolveMeasurementStart(source: import('./types').MeasurementSource, rooms: import('./types').Room[], floor: string, roomId?: number): StartPoint | null {
  const start = source.start;
  if (start.mode === 'absolute') return start;
  const anchor = rooms.find((r) => r.id === start.anchor_room_id && r.id !== roomId && r.floor === floor);
  if (!anchor || !Number.isInteger(start.wall_index) || start.wall_index < 0 || start.wall_index >= anchor.polygon.length) return null;
  let a = anchor.polygon[start.wall_index];
  let b = anchor.polygon[(start.wall_index + 1) % anchor.polygon.length];
  if (start.corner === 'end') [a, b] = [b, a];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!Number.isFinite(length) || length <= 0) return null;
  const offsetFt = start.offset_in / 12;
  return { x: a[0] + (b[0] - a[0]) / length * offsetFt, y: a[1] + (b[1] - a[1]) / length * offsetFt, heading_deg: start.heading_deg };
}

export function wallDraftError(start: StartPoint, walls: Wall[]): string | null {
  if (![start.x, start.y, start.heading_deg].every(Number.isFinite) || walls.some((w) => !Number.isFinite(w.length_in) || w.length_in <= 0 || !Number.isFinite(turnAngleDeg(w.turn)))) return 'Placement and turns must be finite; wall lengths must be positive.';
  if (walls.length < 3) return 'Add at least 3 walls.';
  const gap = closureGapFt(start, walls);
  if (!Number.isFinite(gap) || gap > 1 / 12) return `Shape doesn't close: off by ${(gap * 12).toFixed(1)}in. Adjust a wall length.`;
  return null;
}
