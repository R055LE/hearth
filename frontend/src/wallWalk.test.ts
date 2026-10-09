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

describe('measurement validation', () => {
  it('preserves sub-inch values while using the existing projection and closure tolerance', async () => {
    const { wallDraftError } = await import('./wallWalk');
    const walls = Array.from({ length: 4 }, () => ({ length_in: 120.123456789, turn: { deg: 90 } }));
    const start = { x: -0.05, y: 0.025, heading_deg: 0 };
    expect(wallsToPolygon(start, walls)).toEqual([[0, 0], [10, 0], [10, 10], [-0.1, 10]]);
    expect(wallDraftError(start, walls)).toBeNull();
    expect(walls[0].length_in).toBe(120.123456789);
    walls[3].length_in -= 2;
    expect(wallDraftError(start, walls)).toContain("doesn't close");
    walls[0].length_in = Infinity;
    expect(wallDraftError(start, walls)).toContain('finite');
  });

  it('resolves only valid same-floor anchors without changing their source', async () => {
    const { resolveMeasurementStart } = await import('./wallWalk');
    const source = { unit: 'ft_in' as const, start: { mode: 'anchor' as const, anchor_room_id: 1, wall_index: 0, corner: 'end' as const, offset_in: 6, heading_deg: 45 }, walls: [] };
    const rooms = [{ id: 1, name: 'Anchor', floor: 'main', polygon: [[0, 0], [10, 0], [10, 10]] as [number, number][] }];
    expect(resolveMeasurementStart(source, rooms, 'main', 2)).toEqual({ x: 9.5, y: 0, heading_deg: 45 });
    expect(resolveMeasurementStart(source, rooms, 'other', 2)).toBeNull();
    expect(resolveMeasurementStart(source, rooms, 'main', 1)).toBeNull();
    source.start.wall_index = 3;
    expect(resolveMeasurementStart(source, rooms, 'main', 2)).toBeNull();
  });
});

it('resolves a diagonal anchor half-step in the same arithmetic order as the editor', async () => {
  const { resolveMeasurementStart } = await import('./wallWalk');
  const source = { unit: 'ft_in' as const, start: { mode: 'anchor' as const, anchor_room_id: 1, wall_index: 0, corner: 'start' as const, offset_in: 3, heading_deg: 0 }, walls: Array.from({ length: 4 }, () => ({ length_in: 12, turn: 'right' as const })) };
  const rooms = [{ id: 1, name: 'Diagonal', floor: 'main', polygon: [[0, 0], [3, 4], [0, 4]] as [number, number][] }];
  const start = resolveMeasurementStart(source, rooms, 'main', 2)!;
  expect(start).toEqual({ x: 0.15, y: 0.2, heading_deg: 0 });
  expect(wallsToPolygon(start, source.walls)).toEqual([[0.2, 0.2], [1.2, 0.2], [1.2, 1.2], [0.1, 1.2]]);
});
