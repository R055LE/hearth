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
  createdPoint: Record<string, unknown> | null;
  deletedPoint: boolean;
  updatedRoom: Record<string, unknown> | null;
}

async function mockApi(page: Page): Promise<ApiState> {
  const state: ApiState = {
    createdPoint: null,
    deletedPoint: false,
    updatedRoom: null,
  };

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
      await route.fulfill({ json: [circuit] });
      return;
    }
    if (path === '/api/floorplan/main' && method === 'GET') {
      await route.fulfill({
        json: {
          rooms: [room],
          circuit_points: state.deletedPoint ? [] : [point],
        },
      });
      return;
    }
    if (path === '/api/circuit-points' && method === 'POST') {
      state.createdPoint = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, json: { id: 2, ...state.createdPoint } });
      return;
    }
    if (path === '/api/circuit-points/1' && method === 'DELETE') {
      state.deletedPoint = true;
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

test('saves the location shown by the latest point preview', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/');
  const floorplan = page.locator('.floorplan-svg');
  const box = await floorplan.boundingBox();
  if (!box) throw new Error('Floorplan is not visible');

  await page.getByRole('button', { name: 'Add point' }).click();
  await floorplan.click({ position: { x: box.width * 0.75, y: box.height * 0.75 } });

  const xInput = page.getByRole('spinbutton', { name: 'X:' });
  const yInput = page.getByRole('spinbutton', { name: 'Y:' });
  const firstCoordinates = [await xInput.inputValue(), await yInput.inputValue()];

  await floorplan.click({ position: { x: box.width * 0.35, y: box.height * 0.35 } });
  const secondCoordinates = [await xInput.inputValue(), await yInput.inputValue()];
  expect(secondCoordinates).not.toEqual(firstCoordinates);

  await page.getByRole('button', { name: 'Create' }).click();
  await expect.poll(() => state.createdPoint).not.toBeNull();
  expect(state.createdPoint).toMatchObject({
    x: Number(secondCoordinates[0]),
    y: Number(secondCoordinates[1]),
  });
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
  await expect(pointButton).toBeFocused();
  await expect(pointButton).toHaveCSS('outline-style', 'none');
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
  expect(state.deletedPoint).toBe(false);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete point' }).click();
  await expect.poll(() => state.deletedPoint).toBe(true);
});

test('stacks the floorplan and details at phone width', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.locator('.floorplan-layout')).toHaveCSS('flex-direction', 'column');
  const box = await page.locator('.floorplan-svg').boundingBox();
  expect(box?.width).toBeGreaterThan(330);
});
