import type { Point, Room } from './types';

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
