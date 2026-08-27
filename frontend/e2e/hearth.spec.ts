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

const subpanel = {
  id: 2,
  name: 'Workshop subpanel',
  room_id: 1,
  amperage: 100,
  fed_from_panel_id: 1,
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
  poles: 2,
  panel_sticker_text: 'Garage lights',
  verified_description: null,
};

const subpanelCircuit = {
  ...circuit,
  id: 3,
  panel_id: 2,
  amperage: 15,
  panel_sticker_text: 'Workshop bench',
  verified_description: 'Workshop bench and task lights',
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

interface MaintenanceCompletionFixture {
  id: number;
  task_id: number;
  scheduled_for: string;
  completed_on: string;
}

interface MaintenanceTaskFixture {
  id: number;
  title: string;
  room_id: number | null;
  due_date: string;
  recurrence_days: number | null;
  notes: string | null;
  is_active: boolean;
  completions: MaintenanceCompletionFixture[];
}

function localDate(daysFromToday = 0): string {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maintenanceTask(
  overrides: Partial<MaintenanceTaskFixture> = {},
): MaintenanceTaskFixture {
  return {
    id: 1,
    title: 'Replace furnace filter',
    room_id: 1,
    due_date: localDate(-5),
    recurrence_days: 30,
    notes: 'Use the 16x25x1 filters.',
    is_active: true,
    completions: [],
    ...overrides,
  };
}

interface ApiState {
  completedMaintenanceTask: Record<string, unknown> | null;
  createdMaintenanceTasks: Record<string, unknown>[];
  createdRooms: Record<string, unknown>[];
  createdPoints: Record<string, unknown>[];
  deletedPointIds: number[];
  updatedCircuit: Record<string, unknown> | null;
  updatedPanel: Record<string, unknown> | null;
  updatedPoint: Record<string, unknown> | null;
  updatedRoom: Record<string, unknown> | null;
  updatedMaintenanceTask: Record<string, unknown> | null;
}

async function mockApi(
  page: Page,
  options: {
    maintenanceTasks?: MaintenanceTaskFixture[];
    rooms?: (typeof room)[];
  } = {},
): Promise<ApiState> {
  const state: ApiState = {
    completedMaintenanceTask: null,
    createdMaintenanceTasks: [],
    createdRooms: [],
    createdPoints: [],
    deletedPointIds: [],
    updatedCircuit: null,
    updatedPanel: null,
    updatedPoint: null,
    updatedRoom: null,
    updatedMaintenanceTask: null,
  };
  let storedMaintenanceTasks = (options.maintenanceTasks ?? []).map((task) => ({
    ...task,
    completions: task.completions.map((completion) => ({ ...completion })),
  }));
  let storedRooms = (options.rooms ?? [room]).map((storedRoom) => ({ ...storedRoom }));
  let storedPanels = [{ ...panel }, { ...subpanel }];
  let storedCircuits = [{ ...circuit }, { ...secondCircuit }, { ...subpanelCircuit }];
  let storedPoints = [{ ...point }];
  let nextRoomId = 2;
  let nextPointId = 2;
  let nextMaintenanceTaskId = Math.max(0, ...storedMaintenanceTasks.map((task) => task.id)) + 1;
  let nextCompletionId = 1;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/api/maintenance-tasks' && method === 'GET') {
      await route.fulfill({ json: storedMaintenanceTasks });
      return;
    }
    if (path === '/api/maintenance-tasks' && method === 'POST') {
      const body = request.postDataJSON() as Omit<
        MaintenanceTaskFixture,
        'id' | 'is_active' | 'completions'
      >;
      const created: MaintenanceTaskFixture = {
        id: nextMaintenanceTaskId++,
        ...body,
        is_active: true,
        completions: [],
      };
      state.createdMaintenanceTasks.push(body);
      storedMaintenanceTasks.push(created);
      await route.fulfill({ status: 201, json: created });
      return;
    }

    const maintenanceCompletionRoute = path.match(
      /^\/api\/maintenance-tasks\/(\d+)\/completions$/,
    );
    if (maintenanceCompletionRoute && method === 'POST') {
      const taskId = Number(maintenanceCompletionRoute[1]);
      const body = request.postDataJSON() as { completed_on: string };
      const task = storedMaintenanceTasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        await route.fulfill({ status: 404, json: { detail: 'Maintenance task not found' } });
        return;
      }
      const completion = {
        id: nextCompletionId++,
        task_id: taskId,
        scheduled_for: task.due_date,
        completed_on: body.completed_on,
      };
      task.completions.unshift(completion);
      if (task.recurrence_days == null) task.is_active = false;
      else task.due_date = addDays(body.completed_on, task.recurrence_days);
      state.completedMaintenanceTask = body;
      await route.fulfill({ status: 201, json: task });
      return;
    }

    const maintenanceTaskRoute = path.match(/^\/api\/maintenance-tasks\/(\d+)$/);
    if (maintenanceTaskRoute && method === 'PATCH') {
      const taskId = Number(maintenanceTaskRoute[1]);
      const body = request.postDataJSON() as Record<string, unknown>;
      state.updatedMaintenanceTask = body;
      storedMaintenanceTasks = storedMaintenanceTasks.map((task) =>
        task.id === taskId ? ({ ...task, ...body } as MaintenanceTaskFixture) : task,
      );
      await route.fulfill({
        json: storedMaintenanceTasks.find((task) => task.id === taskId),
      });
      return;
    }

    if (path === '/api/rooms' && method === 'GET') {
      await route.fulfill({ json: storedRooms });
      return;
    }
    if (path === '/api/rooms' && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      const created = { id: nextRoomId++, ...body };
      state.createdRooms.push(body);
      storedRooms.push(created as typeof room);
      await route.fulfill({ status: 201, json: created });
      return;
    }
    if (path === '/api/panels' && method === 'GET') {
      await route.fulfill({ json: storedPanels });
      return;
    }
    if (path === '/api/circuits' && method === 'GET') {
      await route.fulfill({ json: storedCircuits });
      return;
    }
    if (path === '/api/floorplan/main' && method === 'GET') {
      await route.fulfill({
        json: {
          rooms: storedRooms.filter((storedRoom) => storedRoom.floor === 'main'),
          circuit_points: storedPoints,
        },
      });
      return;
    }
    if (path === '/api/circuit-points' && method === 'GET') {
      await route.fulfill({ json: storedPoints });
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

    const panelRoute = path.match(/^\/api\/panels\/(\d+)$/);
    if (panelRoute && method === 'PATCH') {
      const panelId = Number(panelRoute[1]);
      const body = request.postDataJSON() as Record<string, unknown>;
      state.updatedPanel = body;
      storedPanels = storedPanels.map((stored) =>
        stored.id === panelId ? ({ ...stored, ...body } as typeof panel) : stored,
      );
      await route.fulfill({ json: storedPanels.find((stored) => stored.id === panelId) });
      return;
    }

    const circuitRoute = path.match(/^\/api\/circuits\/(\d+)$/);
    if (circuitRoute && method === 'PATCH') {
      const circuitId = Number(circuitRoute[1]);
      const body = request.postDataJSON() as Record<string, unknown>;
      state.updatedCircuit = body;
      storedCircuits = storedCircuits.map((stored) =>
        stored.id === circuitId ? ({ ...stored, ...body } as typeof circuit) : stored,
      );
      await route.fulfill({ json: storedCircuits.find((stored) => stored.id === circuitId) });
      return;
    }
    if (path === '/api/rooms/1' && method === 'PATCH') {
      state.updatedRoom = request.postDataJSON() as Record<string, unknown>;
      storedRooms = storedRooms.map((stored) =>
        stored.id === 1 ? ({ ...stored, ...state.updatedRoom } as typeof room) : stored,
      );
      await route.fulfill({ json: storedRooms.find((stored) => stored.id === 1) });
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

test('groups maintenance work and keeps creation contextual on mobile', async ({ page }) => {
  const state = await mockApi(page, {
    maintenanceTasks: [
      maintenanceTask(),
      maintenanceTask({ id: 2, title: 'Test smoke alarms', due_date: localDate() }),
      maintenanceTask({ id: 3, title: 'Clean gutters', due_date: localDate(20) }),
      maintenanceTask({
        id: 4,
        title: 'Seal driveway',
        due_date: localDate(-30),
        recurrence_days: null,
        is_active: false,
        completions: [
          {
            id: 1,
            task_id: 4,
            scheduled_for: localDate(-30),
            completed_on: localDate(-2),
          },
        ],
      }),
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Maintenance' }).click();

  await expect(page.getByRole('heading', { name: 'Overdue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Due today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  const completed = page.getByRole('article', { name: 'Seal driveway' });
  await expect(completed.getByRole('button', { name: 'Edit Seal driveway' })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);

  const addTask = page.getByRole('button', { name: 'Add task' });
  await addTask.click();
  const form = page.getByRole('form', { name: 'Add maintenance task' });
  await form.getByRole('textbox', { name: 'Task' }).fill('Flush water heater');
  await form.getByRole('combobox', { name: 'Room' }).selectOption('1');
  await form.getByLabel('Due date').fill(localDate(14));
  await form.getByRole('combobox', { name: 'Schedule' }).selectOption('repeat');
  await form.getByRole('spinbutton', { name: 'Interval days' }).fill('180');
  await form.getByRole('textbox', { name: 'Notes' }).fill('Drain until the water runs clear.');
  await form.getByRole('button', { name: 'Cancel adding task' }).click();
  expect(state.createdMaintenanceTasks).toEqual([]);
  await expect(page.locator('form')).toHaveCount(0);

  await addTask.click();
  const savedForm = page.getByRole('form', { name: 'Add maintenance task' });
  await savedForm.getByRole('textbox', { name: 'Task' }).fill('Flush water heater');
  await savedForm.getByLabel('Due date').fill(localDate(14));
  await savedForm.getByRole('button', { name: 'Create task' }).click();

  await expect.poll(() => state.createdMaintenanceTasks).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'Flush water heater' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('edits maintenance tasks through a discardable draft', async ({ page }) => {
  const state = await mockApi(page, {
    maintenanceTasks: [maintenanceTask({ due_date: localDate(10) })],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Maintenance' }).click();

  const task = page.getByRole('article', { name: 'Replace furnace filter' });
  await task.getByRole('button', { name: 'Edit Replace furnace filter' }).click();
  const form = page.getByRole('form', { name: 'Edit Replace furnace filter' });
  await form.getByRole('textbox', { name: 'Task' }).fill('Discarded title');
  await form.getByRole('button', { name: 'Cancel task edit' }).click();
  expect(state.updatedMaintenanceTask).toBeNull();

  await task.getByRole('button', { name: 'Edit Replace furnace filter' }).click();
  const savedForm = page.getByRole('form', { name: 'Edit Replace furnace filter' });
  await expect(savedForm.getByRole('textbox', { name: 'Task' })).toHaveValue(
    'Replace furnace filter',
  );
  await savedForm.getByRole('textbox', { name: 'Task' }).fill('Replace HVAC filter');
  await savedForm.getByRole('combobox', { name: 'Schedule' }).selectOption('once');
  await savedForm.getByRole('button', { name: 'Save task' }).click();

  await expect.poll(() => state.updatedMaintenanceTask).not.toBeNull();
  expect(state.updatedMaintenanceTask).toMatchObject({
    title: 'Replace HVAC filter',
    recurrence_days: null,
  });
  await expect(page.getByRole('heading', { name: 'Replace HVAC filter' })).toBeVisible();
});

test('completes maintenance through a dated draft and preserves history', async ({ page }) => {
  const state = await mockApi(page, { maintenanceTasks: [maintenanceTask()] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Maintenance' }).click();

  const task = page.getByRole('article', { name: 'Replace furnace filter' });
  await task.getByRole('button', { name: 'Complete Replace furnace filter' }).click();
  const form = page.getByRole('form', { name: 'Complete Replace furnace filter' });
  await expect(form.getByLabel('Completion date')).toHaveValue(localDate());
  await form.getByRole('button', { name: 'Cancel completion' }).click();
  expect(state.completedMaintenanceTask).toBeNull();

  await task.getByRole('button', { name: 'Complete Replace furnace filter' }).click();
  await page
    .getByRole('form', { name: 'Complete Replace furnace filter' })
    .getByRole('button', { name: 'Save completion' })
    .click();

  await expect.poll(() => state.completedMaintenanceTask).toEqual({
    completed_on: localDate(),
  });
  await expect(page.getByRole('heading', { name: 'Replace furnace filter' })).toBeVisible();
  await expect(page.getByText(`Next due ${addDays(localDate(), 30)}`)).toBeVisible();
  await page.getByText('History (1)').click();
  await expect(page.getByText(`Completed ${localDate()} for ${localDate(-5)}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

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

test('explains how to choose a location while adding a point', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Add point' }).click();

  await expect(
    page.getByText('Click the floorplan to choose a location for the new point.'),
  ).toBeVisible();
  await expect(
    page.getByText('Click a point on the floorplan, or a circuit below, to see details.'),
  ).not.toBeVisible();
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

  await expect(page.getByRole('group', { name: 'Placement' })).not.toBeVisible();
  await expect(page.getByRole('group', { name: 'Walls' })).not.toBeVisible();
  await expect(page.getByText(/This room has 1 circuit point/)).not.toBeVisible();

  await page.getByRole('button', { name: 'Edit room geometry for Garage' }).click();
  await expect(page.getByRole('group', { name: 'Placement' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Walls' })).toBeVisible();
  await expect(page.getByText(/This room has 1 circuit point/)).toBeVisible();
  await expect(page.locator('.room-builder .floorplan-svg')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'New wall turn' })).toBeVisible();

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

test('puts room geometry save actions after the mobile preview', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rooms' }).click();
  await page.getByRole('button', { name: 'Edit room geometry for Garage' }).click();

  const preview = page.locator('.room-builder .floorplan-svg');
  const saveRoom = page.getByRole('button', { name: 'Save room' });
  const previewBox = await preview.boundingBox();
  const saveBox = await saveRoom.boundingBox();

  expect(previewBox).not.toBeNull();
  expect(saveBox).not.toBeNull();
  expect(saveBox?.y).toBeGreaterThan((previewBox?.y ?? 0) + (previewBox?.height ?? 0));
});

test('edits room metadata without opening geometry or changing mapped points', async ({ page }) => {
  const state = await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rooms' }).click();

  const editDetails = page.getByRole('button', { name: 'Edit room details for Garage' });
  await editDetails.click();

  const detailsForm = page.getByRole('form', { name: 'Edit room details for Garage' });
  await expect(detailsForm.getByRole('textbox', { name: 'Room name' })).toHaveValue('Garage');
  await expect(detailsForm.getByRole('textbox', { name: 'Room floor' })).toHaveValue('main');
  await expect(page.getByRole('group', { name: 'Placement' })).not.toBeVisible();
  await expect(page.getByRole('group', { name: 'Walls' })).not.toBeVisible();
  await expect(page.locator('.room-builder .floorplan-svg')).not.toBeVisible();
  await expect(page.getByText(/circuit point/)).not.toBeVisible();

  await detailsForm.getByRole('textbox', { name: 'Room name' }).fill('Discarded name');
  await detailsForm.getByRole('button', { name: 'Cancel' }).click();
  expect(state.updatedRoom).toBeNull();

  await editDetails.click();
  const savedDetailsForm = page.getByRole('form', { name: 'Edit room details for Garage' });
  await expect(savedDetailsForm.getByRole('textbox', { name: 'Room name' })).toHaveValue('Garage');
  await savedDetailsForm.getByRole('textbox', { name: 'Room name' }).fill('Workshop');
  await savedDetailsForm.getByRole('button', { name: 'Save details' }).click();

  await expect.poll(() => state.updatedRoom).toEqual({ name: 'Workshop', floor: 'main' });
  expect(state.updatedPoint).toBeNull();
  await expect(page.getByRole('cell', { name: 'Workshop', exact: true })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('keeps long room labels inside room geometry at desktop and phone width', async ({ page }) => {
  const longRoom = {
    ...room,
    name: 'Mechanical and Utility Equipment Storage Room',
    polygon: [
      [10, 0],
      [16, 0],
      [16, 6],
      [10, 6],
    ],
  };
  await mockApi(page, { rooms: [longRoom] });

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const roomBox = await page.locator('.room-polygon').boundingBox();
    const label = page.locator('.room-label');
    const labelBox = await label.boundingBox();
    expect(roomBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    await expect(label).toHaveText(longRoom.name);
    expect(await label.locator('tspan').count()).toBeGreaterThan(1);
    expect(labelBox?.x).toBeGreaterThanOrEqual((roomBox?.x ?? 0) - 1);
    expect(labelBox?.y).toBeGreaterThanOrEqual((roomBox?.y ?? 0) - 1);
    expect((labelBox?.x ?? 0) + (labelBox?.width ?? 0)).toBeLessThanOrEqual(
      (roomBox?.x ?? 0) + (roomBox?.width ?? 0) + 1,
    );
    expect((labelBox?.y ?? 0) + (labelBox?.height ?? 0)).toBeLessThanOrEqual(
      (roomBox?.y ?? 0) + (roomBox?.height ?? 0) + 1,
    );
  }
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

  const circuitButton = page.getByRole('button', { name: /Breaker 1 — Garage/ });
  await circuitButton.focus();
  await page.keyboard.press('Enter');
  await expect(circuitButton).toHaveClass(/selected/);
});

test('keeps point placement unavailable until a room exists', async ({ page }) => {
  await mockApi(page, { rooms: [] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Add point' })).toBeDisabled();
  await expect(page.getByText('Add a room before placing points on the floorplan.')).toBeVisible();

  const addRoom = page.getByRole('button', { name: 'Add a room' });
  await addRoom.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 2, name: 'Rooms' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add room', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('shows panel status and opens mapped breakers on the floorplan', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Panels & circuits' }).click();

  const mainPanel = page.getByRole('region', { name: 'Main panel breaker directory' });
  const mappedBreaker = mainPanel.locator('.breaker-slot').filter({
    hasText: 'Garage north and east walls',
  });
  const unmappedBreaker = mainPanel.locator('.breaker-slot').filter({ hasText: 'Garage lights' });

  await expect(page.getByText('Feeds Workshop subpanel.')).toBeVisible();
  await expect(page.getByText('Fed from Main panel.')).toBeVisible();
  await expect(mappedBreaker.getByText('1 mapped point', { exact: true })).toBeVisible();
  await expect(mappedBreaker.getByText('Verified', { exact: true })).toBeVisible();
  await expect(unmappedBreaker.getByText('Unmapped', { exact: true })).toBeVisible();
  await expect(unmappedBreaker.getByText('Needs verification', { exact: true })).toBeVisible();
  await expect(
    unmappedBreaker.getByRole('button', { name: 'View breaker 2 on floorplan' }),
  ).toBeDisabled();

  const mappedBox = await mappedBreaker.boundingBox();
  const unmappedBox = await unmappedBreaker.boundingBox();
  expect(unmappedBox?.height).toBeGreaterThan(mappedBox?.height ?? 0);

  await mappedBreaker.getByRole('button', { name: 'View breaker 1 on floorplan' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Floorplan' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Breaker 1 — Garage/ })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'outlet: North wall outlet' })).toHaveAttribute(
    'stroke',
    '#f97316',
  );
});

test('edits panels and breakers without saving cancelled drafts', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Panels & circuits' }).click();

  const mainPanel = page.locator('.panel-card').filter({ hasText: 'Main panel' });
  await mainPanel.getByRole('button', { name: 'Edit panel Main panel' }).click();
  await mainPanel.getByRole('textbox', { name: 'Panel name' }).fill('Discarded panel name');
  await mainPanel.getByRole('button', { name: 'Cancel panel edit' }).click();
  expect(state.updatedPanel).toBeNull();

  await mainPanel.getByRole('button', { name: 'Edit panel Main panel' }).click();
  await expect(mainPanel.getByRole('textbox', { name: 'Panel name' })).toHaveValue('Main panel');
  await mainPanel.getByRole('textbox', { name: 'Panel name' }).fill('Service panel');
  await mainPanel.getByRole('spinbutton', { name: 'Panel amperage' }).fill('225');
  await mainPanel.getByRole('button', { name: 'Save panel' }).click();
  await expect.poll(() => state.updatedPanel).not.toBeNull();
  expect(state.updatedPanel).toMatchObject({ name: 'Service panel', amperage: 225 });
  await expect(page.getByRole('heading', { name: 'Service panel 225A' })).toBeVisible();

  const mappedBreaker = page.locator('.breaker-slot[data-circuit-id="1"]');
  await mappedBreaker.getByRole('button', { name: 'Edit breaker 1' }).click();
  await mappedBreaker.getByRole('textbox', { name: 'Verified description' }).fill('Discarded circuit');
  await mappedBreaker.getByRole('button', { name: 'Cancel breaker edit' }).click();
  expect(state.updatedCircuit).toBeNull();

  await mappedBreaker.getByRole('button', { name: 'Edit breaker 1' }).click();
  await expect(mappedBreaker.getByRole('textbox', { name: 'Verified description' })).toHaveValue(
    'Garage north and east walls',
  );
  await mappedBreaker.getByRole('textbox', { name: 'Breaker label' }).fill('3');
  await mappedBreaker.getByRole('spinbutton', { name: 'Breaker amperage' }).fill('30');
  await mappedBreaker.getByRole('combobox', { name: 'Breaker poles' }).selectOption('2');
  await mappedBreaker
    .getByRole('textbox', { name: 'Verified description' })
    .fill('Garage workshop outlets');
  await mappedBreaker.getByRole('button', { name: 'Save breaker' }).click();

  await expect.poll(() => state.updatedCircuit).not.toBeNull();
  expect(state.updatedCircuit).toMatchObject({
    breaker_label: '3',
    amperage: 30,
    poles: 2,
    verified_description: 'Garage workshop outlets',
  });
  await expect(page.getByRole('heading', { name: 'Garage workshop outlets' })).toBeVisible();
});

test('keeps add forms hidden until requested and names destructive controls', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Panels & circuits' }).click();

  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete panel Main panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete panel Workshop subpanel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete breaker 1 from Main panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete breaker 2 from Main panel' })).toBeVisible();

  await page.getByRole('button', { name: 'Add panel' }).click();
  await expect(page.getByRole('form', { name: 'Add panel' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel adding panel' }).click();
  await expect(page.locator('form')).toHaveCount(0);

  const mainPanel = page.locator('.panel-card').filter({ hasText: 'Main panel' });
  await mainPanel.getByRole('button', { name: 'Add circuit to Main panel' }).click();
  const addCircuit = mainPanel.getByRole('form', { name: 'Add circuit to Main panel' });
  await expect(addCircuit.getByRole('textbox', { name: 'Breaker label' })).toBeVisible();
  await expect(addCircuit.getByRole('combobox', { name: 'Breaker poles' })).toBeVisible();
});

test('keeps room creation hidden until requested and collapses it after cancel or save', async ({ page }) => {
  const state = await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rooms' }).click();

  await expect(page.locator('form')).toHaveCount(0);
  const addRoom = page.getByRole('button', { name: 'Add room', exact: true });
  await expect(addRoom).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Actions' })).toBeVisible();

  await addRoom.click();
  await expect(page.getByRole('heading', { name: 'Add room' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(state.createdRooms).toEqual([]);
  await expect(page.locator('form')).toHaveCount(0);

  await addRoom.click();
  await page.getByRole('textbox', { name: 'Name:' }).fill('Storage');
  const wallFeet = page.getByPlaceholder('ft');
  for (let wall = 0; wall < 4; wall += 1) {
    await wallFeet.fill('10');
    await page.getByRole('button', { name: 'Add wall' }).click();
  }
  await page.getByRole('button', { name: 'Create room' }).click();

  await expect.poll(() => state.createdRooms).toHaveLength(1);
  await expect(page.getByRole('cell', { name: 'Storage', exact: true })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  await expect(addRoom).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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

  await clickFloorplan(page, 0.48, 0.4);
  const addPoint = page.locator('.point-form').getByRole('button', { name: 'Add point' });
  await expect(addPoint).toBeInViewport();
  expect(await walkSidebar.evaluate((element) => element.scrollTop)).toBe(0);
});

test('keeps panel controls contained at phone width', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Panels & circuits' }).click();

  await expect(page.locator('form')).toHaveCount(0);

  const mainPanel = page.locator('.panel-card').first();
  const deletePanel = mainPanel.getByRole('button', { name: 'Delete panel' });
  const deleteBox = await deletePanel.boundingBox();
  expect(deleteBox?.height).toBeLessThan(50);
  await expect(
    page.getByLabel('Workshop subpanel mapping coverage').locator('span').first(),
  ).toHaveText('1 circuit');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
