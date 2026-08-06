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
