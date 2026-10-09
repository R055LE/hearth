import { expect, test, type Page } from '@playwright/test';
import type { CircuitPoint, MeasurementSource, Room } from '../src/types';
import { resolveMeasurementStart, wallsToPolygon } from '../src/wallWalk';
import { previewRoomPoints } from '../src/floorplanGeometry';

const source: MeasurementSource = {
  unit: 'ft_in', start: { mode: 'absolute', x: 0.025, y: 0.025, heading_deg: 30 },
  walls: Array.from({ length: 4 }, () => ({ length_in: 120.123456789, turn: { deg: 90 } })),
};
function measured(measurement_source = source, id = 1, rooms: Room[] = []): Room {
  return { id, name: 'Measured room', floor: 'main', measurement_source,
    polygon: wallsToPolygon(resolveMeasurementStart(measurement_source, rooms, 'main', id)!, measurement_source.walls) };
}
const mapped: CircuitPoint = { id: 1, room_id: 1, circuit_id: 1, kind: 'outlet', label: 'Desk outlet', x: 2, y: 5 };

async function setup(page: Page, initial: Room[] = [measured()], initialPoints: CircuitPoint[] = [mapped]) {
  let rooms = structuredClone(initial);
  let points = structuredClone(initialPoints);
  const state = { patches: [] as Partial<Room>[], failure: 0, pointLoadFailure: false, networkFailure: false, delay: false, release: () => {} };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const id = Number(path.split('/').at(-1));
    if (path.startsWith('/api/rooms/') && request.method() === 'PATCH') {
      const body = request.postDataJSON() as Partial<Room>;
      state.patches.push(body);
      if (state.networkFailure) return route.abort('failed');
      if (state.delay) await new Promise<void>((resolve) => { state.release = resolve; });
      if (state.failure) return route.fulfill({ status: state.failure, json: { detail: 'Geometry save rejected. Review the draft and retry.' } });
      const old = rooms.find((r) => r.id === id)!;
      if (body.polygon) points = points.map((p) => p.room_id === id ? previewRoomPoints(old.polygon, body.polygon!, [p]).points[0] : p);
      rooms = rooms.map((r) => r.id === id ? { ...r, ...body } : r);
      return route.fulfill({ json: rooms.find((r) => r.id === id) });
    }
    if (path === '/api/floors') return route.fulfill({ json: [{ id: 1, name: 'main' }, { id: 2, name: 'upper' }] });
    if (path === '/api/rooms') return route.fulfill({ json: rooms });
    if (path === '/api/circuit-points') return route.fulfill({ json: points });
    if (path === '/api/panels') return route.fulfill({ json: [{ id: 1, name: 'Panel', room_id: null, amperage: 200, fed_from_panel_id: null }] });
    if (path === '/api/circuits') return route.fulfill({ json: [{ id: 1, panel_id: 1, breaker_label: '1', amperage: 20, poles: 1, panel_sticker_text: null, verified_description: null }] });
    if (path.startsWith('/api/floorplan')) {
      if (state.pointLoadFailure) return route.fulfill({ status: 503, json: { detail: 'Point load unavailable' } });
      const floor = decodeURIComponent(path.split('/').at(-1)!);
      const visible = rooms.filter((r) => r.floor === floor);
      return route.fulfill({ json: { rooms: visible, circuit_points: points.filter((p) => visible.some((r) => r.id === p.room_id)) } });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
async function openEditor(page: Page, id = 1) {
  await page.goto('/');
  await page.locator(`[data-room-id="${id}"]`).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Open geometry editor' }).click();
  await expect(page.getByRole('heading', { name: 'Edit geometry for Measured room' })).toBeVisible();
}

test('measured editor preserves exact source, selection, floor and viewport at 390px', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  const map = page.locator('.floorplan-main .floorplan-svg');
  const view = await map.getAttribute('viewBox');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'First wall heading (degrees)' })).toHaveValue('30');
  await expect(page.getByRole('spinbutton', { name: 'Wall 1 inches', exact: true })).toHaveValue(String(120.123456789 - 120));
  await page.getByRole('spinbutton', { name: 'X (ft):', exact: true }).fill('3.025');
  await expect(page.getByText('Mapped points move with the room.')).toBeVisible();
  await expect(map.locator('.draft-room-polygon')).toBeVisible();
  await expect(map.locator('.room-polygon')).toHaveCount(1);
  await expect(map).toHaveAttribute('viewBox', view!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Save room', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Selected room' })).toBeVisible();
  expect(state.patches).toHaveLength(1);
  expect(Object.keys(state.patches[0]).sort()).toEqual(['measurement_source', 'polygon']);
  expect(state.patches[0].measurement_source).toEqual({ ...source, start: { ...source.start, x: 3.025 } });
  await expect(map).toHaveAttribute('viewBox', view!);
  await expect(page.locator('[data-room-id="1"]')).toBeFocused();
  await page.reload();
  await page.locator('[data-room-id="1"]').press('Enter');
  await page.getByRole('button', { name: 'Open geometry editor' }).click();
  await expect(page.getByRole('spinbutton', { name: 'X (ft):', exact: true })).toHaveValue('3.025');
});

