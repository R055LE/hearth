import { expect, test, type Page } from '@playwright/test';

const room = {
  id: 1,
  name: 'Garage',
  floor: 'main',
  polygon: [
    [10, 0],
    [20, 0],
    [20, 10],
    [10, 10],
  ],
  measurement_source: {
    unit: 'ft_in',
    start: { mode: 'absolute', x: 10, y: 0, heading_deg: 0 },
    walls: [
      { length_in: 120, turn: 'right' },
      { length_in: 120, turn: 'right' },
      { length_in: 120, turn: 'right' },
      { length_in: 120, turn: 'right' },
    ],
  },
};

const panel = {
  id: 1,
  name: 'Main panel',
  room_id: 1,
  amperage: 200,
  fed_from_panel_id: null,
};

const circuit = {
  id: 1,
  panel_id: 1,
  breaker_label: '1',
  amperage: 20,
  poles: 1,
  panel_sticker_text: 'Garage outlets',
  verified_description: 'Garage north and east walls',
};

const secondCircuit = {
  ...circuit,
  id: 2,
  breaker_label: '2',
  panel_sticker_text: 'Garage lights',
  verified_description: 'Garage lights and switches',
};

const point = {
  id: 1,
  circuit_id: 1,
  room_id: 1,
  kind: 'outlet',
  x: 12,
  y: 2,
  label: 'North wall outlet',
};

interface ApiState {
  createdPoints: Record<string, unknown>[];
  deletedPointIds: number[];
  updatedPoint: Record<string, unknown> | null;
  updatedRoom: Record<string, unknown> | null;
}

