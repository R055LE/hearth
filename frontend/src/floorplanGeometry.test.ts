import { describe, expect, it } from 'vitest';
import {
  axisAlignedRectangle,
  mapPointBetweenRectangles,
  pointInPolygon,
  rectanglePolygon,
  roomContainingPoint,
  suggestedRectangleOrigin,
} from './floorplanGeometry';
import { wallsToPolygon } from './wallWalk';
import type { Room } from './types';

const garage: Room = {
  id: 1,
  name: 'Garage',
  floor: 'main',
  polygon: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
};

describe('pointInPolygon', () => {
  it('includes interior and boundary points', () => {
    expect(pointInPolygon([5, 5], garage.polygon)).toBe(true);
    expect(pointInPolygon([10, 5], garage.polygon)).toBe(true);
    expect(pointInPolygon([11, 5], garage.polygon)).toBe(false);
  });

  it('handles concave rooms', () => {
    const polygon: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    expect(pointInPolygon([2, 8], polygon)).toBe(true);
    expect(pointInPolygon([8, 8], polygon)).toBe(false);
  });
});

describe('roomContainingPoint', () => {
  it('returns the room containing the captured location', () => {
    expect(roomContainingPoint([garage], [4, 6])?.id).toBe(1);
    expect(roomContainingPoint([garage], [14, 6])).toBeUndefined();
  });
});

describe('rectangle room geometry', () => {
  it('recognizes axis-aligned rectangles in any vertex order', () => {
    expect(axisAlignedRectangle([[12, 10], [0, 0], [0, 10], [12, 0]])).toEqual({
      x: 0,
      y: 0,
      length: 12,
      width: 10,
    });
    expect(axisAlignedRectangle([[0, 0], [12, 0], [10, 10], [0, 10]])).toBeNull();
  });

  it('recognizes wall-walk rectangles despite cardinal-heading float noise', () => {
    const walls = [12, 10, 12, 10].map((feet) => ({
      length_in: feet * 12,
      turn: 'right' as const,
    }));
    expect(axisAlignedRectangle(wallsToPolygon({ x: 3, y: 4, heading_deg: 0 }, walls))).toMatchObject({
      x: 3,
      y: 4,
      length: 12,
      width: 10,
    });
    const turned = axisAlignedRectangle(wallsToPolygon({ x: 3, y: 4, heading_deg: 90 }, walls));
    expect(turned).not.toBeNull();
    expect(turned!.x).toBeCloseTo(-7);
    expect(turned!.y).toBeCloseTo(4);
    expect(turned!.length).toBeCloseTo(10);
    expect(turned!.width).toBeCloseTo(12);
    expect(axisAlignedRectangle(wallsToPolygon({ x: 3, y: 4, heading_deg: 45 }, walls))).toBeNull();
  });

  it('builds a rectangle and suggests a visible origin beside existing rooms', () => {
    expect(rectanglePolygon({ x: 22, y: 0, length: 16, width: 12 })).toEqual([
      [22, 0],
      [38, 0],
      [38, 12],
      [22, 12],
    ]);
    expect(suggestedRectangleOrigin([garage])).toEqual([12, 0]);
  });

  it('maps points to the same relative position in an edited rectangle', () => {
    expect(mapPointBetweenRectangles(
      [12, 2],
      { x: 10, y: 0, length: 10, width: 10 },
      { x: 20, y: 5, length: 20, width: 5 },
    )).toEqual([24, 6]);
  });
});
