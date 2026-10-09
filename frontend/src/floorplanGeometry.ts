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

export function polygonError(polygon: Point[]): string | null {
  if (polygon.length < 3 || polygon.some((p) => p.some((n) => !Number.isFinite(n)))) return 'Use at least three finite vertices.';
  if (new Set(polygon.map((p) => JSON.stringify(p))).size !== polygon.length) return 'Vertices and edges must not repeat; closure is implicit.';
  const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const edges = polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]]);
  const area = edges.reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-9) return 'The room must have nonzero finite area.';
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    const c = edges[(i + 1) % edges.length][1];
    if (pointOnSegment(c, a, b) || pointOnSegment(a, b, c)) return 'Edges must not overlap.';
    for (let j = i + 1; j < edges.length; j++) {
      if (j === i + 1 || (i === 0 && j === edges.length - 1)) continue;
      const [c, d] = edges[j];
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
          pointOnSegment(c, a, b) || pointOnSegment(d, a, b) || pointOnSegment(a, c, d) || pointOnSegment(b, c, d)) return 'The room must not self-intersect.';
    }
  }
  return null;
}

export function previewRoomPoints<T extends { x: number; y: number }>(old: Point[], proposed: Point[], points: T[]) {
  const dx = proposed[0][0] - (old[0]?.[0] ?? 0);
  const dy = proposed[0][1] - (old[0]?.[1] ?? 0);
  const translation = old.length === proposed.length && old.every(([x, y], i) =>
    Math.abs(proposed[i][0] - x - dx) < 1e-9 && Math.abs(proposed[i][1] - y - dy) < 1e-9);
  const from = axisAlignedRectangle(old);
  const to = axisAlignedRectangle(proposed);
  const policy = translation ? 'translation' : from && to ? 'resize' : 'fixed';
  const mapped = points.map((point) => {
    const [x, y] = translation ? [point.x + dx, point.y + dy] : from && to
      ? mapPointBetweenRectangles([point.x, point.y], from, to) : [point.x, point.y];
    return { ...point, x, y };
  });
  return { points: mapped, policy, outside: policy === 'fixed' && mapped.some((p) => !pointInPolygon([p.x, p.y], proposed)) };
}
