import { describe, expect, it } from 'vitest';
import { pointInPolygon, roomContainingPoint } from './floorplanGeometry';
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
