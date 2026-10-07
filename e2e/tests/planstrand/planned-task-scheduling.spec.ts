import { expect, test } from '../../fixtures/test.fixture';
import { type Locator, type Page } from '@playwright/test';
import { readMigratedState } from '../../utils/legacy-migration-helpers';
import { openPlanstrandActions } from '../../utils/planstrand-actions';
import { waitForStatePersistence } from '../../utils/waits';
import type { TaskState } from '../../../src/app/features/tasks/task.model';
import type { WorkSessionState } from '../../../src/app/features/work-session/work-session.model';
import type { PlanningState } from '../../../src/app/features/planning/planning.model';

type State = { tasks: TaskState; workSession: WorkSessionState; planning: PlanningState };
type ProjectionItem = { id: string; sourceType: string; taskId?: string };
type SchedulingAudit = {
  taskId: string;
  folderId?: string;
  dueWithTime?: number | null;
  isDone: boolean;
  planning: PlanningState['entities'][string];
  sessions: WorkSessionState['entities'][string][];
  operations: unknown[];
  operationIds: string[];
  rendered: { id: string; class: string }[];
  previews: number;
  projection: {
    canonical: ProjectionItem[];
    schedule: { id: string; type: string; taskId: string }[];
  };
  persistedCache: Record<string, unknown>;
};
const savePrompt = async (page: Page, title: string): Promise<void> => {
  await page.locator('dialog-prompt input').fill(title);
  await page
    .locator('dialog-prompt')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
};
const blocksFor = (page: Page, title: string): Locator =>
  page
    .locator('schedule-day-panel schedule-event:not(.custom-drag-preview)')
    .filter({ hasText: title });
const audit = async (page: Page, title: string): Promise<SchedulingAudit> => {
  await waitForStatePersistence(page);
  const state = await page.evaluate(() => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (fn: (value: State) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers;
    let snapshot!: State;
    const sub = helpers.store.subscribe((value) => {
      snapshot = value;
    });
    sub.unsubscribe();
    return snapshot;
  });
  const task = Object.values(state.tasks.entities).find((t) => t?.title === title)!;
  const sessions = Object.values(state.workSession.entities).filter(
    (s) => s?.taskId === task.id,
  );
  // Read the real development components, not a reimplementation of the projection.
  const projection = await page.evaluate(() => {
    type Item = { id: string; sourceType: string; taskId?: string };
    type Entry = { id: string; type: string; data: { id: string; taskId?: string } };
    const ng = (
      window as unknown as {
        ng: {
          getComponent: (el: Element) => {
            events: () => Entry[];
            _scheduleService: { _calendarDisplayItems: () => Item[] };
          };
        };
      }
    ).ng;
    const panel = ng.getComponent(document.querySelector('schedule-day-panel')!);
    return {
      canonical: panel._scheduleService
        ._calendarDisplayItems()
        .map(({ id, sourceType, taskId }) => ({ id, sourceType, taskId })),
      schedule: panel
        .events()
        .map(({ id, type, data }) => ({ id, type, taskId: data.taskId ?? data.id })),
    };
  });
  const operations = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('SUP_OPS');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<{ sessions: unknown[]; ids: string[] }>(
        (resolve, reject) => {
          const req = db.transaction('ops').objectStore('ops').getAll();
          req.onsuccess = () =>
            resolve({
              sessions: req.result.filter(
                (entry: { op: { e?: string; entityType?: string } }) =>
                  (entry.op.e ?? entry.op.entityType) === 'WORK_SESSION',
              ),
              ids: req.result.map((entry: { op: { id: string } }) => entry.op.id),
            });
          req.onerror = () => reject(req.error);
        },
      );
    } finally {
      db.close();
    }
  });
  return {
    taskId: task.id,
    folderId: task.folderId,
    dueWithTime: task.dueWithTime,
    isDone: task.isDone,
    planning: state.planning.entities[task.id],
    sessions,
    operations: operations.sessions,
    operationIds: operations.ids,
    rendered: await blocksFor(page, title).evaluateAll((els) =>
      els.map((el) => ({ id: el.id, class: el.className })),
    ),
    previews: await page.locator('schedule-week .custom-drag-preview').count(),
    projection,
    persistedCache: await readMigratedState(page),
  };
};

