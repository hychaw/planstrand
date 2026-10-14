import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import type { TaskState } from '../../../src/app/features/tasks/task.model';
import type { PlanningState } from '../../../src/app/features/planning/planning.model';
import type { WorkSessionState } from '../../../src/app/features/work-session/work-session.model';
import { waitForStatePersistence } from '../../utils/waits';

test.use({ contextOptions: { timezoneId: 'Asia/Singapore' } });
type State = { tasks: TaskState; planning: PlanningState; workSession: WorkSessionState };
const readState = (page: Page): Promise<State> =>
  page.evaluate(() => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (next: (state: State) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let state!: State;
    const subscription = store.subscribe((value) => {
      state = value;
    });
    subscription.unsubscribe();
    return state;
  });

for (const theme of ['Light', 'Dark']) {
  test(`My Day creation and exact-minute edits persist offline in ${theme}`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T08:00:00Z'));
    await page.reload();
    await page.goto('/#/config');
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page
      .locator('theme-selector')
      .getByRole('radio', { name: theme, exact: true })
      .click();
    await page.goto('/#/today');
    const panel = page.locator('schedule-day-panel');
    await panel.scrollIntoViewIfNeeded();
    await panel.evaluate((element) => {
      const grid = element.querySelector('.grid-container')!;
      const rowHeight = parseFloat(getComputedStyle(grid).gridTemplateRows.split(' ')[0]);
      element.scrollTop = 16 * 12 * rowHeight;
    });
    const point = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const col = element.querySelector('.col.end-of-day')!.getBoundingClientRect();
      const halfWidth = col.width / 2;
      return { x: col.left + halfWidth, y: rect.top + 140 };
    });
    await page.mouse.move(point.x, point.y);
    await expect(panel.locator('create-task-placeholder')).toBeVisible();
    await page.mouse.click(point.x, point.y);
    const input = panel.locator('create-task-placeholder input');
    await expect(input).toBeVisible();
    const title = `My Day exact-minute ${theme}`;
    await input.fill(title);
    await input.press('Enter');
    const sessionBlock = page
      .locator('planstrand-page schedule-event.blue-thread-session')
      .filter({ hasText: title });
    const calendarBlock = page
      .locator('schedule schedule-event.blue-thread-session')
      .filter({ hasText: title });
    await expect(sessionBlock).toHaveCount(1);
    const focus = page.locator('.planning-sections > section').first();
    await expect(focus.locator('.task-entry').filter({ hasText: title })).toHaveCount(1);
    await expect(
      page.locator('.unplanned-section .task-entry').filter({ hasText: title }),
    ).toHaveCount(0);
    await waitForStatePersistence(page);
    const before = await readState(page);
    const task = Object.values(before.tasks.entities).find(
      (item) => item?.title === title,
    )!;
    const session = Object.values(before.workSession.entities).find(
      (item) => item?.taskId === task.id,
    )!;
    expect(before.planning.entities[task.id].placement?.target).toEqual({
      type: 'DAY',
      key: '2026-10-14',
    });
    expect(session.start % (5 * 60000)).toBe(0);

    await sessionBlock.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
    await page
      .getByRole('menuitemradio', { name: '5 minutes before it starts', exact: true })
      .click();
    const reminderKey = 'planstrand_local_schedule_reminders_v1';
    const reminders = await page.evaluate(
      (key) => localStorage.getItem(key),
      reminderKey,
    );
    expect(JSON.parse(reminders!)[`workSession:${session.id}`].offset).toBe(5);

    // Load the Calendar route before taking the application offline.
    await page.goto('/#/schedule');
    await expect(calendarBlock).toHaveCount(1);
    await page.goto('/#/today');
    await expect(sessionBlock).toHaveCount(1);
    await page.context().setOffline(true);
    await sessionBlock.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit start and end times' }).click();
    const editor = page.locator('dialog-work-session');
    await expect(editor).toContainText('Asia/Singapore');
    await editor.locator('input[name=start]').fill('16:17');
    await editor.locator('input[name=end]').fill('17:23');
    await page.screenshot({
      path: `.tmp/my-day-exact-minute-${theme}.png`,
      animations: 'disabled',
    });
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toBeHidden();
    await waitForStatePersistence(page);
    let after = await readState(page);
    expect(after.tasks.entities[task.id]).toEqual(task);
    expect(after.planning).toEqual(before.planning);
    expect(after.workSession.ids).toEqual(before.workSession.ids);
    expect(after.workSession.entities[session.id]).toMatchObject({
      id: session.id,
      taskId: task.id,
      timeZone: session.timeZone,
      start: Date.parse('2026-10-14T16:17:00+08:00'),
      end: Date.parse('2026-10-14T17:23:00+08:00'),
    });

    await page.goto('/#/schedule');
    await expect(calendarBlock).toHaveCount(1);
    await calendarBlock.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark WorkSession as completed' }).click();
    await calendarBlock.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit start and end times' }).click();
    await editor.locator('input[name=end]').fill('17:27');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await waitForStatePersistence(page);
    after = await readState(page);
    expect(after.workSession.entities[session.id]!.completedAt).toBeTruthy();
    expect(after.tasks.entities[task.id]).toEqual(task);
    expect(after.planning).toEqual(before.planning);
    await page.context().setOffline(false);
    await page.reload();
    await expect(calendarBlock).toHaveCount(1);
    const reloaded = await readState(page);
    expect(reloaded.workSession).toEqual(after.workSession);
    expect(reloaded.planning).toEqual(after.planning);
    expect(reloaded.tasks.entities[task.id]).toEqual(task);
    expect(await page.evaluate((key) => localStorage.getItem(key), reminderKey)).toBe(
      reminders,
    );
    expect(
      Object.values(reloaded.tasks.entities).filter((item) => item?.title === title),
    ).toHaveLength(1);
  });
}