async function mockApi(page: Page): Promise<ApiState> {
  const state: ApiState = {
    createdPoints: [],
    deletedPointIds: [],
    updatedPoint: null,
    updatedRoom: null,
  };
  let storedPoints = [{ ...point }];
  let nextPointId = 2;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/api/rooms' && method === 'GET') {
      await route.fulfill({ json: [room] });
      return;
    }
    if (path === '/api/panels' && method === 'GET') {
      await route.fulfill({ json: [panel] });
      return;
    }
    if (path === '/api/circuits' && method === 'GET') {
      await route.fulfill({ json: [circuit, secondCircuit] });
      return;
    }
    if (path === '/api/floorplan/main' && method === 'GET') {
      await route.fulfill({ json: { rooms: [room], circuit_points: storedPoints } });
      return;
    }
    if (path === '/api/circuit-points' && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      const created = { id: nextPointId++, ...body };
      state.createdPoints.push(body);
      storedPoints.push(created as typeof point);
      await route.fulfill({ status: 201, json: created });
      return;
    }

    const pointRoute = path.match(/^\/api\/circuit-points\/(\d+)$/);
    if (pointRoute && method === 'PATCH') {
      const pointId = Number(pointRoute[1]);
      const body = request.postDataJSON() as Record<string, unknown>;
      state.updatedPoint = body;
      storedPoints = storedPoints.map((stored) =>
        stored.id === pointId ? ({ ...stored, ...body } as typeof point) : stored,
      );
      await route.fulfill({ json: storedPoints.find((stored) => stored.id === pointId) });
      return;
    }
    if (pointRoute && method === 'DELETE') {
      const pointId = Number(pointRoute[1]);
      state.deletedPointIds.push(pointId);
      storedPoints = storedPoints.filter((stored) => stored.id !== pointId);
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === '/api/rooms/1' && method === 'PATCH') {
      state.updatedRoom = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ...room, ...state.updatedRoom } });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unhandled ${method} ${path}` } });
  });

  return state;
}

async function clickFloorplan(page: Page, xRatio: number, yRatio: number) {
  const floorplan = page.locator('.floorplan-svg');
  const box = await floorplan.boundingBox();
  if (!box) throw new Error('Floorplan is not visible');
  await floorplan.click({ position: { x: box.width * xRatio, y: box.height * yRatio } });
}

test('saves the location shown by the latest point preview', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Add point' }).click();
  await clickFloorplan(page, 0.55, 0.65);

  const xInput = page.getByRole('spinbutton', { name: 'X:' });
  const yInput = page.getByRole('spinbutton', { name: 'Y:' });
  const firstCoordinates = [await xInput.inputValue(), await yInput.inputValue()];

  await clickFloorplan(page, 0.48, 0.4);
  const secondCoordinates = [await xInput.inputValue(), await yInput.inputValue()];
  expect(secondCoordinates).not.toEqual(firstCoordinates);

  await page.getByRole('button', { name: 'Create' }).click();
  await expect.poll(() => state.createdPoints.length).toBe(1);
  expect(state.createdPoints[0]).toMatchObject({
    x: Number(secondCoordinates[0]),
    y: Number(secondCoordinates[1]),
    room_id: 1,
  });
});

test('edits point details and moves the preview before saving', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'outlet: North wall outlet' }).click();
  await page.getByRole('button', { name: 'Edit point' }).click();

  await page.getByRole('textbox', { name: 'Label:' }).fill('Discarded edit');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Edit point' }).click();
  await expect(page.getByRole('textbox', { name: 'Label:' })).toHaveValue('North wall outlet');

  await page.getByRole('textbox', { name: 'Label:' }).fill('Workbench outlet');
  await page.getByLabel('Kind:').fill('appliance');
  await page.getByRole('button', { name: 'Move on floorplan' }).click();
  await clickFloorplan(page, 0.6, 0.6);

  const expectedX = Number(await page.getByRole('spinbutton', { name: 'X:' }).inputValue());
  const expectedY = Number(await page.getByRole('spinbutton', { name: 'Y:' }).inputValue());
  const movedMarker = page.getByRole('button', { name: 'appliance: Workbench outlet' });
  await expect(movedMarker).toHaveAttribute('cx', String(expectedX));
  await expect(movedMarker).toHaveAttribute('cy', String(expectedY));

  await page.getByRole('button', { name: 'Save point' }).click();
  await expect.poll(() => state.updatedPoint).not.toBeNull();
  expect(state.updatedPoint).toMatchObject({
    kind: 'appliance',
    label: 'Workbench outlet',
    room_id: 1,
    x: expectedX,
    y: expectedY,
  });
});

test('captures and undoes points while preserving circuit-walk defaults', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Walk circuit' }).click();
  await page.getByRole('combobox', { name: 'Circuit:' }).selectOption('2');
  await page.getByLabel('Kind:').fill('switch');

  await clickFloorplan(page, 0.48, 0.4);
  await expect(page.getByRole('combobox', { name: 'Room:' })).toHaveValue('1');
  await page.locator('.point-form').getByRole('button', { name: 'Add point' }).click();
  await expect(page.getByText('1 point added this walk.')).toBeVisible();

  await clickFloorplan(page, 0.55, 0.6);
  await page.locator('.point-form').getByRole('button', { name: 'Add point' }).click();
  await expect(page.getByText('2 points added this walk.')).toBeVisible();
  expect(state.createdPoints).toHaveLength(2);
  expect(state.createdPoints).toEqual([
    expect.objectContaining({ circuit_id: 2, room_id: 1, kind: 'switch' }),
    expect.objectContaining({ circuit_id: 2, room_id: 1, kind: 'switch' }),
  ]);

  await page.getByRole('button', { name: 'Undo last point' }).click();
  await expect(page.getByText('1 point added this walk.')).toBeVisible();
  expect(state.deletedPointIds).toEqual([3]);

  await page.getByRole('button', { name: 'Finish walk' }).click();
  await expect(page.getByRole('heading', { name: 'Circuit walk' })).not.toBeVisible();
});

test('edits any existing room wall without rewinding later walls', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Rooms' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();

  await page.getByRole('spinbutton', { name: 'Wall 1 feet' }).fill('12');
  await page.getByRole('spinbutton', { name: 'Wall 3 feet' }).fill('12');
  await page.getByRole('button', { name: 'Save room' }).click();

  await expect.poll(() => state.updatedRoom).not.toBeNull();
  expect(state.updatedRoom?.measurement_source).toMatchObject({
    walls: [
      { length_in: 144, turn: 'right' },
      { length_in: 120, turn: 'right' },
      { length_in: 144, turn: 'right' },
      { length_in: 120, turn: 'right' },
    ],
  });
});

test('makes the floorplan controls keyboard-operable and named', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Hearth' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Floorplan' })).toBeVisible();

  const addPoint = page.getByRole('button', { name: 'Add point' });
  const pointButton = page.getByRole('button', { name: 'outlet: North wall outlet' });
  await addPoint.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(pointButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 3, name: 'outlet' })).toBeVisible();

  const circuitButton = page.getByRole('button', { name: /Breaker 1/ });
  await circuitButton.focus();
  await page.keyboard.press('Enter');
  await expect(circuitButton).toHaveClass(/selected/);
});

test('requires confirmation before deleting a point', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'outlet: North wall outlet' }).click();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('cannot be undone');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Delete point' }).click();
  expect(state.deletedPointIds).toEqual([]);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete point' }).click();
  await expect.poll(() => state.deletedPointIds).toEqual([1]);
});

test('keeps circuit-walk controls reachable over the phone floorplan', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.locator('.floorplan-layout')).toHaveCSS('flex-direction', 'column');
  const box = await page.locator('.floorplan-svg').boundingBox();
  expect(box?.width).toBeGreaterThan(330);

  await page.getByRole('button', { name: 'Walk circuit' }).click();
  const walkSidebar = page.locator('.walk-sidebar');
  await expect(walkSidebar).toHaveCSS('position', 'fixed');
  const walkBox = await walkSidebar.boundingBox();
  expect(walkBox?.x).toBeGreaterThanOrEqual(0);
  expect((walkBox?.x ?? 0) + (walkBox?.width ?? 0)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Finish walk' })).toBeVisible();
});