for (const nested of [false, true]) {
  test(`Today-planned ${nested ? 'nested-Folder' : 'Inbox'} Task schedules exactly once`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const title = nested
      ? 'Nested planned scheduling regression'
      : 'Inbox planned scheduling regression';
    await page.goto('/#/master-tasks');
    let section = page.locator('planstrand-page section').first();
    if (nested) {
      await page
        .locator('planstrand-page header')
        .getByRole('button', { name: 'Create Folder', exact: true })
        .click();
      await savePrompt(page, 'Scheduling Parent');
      const parent = page.locator('planstrand-page section').filter({
        has: page.getByRole('heading', { name: '▾ Scheduling Parent', exact: true }),
      });
      await openPlanstrandActions(parent, 'folder');
      await parent.getByRole('button', { name: 'Create Folder', exact: true }).click();
      await savePrompt(page, 'Scheduling Child');
      section = page.locator('planstrand-page section').filter({
        has: page.getByRole('heading', { name: '▾ Scheduling Child', exact: true }),
      });
    }
    await section.getByRole('button', { name: 'Add Task', exact: true }).click();
    await savePrompt(page, title);
    const row = page.locator('.task-entry').filter({ hasText: title });
    await openPlanstrandActions(row);
    await row.getByRole('combobox', { name: 'Plan Task' }).selectOption('TODAY');
    await page.goto('/#/today');
    const focus = page.locator('.planning-sections > section').first();
    await expect(focus.locator('.task-entry').filter({ hasText: title })).toHaveCount(1);
    const before = await audit(page, title);
    expect(before.sessions).toHaveLength(0);
    expect(before.operations).toHaveLength(0);
    expect(before.dueWithTime ?? null).toBeNull();
    expect(before.projection.canonical).toHaveLength(0);
    expect(before.projection.schedule).toHaveLength(0);
    expect(before.rendered).toHaveLength(0);

    await row.hover();
    const source = (await row.locator('.task-drag-handle').boundingBox())!;
    const zone = (await page.locator('schedule-day-panel').boundingBox())!;
    const halfWidth = source.width / 2;
    const halfHeight = source.height / 2;
    const x = source.x + halfWidth,
      y = source.y + halfHeight;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 10, y + 10, { steps: 3 });
    await expect(page.locator('.cdk-drag-preview')).toBeVisible();
    const targetHalfWidth = zone.width / 2;
    await page.mouse.move(zone.x + targetHalfWidth, zone.y + 240, { steps: 25 });
    await expect(page.locator('schedule-week .custom-drag-preview')).toBeVisible();
    await page.mouse.up();
    const after = await audit(page, title);
    await testInfo.attach('scheduling-before-after', {
      body: JSON.stringify({ before, after }, null, 2),
      contentType: 'application/json',
    });
    expect(after.sessions).toHaveLength(1);
    expect(after.operations).toHaveLength(1);
    expect(
      after.operationIds.filter((id) => !before.operationIds.includes(id)),
    ).toHaveLength(1);
    expect(after.operations[0]).toMatchObject({
      op: {
        e: 'WORK_SESSION',
        o: 'CRT',
        p: { actionPayload: { workSession: after.sessions[0] } },
      },
    });
    expect(after.planning).toEqual(before.planning);
    expect(after.dueWithTime ?? null).toBeNull();
    expect(after.isDone).toBe(false);
    expect(after.previews).toBe(0);
    expect(
      after.projection.canonical.filter((item) => item.taskId === after.taskId),
    ).toHaveLength(1);
    expect(
      after.projection.schedule.filter((item) => item.taskId === after.taskId),
    ).toHaveLength(1);
    await expect(blocksFor(page, title)).toHaveCount(1);
    await expect(blocksFor(page, title)).toHaveClass(/blue-thread-session/);
    await expect(focus.locator('.task-entry').filter({ hasText: title })).toHaveCount(1);

    await page.reload();
    await expect(blocksFor(page, title)).toHaveCount(1);
    const reloaded = await audit(page, title);
    expect(reloaded.sessions).toEqual(after.sessions);
    expect(reloaded.operations).toEqual(after.operations);
    expect(reloaded.operationIds).toEqual(after.operationIds);
    expect(reloaded.planning).toEqual(before.planning);
    await row.locator('done-toggle').click();
    await expect(page.locator('.completed-section')).toContainText(title);
    const completed = await audit(page, title);
    expect(completed.isDone).toBe(true);
    expect(completed.sessions).toEqual(after.sessions);
    expect(completed.operations).toEqual(after.operations);
    expect(completed.planning).toEqual(before.planning);
    await expect(blocksFor(page, title)).toHaveCount(1);
    await testInfo.attach('scheduling-reloaded-completed', {
      body: JSON.stringify({ reloaded, completed }, null, 2),
      contentType: 'application/json',
    });
  });
}
