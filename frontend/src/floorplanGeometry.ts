import type { Point, Room } from './types';

export interface AxisAlignedRectangle {
  x: number;
  y: number;
  length: number;
  width: number;
}

function pointOnSegment([x, y]: Point, [ax, ay]: Point, [bx, by]: Point): boolean {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-9) return false;
  return x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by);
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const start = polygon[j];
    const end = polygon[i];
    if (pointOnSegment(point, start, end)) return true;

    const crossesHorizontalRay =
      start[1] > point[1] !== end[1] > point[1] &&
      point[0] < ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0];
    if (crossesHorizontalRay) inside = !inside;
  }

  return inside;
}

export function roomContainingPoint(rooms: Room[], point: Point): Room | undefined {
  return rooms.find((room) => pointInPolygon(point, room.polygon));
}

export function axisAlignedRectangle(polygon: Point[]): AxisAlignedRectangle | null {
  if (polygon.length !== 4) return null;
  const epsilon = 1e-6;
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  if (maxX - x <= epsilon || maxY - y <= epsilon) return null;

  const expected: Point[] = [[x, y], [maxX, y], [maxX, maxY], [x, maxY]];
  const matched = new Set<number>();
  for (const [px, py] of polygon) {
    const corner = expected.findIndex(
      ([cx, cy], index) =>
        !matched.has(index) && Math.abs(px - cx) <= epsilon && Math.abs(py - cy) <= epsilon,
    );
    if (corner < 0) return null;
    matched.add(corner);
  }
  return { x, y, length: maxX - x, width: maxY - y };
}

export function rectanglePolygon(rectangle: AxisAlignedRectangle): Point[] {
  const { x, y, length, width } = rectangle;
  return [
    [x, y],
    [x + length, y],
    [x + length, y + width],
    [x, y + width],
  ];
}

export function mapPointBetweenRectangles(
  [x, y]: Point,
  from: AxisAlignedRectangle,
  to: AxisAlignedRectangle,
): Point {
  return [
    to.x + ((x - from.x) / from.length) * to.length,
    to.y + ((y - from.y) / from.width) * to.width,
  ];
}

export function suggestedRectangleOrigin(rooms: Room[]): Point {
  if (rooms.length === 0) return [0, 0];
  const xs = rooms.flatMap((room) => room.polygon.map(([x]) => x));
  const ys = rooms.flatMap((room) => room.polygon.map(([, y]) => y));
  return [Math.max(...xs) + 2, Math.min(...ys)];
}
