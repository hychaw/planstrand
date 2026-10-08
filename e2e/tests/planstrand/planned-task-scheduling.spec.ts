import { expect, test } from '../../fixtures/test.fixture';
import { type Locator, type Page } from '@playwright/test';
import { readMigratedState } from '../../utils/legacy-migration-helpers';
import { openPlanstrandActions } from '../../utils/planstrand-actions';
import { waitForStatePersistence } from '../../utils/waits';
import type { TaskState } from '../../../src/app/features/tasks/task.model';
import type { WorkSessionState } from '../../../src/app/features/work-session/work-session.model';
import type { PlanningState } from '../../../src/app/features/planning/planning.model';

type State = { tasks: TaskState; workSession: WorkSessionState; planning: PlanningState };
test.use({ contextOptions: { timezoneId: 'America/Vancouver' } });
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
const center = (box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } => {
  const halfWidth = box.width / 2,
    halfHeight = box.height / 2;
  return { x: box.x + halfWidth, y: box.y + halfHeight };
};

const scrollToHour = async (page: Page, hour: number): Promise<number> => {
  const panel = page.locator('schedule-day-panel');
  await panel.evaluate((el, h) => {
    const grid = el.querySelector('.grid-container')!;
    const rect = grid.getBoundingClientRect();
    const offset = ((h - 2) * rect.height) / 24;
    el.scrollTop += rect.top - el.getBoundingClientRect().top + offset;
  }, hour);
  return page
    .locator('schedule-day-panel .grid-container')
    .evaluate((el) => el.getBoundingClientRect().height / 24);
};
const dragTaskToHour = async (page: Page, title: string, hour: number): Promise<void> => {
  const pixelsPerHour = await scrollToHour(page, hour);
  const row = page.locator('.task-entry').filter({ hasText: title });
  await row.hover();
  const source = (await row.locator('.task-drag-handle').boundingBox())!;
  const { x, y } = center(source);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y + 10, { steps: 3 });
  const floating = (await page.locator('.cdk-drag-preview').boundingBox())!;
  const grid = (await page.locator('schedule-day-panel .grid-container').boundingBox())!;
  const targetX = center(grid).x;
  const hourOffset = hour * pixelsPerHour;
  let targetY = grid.y + hourOffset + (y + 10 - floating.y);
  await page.mouse.move(targetX, targetY, { steps: 20 });
  const preview = page.locator('schedule-week .custom-drag-preview');
  await expect(preview).toBeVisible();
  await page.waitForTimeout(60); // Settle the existing 30 ms drag-move throttle.
  // Snap the preview's top to the requested grid row (CDK's grab offset can vary
  // with the task row's content), then assert both the stored instant and row.
  const currentRow = await preview.evaluate((el) =>
    Number((el as HTMLElement).style.gridRowStart),
  );
  const hourRows = hour * 12;
  const expectedRow = hourRows + 1;
  targetY += ((expectedRow - currentRow) * pixelsPerHour) / 12;
  await page.mouse.move(targetX, targetY, { steps: 3 });
  await expect(preview).toHaveCSS('grid-row-start', String(expectedRow));
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
};
const resizeByHours = async (
  page: Page,
  block: Locator,
  hours: number,
): Promise<void> => {
  await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const grid = (await page.locator('schedule-day-panel .grid-container').boundingBox())!;
  const handle = (await block.locator('.resize-handle').boundingBox())!;
  const { x, y } = center(handle);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const delta = (hours * grid.height) / 24;
  await page.mouse.move(x, y + delta, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250); // Existing post-resize click guard.
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

test.describe('renderer timezone fallback', () => {
  test.use({ contextOptions: { timezoneId: 'Etc/GMT+8' } });
  test('retains repeated Task drops and aligns Vancouver DST drag time, rows and persisted instants', async ({
    page,
  }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-10-07T16:00:00Z'));
    await page.setViewportSize({ width: 1600, height: 1000 });
    // Reproduce the Electron failure: implicit renderer time stays at UTC-8 while
    // Calendar correctly resolves the user's Vancouver IANA display zone.
    await page.evaluate(() => {
      const helpers = (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
        }
      ).__e2eTestHelpers;
      helpers.store.dispatch({
        type: '[Global Config] Update Global Config Section',
        sectionKey: 'localization',
        sectionCfg: { timeZone: 'America/Vancouver' },
        isSkipSnack: true,
        meta: {
          isPersistent: true,
          entityType: 'GLOBAL_CONFIG',
          entityId: 'localization',
          opType: 'UPDATE',
        },
      });
    });
    expect(await page.evaluate(() => new Date('2026-10-08T00:00:00Z').getHours())).toBe(
      16,
    );
    await page.goto('/#/inbox');
    const firstTitle = 'Independent report sessions';
    const secondTitle = 'Vancouver five PM session';
    for (const title of [firstTitle, secondTitle]) {
      await page
        .locator('planstrand-page section')
        .getByRole('button', { name: 'Add Task', exact: true })
        .click();
      await savePrompt(page, title);
      const row = page.locator('.task-entry').filter({ hasText: title });
      await openPlanstrandActions(row);
      await row.getByRole('combobox', { name: 'Plan Task' }).selectOption('TODAY');
    }
    await page.goto('/#/today');
    const before = await audit(page, firstTitle);
    await dragTaskToHour(page, firstTitle, 9);
    await dragTaskToHour(page, firstTitle, 14);
    await expect(blocksFor(page, firstTitle)).toHaveCount(2);
    const repeated = await audit(page, firstTitle);
    expect(repeated.sessions.map((s) => s!.start)).toEqual([
      Date.parse('2026-10-07T16:00:00Z'),
      Date.parse('2026-10-07T21:00:00Z'),
    ]);
    expect(new Set(repeated.sessions.map((s) => s!.id)).size).toBe(2);
    expect(repeated.operations).toHaveLength(2);
    expect(repeated.planning).toEqual(before.planning);
    expect(
      repeated.projection.schedule.filter((s) => s.taskId === repeated.taskId),
    ).toHaveLength(2);

    await dragTaskToHour(page, secondTitle, 17);
    const fivePM = blocksFor(page, secondTitle);
    // A fresh Task uses the existing 15 minute fallback; resize to the reported
    // 5–6 PM case before dragging. This also verifies end-only resize semantics.
    await resizeByHours(page, fivePM, 0.75);
    const atFive = await audit(page, secondTitle);
    expect(atFive.sessions).toHaveLength(1);
    expect(atFive.sessions[0]).toMatchObject({
      start: Date.parse('2026-10-08T00:00:00Z'),
      end: Date.parse('2026-10-08T01:00:00Z'),
      timeZone: 'America/Vancouver',
    });
    await expect(fivePM).toHaveCSS('grid-row-start', '205');
    await fivePM.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = (await fivePM.boundingBox())!;
    const step =
      (await page.locator('schedule-day-panel .grid-container').boundingBox())!.height /
      24;
    const { x, y } = center(box);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 10, y, { steps: 4 });
    const badge = page.locator('.drag-preview-time-badge');
    await expect(badge).toHaveText(/(?:5:00 PM|17:00) - (?:6:00 PM|18:00) \(1h\)/);
    await page.mouse.move(x + 10, y + step, { steps: 12 });
    await expect(badge).toHaveText(/(?:6:00 PM|18:00) - (?:7:00 PM|19:00) \(1h\)/);
    await page.mouse.up();
    await expect(badge).toHaveCount(0);
    await expect(fivePM).toHaveCSS('grid-row-start', '217');
    const moved = await audit(page, secondTitle);
    expect(moved.sessions[0]).toMatchObject({
      id: atFive.sessions[0]!.id,
      start: Date.parse('2026-10-08T01:00:00Z'),
      end: Date.parse('2026-10-08T02:00:00Z'),
    });
    expect(moved.operations).toHaveLength(5); // Three creates, one resize, one move.

    // Moving one of a Task's sessions and resizing its sibling preserve both IDs.
    const firstBlock = blocksFor(page, firstTitle).first();
    await firstBlock.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const firstBox = (await firstBlock.boundingBox())!;
    const firstCenter = center(firstBox);
    await page.mouse.move(firstCenter.x, firstCenter.y);
    await page.mouse.down();
    await page.mouse.move(firstCenter.x, firstCenter.y + step, { steps: 12 });
    const firstPreview = page.locator('schedule-week .custom-drag-preview');
    await page.waitForTimeout(60); // Read the final pointer position, not a queued move.
    const firstRow = await firstPreview.evaluate((el) =>
      Number((el as HTMLElement).style.gridRowStart),
    );
    const snapOffset = ((121 - firstRow) * step) / 12;
    await page.mouse.move(firstCenter.x, firstCenter.y + step + snapOffset, { steps: 3 });
    await expect(firstPreview).toHaveCSS('grid-row-start', '121');
    await page.mouse.up();
    await resizeByHours(page, blocksFor(page, firstTitle).nth(1), 0.5);
    const edited = await audit(page, firstTitle);
    expect(edited.sessions.map((s) => s!.id)).toEqual(
      repeated.sessions.map((s) => s!.id),
    );
    expect(edited.sessions[0]).toMatchObject({
      start: repeated.sessions[0]!.start + 3600000,
      end: repeated.sessions[0]!.end + 3600000,
    });
    expect(edited.sessions[1]).toMatchObject({
      start: repeated.sessions[1]!.start,
      end: repeated.sessions[1]!.end + 1800000,
    });
    expect(edited.planning).toEqual(before.planning);
    await page.reload();
    await expect(blocksFor(page, firstTitle)).toHaveCount(2);
    await expect(blocksFor(page, secondTitle)).toHaveCount(1);
    const reloaded = await audit(page, firstTitle);
    expect(reloaded.sessions).toEqual(edited.sessions);
    expect(reloaded.operationIds).toEqual(edited.operationIds);
    expect(
      reloaded.projection.schedule.filter((s) => s.taskId === reloaded.taskId),
    ).toHaveLength(2);
    await page
      .locator('.task-entry')
      .filter({ hasText: firstTitle })
      .locator('done-toggle')
      .click();
    const completed = await audit(page, firstTitle);
    expect(completed.isDone).toBe(true);
    expect(completed.sessions).toEqual(edited.sessions);
    expect(completed.planning).toEqual(before.planning);
    await page.goto('/#/schedule');
    await page.getByRole('button', { name: 'View Day', exact: true }).click();
    await expect(
      page
        .locator('schedule-event:not(.custom-drag-preview)')
        .filter({ hasText: firstTitle }),
    ).toHaveCount(2);
    await expect(
      page
        .locator('schedule-event:not(.custom-drag-preview)')
        .filter({ hasText: secondTitle }),
    ).toHaveCount(1);
    await testInfo.attach('multiple-session-time-audit', {
      body: JSON.stringify(
        { before, repeated, atFive, moved, edited, reloaded, completed },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
});
