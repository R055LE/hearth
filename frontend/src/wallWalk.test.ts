import { describe, expect, it } from 'vitest';
import { closureGapFt, turnAngleDeg, wallsToPolygon } from './wallWalk';

describe('turnAngleDeg', () => {
  it('resolves named and custom turns', () => {
    expect(turnAngleDeg('left')).toBe(-90);
    expect(turnAngleDeg('right')).toBe(90);
    expect(turnAngleDeg('straight')).toBe(0);
    expect(turnAngleDeg({ deg: -30 })).toBe(-30);
  });
});

describe('wallsToPolygon', () => {
  const start = { x: 0, y: 0, heading_deg: 0 };

  it('closes a simple square', () => {
    const walls = [
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
    ];
    expect(closureGapFt(start, walls)).toBeCloseTo(0, 6);
    expect(wallsToPolygon(start, walls)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it('closes an L-shape with a concave turn', () => {
    const walls = [
      { length_in: 240, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'left' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 240, turn: 'right' as const },
    ];
    expect(closureGapFt(start, walls)).toBeCloseTo(0, 6);
    expect(wallsToPolygon(start, walls)).toEqual([
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ]);
  });

  it('flags an open shape via closure gap', () => {
    const walls = [
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'right' as const },
      { length_in: 100, turn: 'right' as const },
    ];
    expect(closureGapFt(start, walls)).toBeCloseTo(20 / 12, 3);
  });

  it('treats a custom-degree turn as equivalent to its named counterpart', () => {
    const named = [
      { length_in: 120, turn: 'right' as const },
      { length_in: 120, turn: 'straight' as const },
    ];
    const custom = [
      { length_in: 120, turn: { deg: 90 } },
      { length_in: 120, turn: { deg: 0 } },
    ];
    expect(wallsToPolygon(start, custom)).toEqual(wallsToPolygon(start, named));
  });
});