test('navigation guard retains failed drafts and supports Stay, Escape, Discard and Save', async ({ page }) => {
  const state = await setup(page);
  await openEditor(page);
  await page.getByRole('spinbutton', { name: 'X (ft):', exact: true }).fill('3.025');
  await page.getByRole('combobox', { name: 'Floor:', exact: true }).selectOption('upper');
  await expect(page.getByRole('alertdialog')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'X (ft):', exact: true })).toHaveValue('3.025');
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  await page.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Floorplan', exact: true })).toBeVisible();
  state.failure = 422;
  await page.evaluate(() => { window.location.hash = 'rooms'; });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Geometry save rejected' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Floorplan', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'X (ft):', exact: true })).toHaveValue('3.025');
  state.failure = 0;
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Rooms', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Floorplan', exact: true }).click();
  await page.locator('[data-room-id="1"]').press('Enter');
  await page.getByRole('button', { name: 'Open geometry editor' }).click();
  await page.getByRole('spinbutton', { name: 'X (ft):', exact: true }).fill('4.025');
  await page.getByRole('combobox', { name: 'Floor:', exact: true }).selectOption('upper');
  await page.getByRole('button', { name: 'Discard and continue' }).click();
  await expect(page.getByRole('combobox', { name: 'Floor:', exact: true })).toHaveValue('upper');
  expect(state.patches).toHaveLength(2);
});

