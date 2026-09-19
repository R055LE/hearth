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
  retired: boolean;
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
    retired: false,
    completions: [],
    ...overrides,
  };
}

interface ApiState {
  completedMaintenanceTask: Record<string, unknown> | null;
  createdMaintenanceTasks: Record<string, unknown>[];
  maintenanceLifecycleRequests: {
    action: 'retire' | 'restore';
    taskId: number;
    next_due_date?: string;
  }[];
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
    failedMaintenanceActions?: ('retire' | 'restore')[];
    failRoomRefreshAfterSave?: boolean;
    failRoomSave?: boolean;
    rooms?: (typeof room)[];
    points?: (typeof point)[];
    panels?: { id: number; name: string; room_id: number | null; amperage: number; fed_from_panel_id: number | null }[];
  } = {},
): Promise<ApiState> {
  const state: ApiState = {
    completedMaintenanceTask: null,
    createdMaintenanceTasks: [],
    maintenanceLifecycleRequests: [],
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
  let storedPanels = (options.panels ?? [panel, subpanel]).map((stored) => ({ ...stored }));
  let storedCircuits = [{ ...circuit }, { ...secondCircuit }, { ...subpanelCircuit }];
  let storedPoints = (options.points ?? [point]).map((stored) => ({ ...stored }));
  let roomSaved = false;
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
        'id' | 'is_active' | 'retired' | 'completions'
      >;
      const created: MaintenanceTaskFixture = {
        id: nextMaintenanceTaskId++,
        ...body,
        is_active: true,
        retired: false,
        completions: [],
      };
      state.createdMaintenanceTasks.push(body);
      storedMaintenanceTasks.push(created);
      await route.fulfill({ status: 201, json: created });
      return;
    }

    const maintenanceLifecycleRoute = path.match(
      /^\/api\/maintenance-tasks\/(\d+)\/(retire|restore)$/,
    );
    if (maintenanceLifecycleRoute && method === 'POST') {
      const taskId = Number(maintenanceLifecycleRoute[1]);
      const action = maintenanceLifecycleRoute[2] as 'retire' | 'restore';
      const task = storedMaintenanceTasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        await route.fulfill({ status: 404, json: { detail: 'Maintenance task not found' } });
        return;
      }

      const body = action === 'restore'
        ? request.postDataJSON() as { next_due_date: string }
        : undefined;
      state.maintenanceLifecycleRequests.push({ action, taskId, ...body });
      if (options.failedMaintenanceActions?.includes(action)) {
        const pastTense = action === 'retire' ? 'retired' : 'restored';
        await route.fulfill({
          status: 409,
          json: { detail: `Maintenance task could not be ${pastTense}` },
        });
        return;
      }

      task.retired = action === 'retire';
      if (body) task.due_date = body.next_due_date;
      await route.fulfill({ json: task });
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
      if (roomSaved && options.failRoomRefreshAfterSave) {
        await route.fulfill({ status: 503, json: { detail: 'Refresh unavailable' } });
        return;
      }
      await route.fulfill({ json: storedRooms });
      return;
    }
    if (path === '/api/rooms' && method === 'POST') {
      if (options.failRoomSave) {
        await route.fulfill({ status: 409, json: { detail: 'Room could not be saved' } });
        return;
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      const created = { id: nextRoomId++, ...body };
      state.createdRooms.push(body);
      storedRooms.push(created as typeof room);
      roomSaved = true;
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
    if (path.startsWith('/api/floorplan/') && method === 'GET') {
      if (roomSaved && options.failRoomRefreshAfterSave) {
        await route.fulfill({ status: 503, json: { detail: 'Refresh unavailable' } });
        return;
      }
      const floorRooms = storedRooms.filter((storedRoom) => storedRoom.floor === decodeURIComponent(path.slice('/api/floorplan/'.length)));
      await route.fulfill({
        json: {
          rooms: floorRooms,
          circuit_points: storedPoints.filter((storedPoint) => floorRooms.some((floorRoom) => floorRoom.id === storedPoint.room_id)),
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
    const roomRoute = path.match(/^\/api\/rooms\/(\d+)$/);
    if (roomRoute && method === 'PATCH') {
      if (options.failRoomSave) {
        await route.fulfill({ status: 409, json: { detail: 'Room could not be saved' } });
        return;
      }
      const roomId = Number(roomRoute[1]);
      state.updatedRoom = request.postDataJSON() as Record<string, unknown>;
      const previous = storedRooms.find((stored) => stored.id === roomId);
      const nextPolygon = state.updatedRoom.polygon as number[][] | undefined;
      if (previous && nextPolygon && previous.polygon.length === 4 && nextPolygon.length === 4) {
        const bounds = (polygon: number[][]) => ({
          x: Math.min(...polygon.map(([x]) => x)),
          y: Math.min(...polygon.map(([, y]) => y)),
          length: Math.max(...polygon.map(([x]) => x)) - Math.min(...polygon.map(([x]) => x)),
          width: Math.max(...polygon.map(([, y]) => y)) - Math.min(...polygon.map(([, y]) => y)),
        });
        const from = bounds(previous.polygon);
        const to = bounds(nextPolygon);
        storedPoints = storedPoints.map((stored) => stored.room_id === roomId ? {
          ...stored,
          x: to.x + ((stored.x - from.x) / from.length) * to.length,
          y: to.y + ((stored.y - from.y) / from.width) * to.width,
        } : stored);
      }
      storedRooms = storedRooms.map((stored) =>
        stored.id === roomId ? ({ ...stored, ...state.updatedRoom } as typeof room) : stored,
      );
      roomSaved = true;
      await route.fulfill({ json: storedRooms.find((stored) => stored.id === roomId) });
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

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`restores section URLs on direct loads and refresh at ${viewport.width}px`, async ({ page }) => {
    await mockApi(page, { maintenanceTasks: [maintenanceTask()] });
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.method() !== 'GET') {
        writes.push(request.method());
      }
    });
    await page.setViewportSize(viewport);
    for (const [fragment, heading] of [
      ['floorplan', 'Floorplan'],
      ['rooms', 'Rooms'],
      ['panels', 'Panels & circuits'],
      ['maintenance', 'Maintenance'],
    ]) {
      await page.goto(`/#${fragment}`);
      await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
      await expect(page.locator('nav .active')).toHaveText(heading);
      await page.reload();
      await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#${fragment}$`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    }
    await expect(page.getByRole('article', { name: 'Replace furnace filter' })).toBeVisible();
    for (const url of ['/', '/#unknown-section']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 2, name: 'Floorplan', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { level: 2, name: 'Floorplan', exact: true })).toBeVisible();
    }
    expect(writes).toEqual([]);
  });

  test(`navigates browser history without losing maintenance drafts at ${viewport.width}px`, async ({ page }) => {
    const state = await mockApi(page);
    await page.setViewportSize(viewport);
    await page.goto('/');
    for (const [name, fragment] of [
      ['Rooms', 'rooms'],
      ['Panels & circuits', 'panels'],
      ['Maintenance', 'maintenance'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#${fragment}$`));
    }
    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    const form = page.getByRole('form', { name: 'Add maintenance task' });
    await form.getByRole('textbox', { name: 'Task', exact: true }).fill('Keep this draft');
    // Selecting the current section must not add a duplicate history entry.
    await page.getByRole('button', { name: 'Maintenance', exact: true }).click();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2, name: 'Panels & circuits' })).toBeVisible();
    await expect(form).toBeHidden();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2, name: 'Rooms', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2, name: 'Floorplan' })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { level: 2, name: 'Rooms', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { level: 2, name: 'Panels & circuits' })).toBeVisible();
    await page.goForward();
    await expect(form).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'Task', exact: true })).toHaveValue('Keep this draft');
    expect(state.createdMaintenanceTasks).toEqual([]);
    await form.getByRole('button', { name: 'Cancel adding task', exact: true }).click();
    await expect(form).toBeHidden();
    expect(state.createdMaintenanceTasks).toEqual([]);
  });

  test(`preserves maintenance drafts across sections at ${viewport.width}px`, async ({ page }) => {
    const state = await mockApi(page);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.method() !== 'GET') {
        writes.push(request.method());
      }
    });
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'Maintenance', exact: true }).click();
    await page.getByRole('button', { name: 'Add task', exact: true }).click();

    const form = page.getByRole('form', { name: 'Add maintenance task' });
    const dueDate = localDate(14);
    await form.getByRole('textbox', { name: 'Task', exact: true }).fill('Replace HVAC filter');
    await form.getByRole('combobox', { name: 'Room', exact: true }).selectOption('1');
    await form.getByLabel('Due date').fill(dueDate);
    await form.getByRole('combobox', { name: 'Schedule' }).selectOption('repeat');
    await form.getByRole('spinbutton', { name: 'Interval days' }).fill('90');
    await form.getByRole('textbox', { name: 'Notes' }).fill('Use the spare filter.');

    for (const section of ['Rooms', 'Panels & circuits', 'Floorplan']) {
      await page.getByRole('button', { name: section, exact: true }).click();
      await expect(form).toBeHidden();
      await page.getByRole('button', { name: 'Maintenance', exact: true }).click();
      await expect(form).toBeVisible();
      await expect(form.getByRole('textbox', { name: 'Task', exact: true })).toHaveValue(
        'Replace HVAC filter',
      );
      await expect(form.getByRole('combobox', { name: 'Room', exact: true })).toHaveValue('1');
      await expect(form.getByLabel('Due date')).toHaveValue(dueDate);
      await expect(form.getByRole('combobox', { name: 'Schedule' })).toHaveValue('repeat');
      await expect(form.getByRole('spinbutton', { name: 'Interval days' })).toHaveValue('90');
      await expect(form.getByRole('textbox', { name: 'Notes' })).toHaveValue('Use the spare filter.');
    }
    expect(writes).toEqual([]);
    expect(state.createdMaintenanceTasks).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );

    await page.getByRole('button', { name: 'Rooms', exact: true }).click();
    await page.getByRole('button', { name: 'Edit room details for Garage' }).click();
    await page.getByRole('textbox', { name: 'Room name', exact: true }).fill('Garage workshop');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect.poll(() => state.updatedRoom).toMatchObject({ name: 'Garage workshop' });
    await page.getByRole('button', { name: 'Maintenance', exact: true }).click();
    await expect(form.getByRole('combobox', { name: 'Room', exact: true }).locator('option:checked'))
      .toHaveText('Garage workshop');
    expect(state.createdMaintenanceTasks).toEqual([]);

    await form.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('article', { name: 'Replace HVAC filter' })).toBeVisible();
    expect(state.createdMaintenanceTasks).toEqual([{
      title: 'Replace HVAC filter',
      room_id: 1,
      due_date: dueDate,
      recurrence_days: 90,
      notes: 'Use the spare filter.',
    }]);
    expect(writes).toEqual(['PATCH', 'POST']);

    await page.getByRole('button', { name: 'Rooms', exact: true }).click();
    await page.getByRole('button', { name: 'Maintenance', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(page.getByRole('article', { name: 'Replace HVAC filter' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(form.getByRole('textbox', { name: 'Task', exact: true })).toHaveValue('');
  });
}

test('groups maintenance work and keeps creation contextual on mobile', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET') {
      writes.push(request.method());
    }
  });
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
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  await page.getByRole('button', { name: 'Maintenance', exact: true }).click();
  await form.getByRole('button', { name: 'Cancel adding task' }).click();
  expect(writes).toEqual([]);
  expect(state.createdMaintenanceTasks).toEqual([]);
  await expect(page.locator('form')).toHaveCount(0);

  await addTask.click();
  const savedForm = page.getByRole('form', { name: 'Add maintenance task' });
  await expect(savedForm.getByRole('textbox', { name: 'Task', exact: true })).toHaveValue('');
  await expect(savedForm.getByRole('combobox', { name: 'Room', exact: true })).toHaveValue('');
  await expect(savedForm.getByLabel('Due date')).toHaveValue(localDate());
  await expect(savedForm.getByRole('combobox', { name: 'Schedule' })).toHaveValue('once');
  await expect(savedForm.getByRole('textbox', { name: 'Notes' })).toHaveValue('');
  await savedForm.getByRole('combobox', { name: 'Schedule' }).selectOption('repeat');
  await expect(savedForm.getByRole('spinbutton', { name: 'Interval days' })).toHaveValue('30');
  await savedForm.getByRole('combobox', { name: 'Schedule' }).selectOption('once');
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