test('Cancel and Escape discard without writes; Escape during save keeps the pending draft', async ({ page }) => {
  const state = await setup(page);
  await openEditor(page);
  await page.getByRole('spinbutton', { name: 'Wall 1 feet', exact: true }).fill('11');
  await expect(page.getByRole('button', { name: 'Save room', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-room-id="1"]')).toBeFocused();
  await page.getByRole('button', { name: 'Open geometry editor' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.patches).toHaveLength(0);
  await page.getByRole('button', { name: 'Open geometry editor' }).click();
  state.delay = true;
  state.failure = 409;
  await page.getByRole('button', { name: 'Save room', exact: true }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('form', { name: /Edit geometry/ })).toBeVisible();
  state.release();
  await expect(page.getByRole('alert').filter({ hasText: 'Geometry save rejected' })).toBeVisible();
  state.failure = 0; state.delay = false;
  await page.getByRole('button', { name: 'Save room', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected room' })).toBeVisible();
});

test('anchored sources round-trip and stale anchors need an explicit placement decision', async ({ page }) => {
  const anchor: Room = { id: 2, name: 'Anchor', floor: 'main', polygon: [[20, 0], [30, 0], [30, 10], [20, 10]], measurement_source: null };
  const anchored: MeasurementSource = { ...source, start: { mode: 'anchor', anchor_room_id: 2, wall_index: 1, corner: 'end', offset_in: 3.123456789, heading_deg: 30 } };
  const room = measured(anchored, 1, [anchor]);
  const state = await setup(page, [room, anchor], []);
  await openEditor(page);
  await expect(page.getByRole('radio', { name: 'Attach to existing room' })).toBeChecked();
  await page.getByRole('button', { name: 'Save room', exact: true }).click();
  expect(state.patches[0].measurement_source).toEqual(anchored);
  await page.goto('about:blank');
  await page.unroute('**/api/**');
  const stale = await setup(page, [room], []);
  await openEditor(page);
  await expect(page.getByText(/saved anchor is missing or invalid/)).toBeVisible();
  await expect(page.locator('.draft-room-polygon')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review saved measurements as replacement' }).click();
  await expect(page.getByRole('button', { name: 'Save room', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'Start fresh' }).check();
  await page.getByRole('button', { name: 'Save room', exact: true }).click();
  await expect.poll(() => stale.patches.length).toBe(1);
  expect(stale.patches[0].measurement_source?.start.mode).toBe('absolute');
});

test('missing and inconsistent sources keep the saved outline until explicit recovery', async ({ page }) => {
  const legacy = { ...measured(), measurement_source: null };
  const state = await setup(page, [legacy], []);
  await openEditor(page);
  await expect(page.getByText(/no saved measurements/)).toBeVisible();
  await expect(page.locator('.draft-room-polygon')).toHaveCount(0);
  await page.getByRole('button', { name: 'Re-measure room' }).click();
  for (let i = 0; i < 4; i++) {
    await page.getByRole('spinbutton', { name: 'New wall feet' }).fill('10.125');
    await page.getByRole('button', { name: 'Add wall', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Save room', exact: true }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0].measurement_source?.walls[0].length_in).toBe(121.5);
  await page.goto('about:blank');
  await page.unroute('**/api/**');
  await setup(page, [{ ...measured(), polygon: [[0, 0], [10, 0], [8, 6], [0, 5]] }], []);
  await openEditor(page);
  await expect(page.locator('.draft-room-polygon')).toHaveCount(0);
  await expect(page.getByText(/no longer match/)).toBeVisible();
  await page.getByRole('button', { name: 'Review saved measurements as replacement' }).click();
  await expect(page.locator('.draft-room-polygon')).toBeVisible();
});

test('point loading and network failures recover without losing the draft', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/');
  await page.locator('[data-room-id="1"]').press('Enter');
  state.pointLoadFailure = true;
  await page.getByRole('button', { name: 'Open geometry editor' }).click();
  await expect(page.getByRole('button', { name: 'Retry loading mapped points' })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'X (ft):', exact: true }).fill('2.025');
  state.pointLoadFailure = false;
  await page.getByRole('button', { name: 'Retry loading mapped points' }).click();
  await expect(page.getByRole('spinbutton', { name: 'X (ft):', exact: true })).toHaveValue('2.025');
  state.networkFailure = true;
  await page.getByRole('button', { name: 'Save room', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Failed to save' })).toBeVisible();
  state.networkFailure = false;
  await page.getByRole('button', { name: 'Save room', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected room' })).toBeVisible();
  expect(state.patches[0]).toEqual(state.patches[1]);
});

test('irregular correction blocks stranded points and Save continues a pending floor change', async ({ page }) => {
  const irregular: MeasurementSource = { unit: 'ft_in', start: { mode: 'absolute', x: 0, y: 0, heading_deg: 0 }, walls: [
    { length_in: 240, turn: 'right' }, { length_in: 120, turn: 'right' },
    { length_in: 120, turn: 'left' }, { length_in: 120, turn: 'right' },
    { length_in: 120, turn: 'right' }, { length_in: 240, turn: 'right' },
  ] };
  const state = await setup(page, [measured(irregular)], [{ ...mapped, x: 15, y: 5 }]);
  await openEditor(page);
  await page.getByRole('spinbutton', { name: 'First wall heading (degrees)' }).fill('180');
  await expect(page.getByRole('alert').filter({ hasText: 'outside the room' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save room', exact: true })).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'First wall heading (degrees)' }).fill('0');
  await page.getByRole('spinbutton', { name: 'X (ft):', exact: true }).fill('2');
  await page.getByRole('combobox', { name: 'Floor:', exact: true }).selectOption('upper');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('combobox', { name: 'Floor:', exact: true })).toHaveValue('upper');
  expect(state.patches).toHaveLength(1);
});

test('direct rectangle correction uses the projected outline for point policy at half-step placement', async ({ page }) => {
  const square = measured({ unit: 'ft_in', start: { mode: 'absolute', x: 0, y: 0, heading_deg: 0 }, walls: Array.from({ length: 4 }, () => ({ length_in: 120, turn: 'right' })) });
  const state = await setup(page, [square]);
  await page.goto('/');
  await page.locator('[data-room-id="1"]').press('Enter');
  await page.getByRole('button', { name: 'Edit room on map' }).click();
  await page.getByText('Fine position (optional)').click();
  await page.getByRole('spinbutton', { name: 'Room X position in feet' }).fill('-0.05');
  const outline = await page.locator('.draft-room-polygon').getAttribute('points');
  const marker = page.locator('[data-point-id="1"]');
  const preview = { x: await marker.getAttribute('cx'), y: await marker.getAttribute('cy') };
  await page.getByRole('button', { name: 'Save room', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected room' })).toBeVisible();
  expect(state.patches[0].polygon?.map(([x, y]) => `${x},${y}`).join(' ')).toBe(outline);
  await expect(marker).toHaveAttribute('cx', preview.x!);
  await expect(marker).toHaveAttribute('cy', preview.y!);
});