test('retires and restores recurring maintenance without losing history', async ({ page }) => {
  const state = await mockApi(page, {
    maintenanceTasks: [
      maintenanceTask({
        due_date: localDate(-5),
        completions: [
          {
            id: 1,
            task_id: 1,
            scheduled_for: localDate(-35),
            completed_on: localDate(-34),
          },
        ],
      }),
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Maintenance' }).click();

  let task = page.getByRole('article', { name: 'Replace furnace filter' });
  await task.getByRole('button', { name: 'Retire Replace furnace filter' }).click();
  let form = task.getByRole('form', { name: 'Retire Replace furnace filter' });
  await expect(form).toContainText('details and completion history will be kept');
  await form.getByRole('button', { name: 'Cancel retirement' }).click();
  expect(state.maintenanceLifecycleRequests).toEqual([]);

  await task.getByRole('button', { name: 'Retire Replace furnace filter' }).click();
  form = task.getByRole('form', { name: 'Retire Replace furnace filter' });
  await form.getByRole('button', { name: 'Retire task' }).click();

  await expect.poll(() => state.maintenanceLifecycleRequests).toEqual([
    { action: 'retire', taskId: 1 },
  ]);
  await expect(page.getByRole('heading', { name: 'Retired', exact: true })).toBeVisible();
  task = page.getByRole('article', { name: 'Replace furnace filter' });
  await expect(task.getByRole('button', { name: 'Complete Replace furnace filter' })).toHaveCount(0);
  await expect(task).toContainText('Every 30 days');
  await task.getByText('History (1)').click();
  await expect(
    task.getByText(`Completed ${localDate(-34)} for ${localDate(-35)}`),
  ).toBeVisible();

  await task.getByRole('button', { name: 'Restore Replace furnace filter' }).click();
  form = task.getByRole('form', { name: 'Restore Replace furnace filter' });
  await expect(form.getByLabel('Next due date')).toHaveValue('');
  await form.getByLabel('Next due date').fill(localDate(20));
  await form.getByRole('button', { name: 'Cancel restoration' }).click();
  expect(state.maintenanceLifecycleRequests).toHaveLength(1);

  await task.getByRole('button', { name: 'Restore Replace furnace filter' }).click();
  form = task.getByRole('form', { name: 'Restore Replace furnace filter' });
  await form.getByLabel('Next due date').fill(localDate(20));
  await form.getByRole('button', { name: 'Restore task' }).click();

  await expect.poll(() => state.maintenanceLifecycleRequests).toEqual([
    { action: 'retire', taskId: 1 },
    { action: 'restore', taskId: 1, next_due_date: localDate(20) },
  ]);
  task = page.getByRole('article', { name: 'Replace furnace filter' });
  await expect(task).toContainText(`Next due ${localDate(20)}`);
  await expect(task).toContainText('Every 30 days');
  await expect(task.getByText('History (1)')).toBeVisible();
  await expect(task.getByRole('button', { name: 'Complete Replace furnace filter' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('keeps failed maintenance lifecycle forms recoverable', async ({ page }) => {
  const state = await mockApi(page, {
    maintenanceTasks: [
      maintenanceTask(),
      maintenanceTask({ id: 2, title: 'Clean gutters', retired: true }),
    ],
    failedMaintenanceActions: ['retire', 'restore'],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Maintenance' }).click();

  const activeTask = page.getByRole('article', { name: 'Replace furnace filter' });
  await activeTask.getByRole('button', { name: 'Retire Replace furnace filter' }).click();
  const retireForm = activeTask.getByRole('form', { name: 'Retire Replace furnace filter' });
  await retireForm.getByRole('button', { name: 'Retire task' }).click();
  await expect(page.getByText(/Maintenance task could not be retired/)).toBeVisible();
  await expect(retireForm).toBeVisible();
  await expect(retireForm.getByRole('button', { name: 'Retire task' })).toBeEnabled();
  await retireForm.getByRole('button', { name: 'Cancel retirement' }).click();

  const retiredTask = page.getByRole('article', { name: 'Clean gutters' });
  await retiredTask.getByRole('button', { name: 'Restore Clean gutters' }).click();
  const restoreForm = retiredTask.getByRole('form', { name: 'Restore Clean gutters' });
  await restoreForm.getByLabel('Next due date').fill(localDate(30));
  await restoreForm.getByRole('button', { name: 'Restore task' }).click();
  await expect(page.getByText(/Maintenance task could not be restored/)).toBeVisible();
  await expect(restoreForm.getByLabel('Next due date')).toHaveValue(localDate(30));
  await expect(restoreForm.getByRole('button', { name: 'Restore task' })).toBeEnabled();
  await restoreForm.getByRole('button', { name: 'Cancel restoration' }).click();

  expect(state.maintenanceLifecycleRequests).toEqual([
    { action: 'retire', taskId: 1 },
    { action: 'restore', taskId: 2, next_due_date: localDate(30) },
  ]);
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

for (const width of [1440, 390]) {
  test(`provides roomy navigation with keyboard operation at ${width}px`, async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light' });
    await page.goto('/');
    const buttons = page.locator('nav button');
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    if (width === 390) {
      const boxes = await buttons.evaluateAll((elements) => elements.map((e) => {
        const { x, y, width } = e.getBoundingClientRect();
        return { x, y, width };
      }));
      expect(boxes[0].y).toBe(boxes[1].y);
      expect(boxes[2].y).toBe(boxes[3].y);
      expect(boxes[0].x).toBe(boxes[2].x);
      expect(boxes[1].x).toBe(boxes[3].x);
      expect(boxes[0].width).toBe(boxes[1].width);
    }
    await page.keyboard.press('Tab');
    await expect(buttons.nth(0)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(buttons.nth(1)).toBeFocused();
    expect(await buttons.nth(1).evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#rooms$/);
    await expect(buttons.nth(1)).toHaveAttribute('aria-current', 'page');
    await expect(buttons.nth(1)).toBeFocused();
    expect(await buttons.nth(1).evaluate((e) =>
      getComputedStyle(e).outlineColor === getComputedStyle(document.body).color,
    )).toBe(true);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/#panels$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test(`keeps wall controls separated and usable at ${width}px`, async ({ page }) => {
    const state = await mockApi(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#rooms');
    await page.getByRole('button', { name: 'Edit room geometry for Garage' }).click();
    await page.getByRole('combobox', { name: 'Wall 1 turn', exact: true }).selectOption('custom');
    await expect(page.getByRole('spinbutton', { name: 'Wall 1 custom turn degrees' })).toBeVisible();
    for (const control of await page.locator('.room-builder button, .room-builder input:not([type="radio"]), .room-builder select').all()) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    const placement = page.getByRole('radio', { name: 'Start fresh' });
    expect(await placement.evaluate((e) => e.closest('label')!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    if (width === 390) {
      for (const row of await page.locator('.wall-row').all()) {
        const remove = await row.getByRole('button').boundingBox();
        const controlsBottom = await row.locator('input, select').evaluateAll((elements) =>
          Math.max(...elements.map((e) => e.getBoundingClientRect().bottom)),
        );
        expect(remove!.y - controlsBottom).toBeGreaterThanOrEqual(12);
      }
    }
    const direction = page.getByRole('button', { name: 'First wall direction up' });
    await direction.focus();
    await page.keyboard.press('Space');
    await expect(direction).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Remove wall 2', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.wall-row')).toHaveCount(3);
    expect(state.updatedRoom).toBeNull();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(state.updatedRoom).toBeNull();
    await page.getByRole('button', { name: 'Edit room geometry for Garage' }).click();
    await expect(page.locator('.wall-row')).toHaveCount(4);
    await page.getByRole('spinbutton', { name: 'Wall 1 feet', exact: true }).fill('12');
    await page.getByRole('spinbutton', { name: 'Wall 3 feet', exact: true }).fill('12');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: 'Save room', exact: true }).click();
    await expect.poll(() => state.updatedRoom).not.toBeNull();
    expect(state.updatedRoom?.measurement_source).toMatchObject({ walls: [
      { length_in: 144, turn: 'right' }, { length_in: 120, turn: 'right' },
      { length_in: 144, turn: 'right' }, { length_in: 120, turn: 'right' },
    ] });
  });
}

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

for (const layout of ['small', 'multiple']) {
  test(`shows the selected breaker in view on phones with ${layout} rooms`, async ({ page }) => {
    const rooms = layout === 'small' ? [room] : [room,
      { ...room, id: 2, name: 'Kitchen', polygon: [[20, 0], [34, 0], [34, 12], [20, 12]] },
      { ...room, id: 3, name: 'Hall', polygon: [[10, 10], [20, 10], [20, 26], [10, 26]] },
    ];
    const state = await mockApi(page, { rooms });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const marker = page.getByRole('button', { name: 'outlet: North wall outlet' });
    await marker.click();
    const answer = page.getByText('Circuit: Main panel — breaker 1', { exact: true });
    await expect(answer).toBeInViewport({ ratio: 1 });
    const details = page.getByRole('region', { name: 'Selected point' });
    await expect(details).toBeFocused();
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await expect(marker).toBeFocused();
    await expect(marker).toBeInViewport({ ratio: 1 });
    const target = await marker.boundingBox();
    await page.mouse.click(target!.x + target!.width / 2 + 18, target!.y + target!.height / 2);
    await expect(details).toBeFocused();
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await page.keyboard.press('Enter');
    await expect(details).toBeFocused();
    await expect(answer).toBeInViewport({ ratio: 1 });
    const map = await page.locator('.floorplan-main .floorplan-svg').boundingBox();
    expect(map!.height).toBeLessThanOrEqual(362);
    const symbol = await page.locator('.point-symbol').first().boundingBox();
    expect(symbol!.width).toBeLessThanOrEqual(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: 'Edit point', exact: true }).click();
    await page.getByRole('textbox', { name: 'Label:' }).fill('Discard this');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(state.updatedPoint).toBeNull();
    await expect(answer).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Move point', exact: true }).click();
    await expect(marker).toBeFocused();
    await expect(marker).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(state.updatedPoint).toBeNull();
    await expect(details).toBeFocused();
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await page.getByRole('button', { name: 'Walk circuit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Circuit walk', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Finish walk', exact: true }).click();
    expect(state.createdPoints).toEqual([]);
  });
}

test('keeps selected-point details beside the desktop map without moving focus', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const marker = page.getByRole('button', { name: 'outlet: North wall outlet' });
  await marker.focus();
  await page.keyboard.press('Enter');
  await expect(marker).toBeFocused();
  const map = await page.locator('.floorplan-main').boundingBox();
  const answer = page.getByText('Circuit: Main panel — breaker 1', { exact: true });
  await expect(answer).toBeVisible();
  expect((await answer.boundingBox())!.x).toBeGreaterThan(map!.x + map!.width);
  await expect(page.getByRole('button', { name: 'Back to map' })).toBeHidden();
});

test('makes the floorplan controls keyboard-operable and named', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Hearth' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Floorplan' })).toBeVisible();

  const addPoint = page.getByRole('button', { name: 'Add point' });
  const roomButton = page.getByRole('button', { name: 'Room: Garage' });
  const pointButton = page.getByRole('button', { name: 'outlet: North wall outlet' });
  await expect(addPoint).toBeEnabled();
  await addPoint.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(roomButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Selected room' })).toContainText('Garage');
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

  const addRoom = page.getByRole('button', { name: 'Add room', exact: true });
  await addRoom.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('form', { name: 'Add room' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Floorplan' })).toBeVisible();
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
    unmappedBreaker.getByRole('button', { name: 'Map breaker 2', exact: true }),
  ).toBeEnabled();

  const mappedBox = await mappedBreaker.boundingBox();
  const unmappedBox = await unmappedBreaker.boundingBox();
  expect(unmappedBox?.height).toBeGreaterThan(mappedBox?.height ?? 0);

  await mappedBreaker.getByRole('button', { name: 'View breaker 1 on floorplan' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Floorplan' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Breaker 1 — Garage/ })).toHaveClass(/selected/);
  await expect(page.locator('[data-point-id="1"] + .point-symbol')).toHaveAttribute(
    'stroke',
    '#f97316',
  );
});

for (const width of [1440, 390]) {
  test(`starts mapping the originating panel's breaker at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await mockApi(page);
    await page.goto('/#panels');
    const directory = page.getByRole('region', { name: 'Workshop subpanel breaker directory' });
    await directory.getByRole('button', { name: 'Map breaker 1', exact: true }).click();
    await expect(page).toHaveURL(/#floorplan$/);
    const controls = page.locator('.walk-controls');
    await expect(controls.getByRole('combobox', { name: 'Circuit:', exact: true })).toHaveValue('3');
    await expect(controls.locator('option:checked')).toHaveText('Workshop subpanel — breaker 1');
    await expect(page.getByRole('combobox', { name: 'Floor:', exact: true })).toHaveValue('main');
    await expect(controls.getByRole('heading', { name: 'Circuit walk' })).toBeInViewport();

    await clickFloorplan(page, 0.6, 0.4);
    await page.getByLabel('Label:', { exact: true }).fill('Discard this draft');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(state.createdPoints).toEqual([]);
    await controls.getByRole('button', { name: 'Finish walk', exact: true }).click();
    expect(state.createdPoints).toEqual([]);
    await expect(controls).not.toBeVisible();

    await page.getByRole('button', { name: 'Panels & circuits', exact: true }).click();
    await expect(directory.getByText('Unmapped', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#floorplan$/);
    await expect(page.locator('.floorplan-svg')).toBeVisible();
    await expect(controls).not.toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/#panels$/);
    await directory.getByRole('button', { name: 'Map breaker 1', exact: true }).click();
    await clickFloorplan(page, 0.6, 0.4);
    await page.getByLabel('Label:', { exact: true }).fill('Bench outlet');
    await page.locator('.point-form').getByRole('button', { name: 'Add point', exact: true }).click();
    await expect(page.getByText('1 point added this walk.')).toBeVisible();
    expect(state.createdPoints).toEqual([expect.objectContaining({ circuit_id: 3, room_id: 1, label: 'Bench outlet' })]);
    await clickFloorplan(page, 0.5, 0.3);
    await page.getByLabel('Label:', { exact: true }).fill('Unfinished point');
    await controls.getByRole('button', { name: 'Finish walk', exact: true }).click();
    expect(state.createdPoints).toHaveLength(1);
    expect(state.deletedPointIds).toEqual([]);
    await expect(page.getByRole('button', { name: 'outlet: Bench outlet', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'outlet: North wall outlet', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Next point', exact: true })).not.toBeVisible();

    await page.getByRole('button', { name: 'Panels & circuits', exact: true }).click();
    await expect(directory.getByText('1 mapped point', { exact: true })).toBeVisible();
    await directory.getByRole('button', { name: 'View breaker 1 on floorplan', exact: true }).click();
    await expect(controls).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Breaker 1 — Workshop/ })).toHaveClass(/selected/);
    await page.goBack();
    await page.goForward();
    await expect(controls).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test(`offers room setup before mapping an unmapped breaker at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await mockApi(page, { rooms: [], panels: [{ ...subpanel, room_id: null, fed_from_panel_id: null }] });
    await page.goto('/#panels');
    await page.getByRole('region', { name: 'Workshop subpanel breaker directory' })
      .getByRole('button', { name: 'Map breaker 1', exact: true }).click();
    await expect(page.getByText('Add a room before mapping Workshop subpanel — breaker 1.')).toBeVisible();
    await expect(page.getByText('Then return to this breaker and choose Map breaker.')).toBeVisible();
    await expect(page.locator('.walk-controls')).not.toBeVisible();
    await page.getByRole('button', { name: 'Add room', exact: true }).click();
    await expect(page).toHaveURL(/#floorplan$/);
    await expect(page.getByRole('form', { name: 'Add room' })).toBeVisible();
    expect(state.createdPoints).toEqual([]);
    expect(state.createdRooms).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('starts mapping on the panel floor and falls back when its location is unset', async ({ page }) => {
  await mockApi(page, {
    rooms: [room, { ...room, id: 2, name: 'Upstairs workshop', floor: 'upper' }],
    panels: [{ ...panel, room_id: null }, { ...subpanel, room_id: 2 }],
  });
  await page.goto('/#panels');
  await page.getByRole('region', { name: 'Workshop subpanel breaker directory' })
    .getByRole('button', { name: 'Map breaker 1', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Floor:', exact: true })).toHaveValue('upper');
  await expect(page.getByRole('combobox', { name: 'Circuit:', exact: true })).toHaveValue('3');
  await expect(page.locator('.floorplan-svg')).toContainText('Upstairs workshop');
  await page.getByRole('button', { name: 'Finish walk', exact: true }).click();
  await page.getByRole('button', { name: 'Panels & circuits', exact: true }).click();
  await page.getByRole('button', { name: 'Map breaker 2', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Floor:', exact: true })).toHaveValue('main');
  await expect(page.getByRole('combobox', { name: 'Circuit:', exact: true })).toHaveValue('2');
  await expect(page.locator('.floorplan-svg')).toContainText('Garage');
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
  await page.getByRole('radio', { name: /Walk the walls/ }).check();
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

test('creates a rectangular room from length and width without wall entry', async ({ page }) => {
  const state = await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#rooms');
  await page.getByRole('button', { name: 'Add room', exact: true }).click();

  // Rectangle is the default common path; Cancel still makes no API write.
  await expect(page.getByRole('radio', { name: /Rectangle \(length and width\)/ })).toBeChecked();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.createdRooms).toEqual([]);

  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name:' }).fill('Kitchen');
  await page.getByRole('spinbutton', { name: 'Rectangle length in feet' }).fill('12');
  await page.getByRole('spinbutton', { name: 'Rectangle width in feet' }).fill('10');

  const preview = page.locator('.room-builder .floorplan-svg');
  const addRoomHeading = page.getByRole('heading', { name: 'Add room' });
  const createRoom = page.getByRole('button', { name: 'Create room', exact: true });
  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const [headingBox, previewBox, createBox] = await Promise.all([
    addRoomHeading.boundingBox(),
    preview.boundingBox(),
    createRoom.boundingBox(),
  ]);
  expect(headingBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(createBox).not.toBeNull();
  expect(previewBox!.height).toBeGreaterThanOrEqual(200);
  expect(createBox!.y + createBox!.height - headingBox!.y).toBeLessThanOrEqual(844);
  await createRoom.click();

  await expect.poll(() => state.createdRooms).toHaveLength(1);
  expect(state.createdRooms[0]).toMatchObject({
    name: 'Kitchen',
    floor: 'main',
    polygon: [
      [0, 0],
      [12, 0],
      [12, 10],
      [0, 10],
    ],
  });
  expect(state.createdRooms[0].measurement_source).toMatchObject({
    unit: 'ft_in',
    start: { mode: 'absolute', x: 0, y: 0, heading_deg: 0 },
    walls: [
      { length_in: 144, turn: 'right' },
      { length_in: 120, turn: 'right' },
      { length_in: 144, turn: 'right' },
      { length_in: 120, turn: 'right' },
    ],
  });
  await expect(page.getByRole('cell', { name: 'Kitchen', exact: true })).toBeVisible();

  // The measured wall-walk path stays available, with ordinary-language guidance.
  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  await page.getByRole('radio', { name: /Walk the walls/ }).check();
  await expect(page.getByRole('group', { name: 'Walls' })).toBeVisible();
  await expect(
    page.getByText('walk the first wall in the chosen direction'),
  ).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'New wall feet' })).toBeVisible();
});

test('creates, previews, positions, and cancels rooms on the phone floorplan', async ({ page }) => {
  const state = await mockApi(page, { rooms: [], points: [] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  const canceledDraft = page.getByRole('form', { name: 'Add room' });
  const roomMap = page.locator('.room-authoring .floorplan-svg');
  const roomName = canceledDraft.getByRole('textbox', { name: 'Room name' });
  const roomLength = canceledDraft.getByRole('spinbutton', { name: 'Room length in feet' });
  const saveRoom = canceledDraft.getByRole('button', { name: 'Save room' });
  await expect(roomMap).toBeInViewport({ ratio: 1 });
  await expect(roomName).toBeInViewport({ ratio: 1 });
  await expect(roomLength).toBeInViewport({ ratio: 1 });
  await expect(saveRoom).toBeInViewport({ ratio: 1 });
  const [mapBox, nameBox] = await Promise.all([roomMap.boundingBox(), roomName.boundingBox()]);
  expect(mapBox!.height).toBeGreaterThanOrEqual(180);
  expect(mapBox!.y + mapBox!.height).toBeLessThan(nameBox!.y);
  for (const control of [roomName, roomLength, saveRoom]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await canceledDraft.getByRole('textbox', { name: 'Room name' }).fill('Discarded room');
  await clickFloorplan(page, 0.7, 0.5);
  await expect(page.locator('.draft-room-polygon')).toBeVisible();
  await canceledDraft.getByRole('button', { name: 'Cancel' }).click();
  expect(state.createdRooms).toEqual([]);

  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  let draft = page.getByRole('form', { name: 'Add room' });
  await draft.getByRole('textbox', { name: 'Room name' }).fill('Kitchen');
  await draft.getByRole('spinbutton', { name: 'Room length in feet' }).fill('12');
  await draft.getByRole('spinbutton', { name: 'Room width in feet' }).fill('10');
  await draft.getByRole('button', { name: 'Save room' }).click();
  await expect.poll(() => state.createdRooms).toHaveLength(1);

  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  draft = page.getByRole('form', { name: 'Add room' });
  await draft.getByRole('textbox', { name: 'Room name' }).fill('Living room');
  await draft.getByRole('spinbutton', { name: 'Room length in feet' }).fill('16');
  await draft.getByRole('spinbutton', { name: 'Room width in feet' }).fill('12');
  await draft.getByText('Fine position (optional)').click();
  await expect(draft.getByRole('spinbutton', { name: 'Room X position in feet' })).toHaveValue('14');
  await expect(page.locator('.room-polygon')).toHaveCount(1);
  await expect(page.locator('.draft-room-polygon')).toBeVisible();

  await clickFloorplan(page, 0.85, 0.5);
  await draft.getByRole('button', { name: 'Save room' }).click();
  await expect.poll(() => state.createdRooms).toHaveLength(2);
  const kitchenMaxX = Math.max(...(state.createdRooms[0].polygon as number[][]).map(([x]) => x));
  const livingMinX = Math.min(...(state.createdRooms[1].polygon as number[][]).map(([x]) => x));
  expect(livingMinX).toBeGreaterThan(kitchenMaxX);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('edits a rectangle on the map and previews mapped-point movement before save', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/');

  await page.locator('g[aria-label="Room: Garage"]').click();
  await page.getByRole('button', { name: 'Edit room on map' }).click();
  let form = page.getByRole('form', { name: 'Edit room' });
  const draftOutline = page.locator('.draft-room-polygon');
  await expect(draftOutline).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  expect(await draftOutline.evaluate((element) => getComputedStyle(element).strokeWidth)).toBe('2px');
  await form.getByRole('textbox', { name: 'Room name' }).fill('Discarded name');
  await form.getByRole('button', { name: 'Cancel' }).click();
  expect(state.updatedRoom).toBeNull();
  await expect(page.locator('.floorplan-svg')).toContainText('Garage');

  await page.locator('g[aria-label="Room: Garage"]').click();
  await page.getByRole('button', { name: 'Edit room on map' }).click();
  form = page.getByRole('form', { name: 'Edit room' });
  await form.getByRole('textbox', { name: 'Room name' }).fill('Workshop');
  await form.getByRole('spinbutton', { name: 'Room length in feet' }).fill('20');
  await form.getByRole('spinbutton', { name: 'Room width in feet' }).fill('5');
  const marker = page.locator('[data-point-id="1"]');
  await expect(marker).toHaveAttribute('cx', '14');
  await expect(marker).toHaveAttribute('cy', '1');
  await clickFloorplan(page, 0.75, 0.65);
  const previewX = await marker.getAttribute('cx');
  const previewY = await marker.getAttribute('cy');
  expect(previewX).not.toBe('14');
  expect(previewY).not.toBe('1');

  await form.getByRole('button', { name: 'Save room' }).click();
  await expect.poll(() => state.updatedRoom).not.toBeNull();
  expect(state.updatedRoom).toMatchObject({ name: 'Workshop' });
  await expect(marker).toHaveAttribute('cx', previewX!);
  await expect(marker).toHaveAttribute('cy', previewY!);
});

test('retains a room draft after save failure', async ({ page }) => {
  const state = await mockApi(page, { rooms: [], points: [], failRoomSave: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add room' });
  await form.getByRole('textbox', { name: 'Room name' }).fill('Kitchen');
  await form.getByRole('button', { name: 'Save room' }).click();

  await expect(page.getByText(/Failed to create room.*Room could not be saved/)).toBeVisible();
  await expect(form.getByRole('textbox', { name: 'Room name' })).toHaveValue('Kitchen');
  expect(state.createdRooms).toEqual([]);
});

test('does not offer a duplicate create retry when refresh fails after save', async ({ page }) => {
  const state = await mockApi(page, {
    rooms: [],
    points: [],
    failRoomRefreshAfterSave: true,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add room' });
  await form.getByRole('textbox', { name: 'Room name' }).fill('Kitchen');
  await form.getByRole('button', { name: 'Save room' }).click();

  await expect(page.getByText(/Room saved, but the floorplan could not refresh/)).toBeVisible();
  await expect(form).not.toBeVisible();
  expect(state.createdRooms).toHaveLength(1);
});

test('keeps irregular rooms on the measured geometry path', async ({ page }) => {
  await mockApi(page, {
    rooms: [{ ...room, polygon: [[0, 0], [10, 0], [8, 6], [3, 9], [0, 5]] } as typeof room],
    points: [],
  });
  await page.goto('/');
  await page.locator('g[aria-label="Room: Garage"]').click();

  await expect(page.getByText('This room uses measured or irregular geometry.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit room on map' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Open geometry editor' }).click();
  await expect(page).toHaveURL(/#rooms$/);
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

async function selectedContrast(page: Page) {
  return page.locator('.circuit-list button.selected').evaluate((element) => {
    const rgb = (value: string) => {
      const match = /^rgba?\(([^)]+)\)$/.exec(value);
      if (!match) throw new Error(`unresolved color: ${value}`);
      const values = match[1].split(',').map(Number);
      if (values.length === 3) values.push(1);
      if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) throw new Error('unresolved color');
      return values;
    };
    const canvas = document.createElement('span');
    canvas.style.color = 'Canvas';
    document.body.append(canvas);
    let background = rgb(getComputedStyle(canvas).color).slice(0, 3);
    canvas.remove();
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    for (const node of ancestors) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none' || Number(style.opacity) !== 1 || style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.backdropFilter !== 'none') {
        throw new Error('background needs visual review');
      }
      const color = rgb(style.backgroundColor);
      background = background.map((channel, i) => color[i] * color[3] + channel * (1 - color[3]));
    }
    const style = getComputedStyle(element);
    const color = rgb(style.color);
    const foreground = background.map((channel, i) => color[i] * color[3] + channel * (1 - color[3]));
    const luminance = (channels: number[]) => channels.map((v) => {
      const c = v / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return {ratio: (values[0] + .05) / (values[1] + .05), foreground, background,
      weight: Number(style.fontWeight), outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth)};
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [{width: 390, height: 844}, {width: 1440, height: 1000}]) {
    test(`selected breaker contrast ${colorScheme} ${viewport.width}`, async ({page}, testInfo) => {
      const unexpected: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin !== 'http://127.0.0.1:4173' || request.method() !== 'GET') unexpected.push(url.pathname);
      });
      page.on('requestfailed', request => unexpected.push(new URL(request.url()).pathname));
      page.on('response', response => { if (response.status() >= 400) unexpected.push(new URL(response.url()).pathname); });
      await mockApi(page);
      await page.setViewportSize(viewport);
      await page.emulateMedia({colorScheme});
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      const marker = page.getByRole('button', {name: 'outlet: North wall outlet'});
      await marker.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByText('Circuit: Main panel — breaker 1', {exact: true})).toBeVisible();
      const first = page.getByRole('button', {name: /Breaker 1 — Garage/});
      const second = page.getByRole('button', {name: 'Breaker 2', exact: true});
      await second.click();
      await expect(second).toHaveClass(/selected/);
      await expect(first).not.toHaveClass(/selected/);
      await first.click();
      await expect(first).toHaveClass(/selected/);
      await expect(second).not.toHaveClass(/selected/);
      await first.scrollIntoViewIfNeeded();
      const selected = await selectedContrast(page);
      await page.screenshot({path: testInfo.outputPath('selected.png')});
      await first.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(first).toBeFocused();
      await expect(first).toBeInViewport();
      const focused = await selectedContrast(page);
      await page.screenshot({path: testInfo.outputPath('focused.png')});
      await testInfo.attach('contrast', {body: JSON.stringify({selected, focused}), contentType: 'application/json'});
      expect(selected.ratio).toBeGreaterThanOrEqual(4.5);
      expect(focused.ratio).toBeGreaterThanOrEqual(4.5);
      expect(selected.weight).toBeGreaterThanOrEqual(600);
      expect(focused.outline).not.toBe('none');
      expect(focused.outlineWidth).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    });
  }
}
