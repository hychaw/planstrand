import { expect, test } from '../../fixtures/test.fixture';
import { openPlanstrandActions } from '../../utils/planstrand-actions';
import type { Page } from '@playwright/test';
import { waitForStatePersistence } from '../../utils/waits';
import type { TaskState } from '../../../src/app/features/tasks/task.model';
import type { PlanningState } from '../../../src/app/features/planning/planning.model';
import type { WorkSessionState } from '../../../src/app/features/work-session/work-session.model';

test.use({ contextOptions: { timezoneId: 'Pacific/Kiritimati' } });
type State = { tasks: TaskState; planning: PlanningState; workSession: WorkSessionState };
const readState = (page: Page): Promise<State> =>
  page.evaluate(() => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (fn: (state: State) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers;
    let state!: State;
    const sub = helpers.store.subscribe((value) => {
      state = value;
    });
    sub.unsubscribe();
    return state;
  });

for (const theme of ['Light', 'Dark']) {
  test(`quick planning preserves Task and WorkSession data offline in ${theme}`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-12-30T10:01:00Z'));
    await page.goto('/#/config');
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page
      .locator('theme-selector')
      .getByRole('radio', { name: theme, exact: true })
      .click();
    await page.setViewportSize(
      theme === 'Dark' ? { width: 375, height: 812 } : { width: 1280, height: 900 },
    );
    await page.goto('/#/inbox');
    const title = 'Quick planning boundary Task';
    const capture = page.locator('.quick-capture input');
    await capture.fill(title);
    await capture.press('Enter');
    const row = page.locator('.task-entry').filter({ hasText: title });
    await openPlanstrandActions(row);
    await row.getByRole('button', { name: 'Schedule WorkSession', exact: true }).click();
    const dialog = page.locator('dialog-schedule-task');
    await dialog.getByRole('button', { name: 'Today', exact: true }).click();
    await dialog.locator('input[type=time]').fill('10:00');
    await dialog.locator('[data-test-id=schedule-submit-btn]').click();
    await expect(dialog).toBeHidden();
    await waitForStatePersistence(page);
    const before = await readState(page);
    const task = Object.values(before.tasks.entities).find(
      (item) => item?.title === title,
    )!;
    expect(
      Object.values(before.workSession.entities).some(
        (session) => session?.taskId === task.id,
      ),
    ).toBe(true);
    await page.context().setOffline(true);
    for (const [label, target] of [
      ['Plan Today', { type: 'DAY', key: '2026-12-31' }],
      ['Plan Tomorrow', { type: 'DAY', key: '2027-01-01' }],
      ['Move to This Week', { type: 'WEEK', key: '2026-12-28' }],
      ['Move to Next Week', { type: 'WEEK', key: '2027-01-04' }],
      ['Unplan', null],
    ] as const) {
      await openPlanstrandActions(row);
      const button = row.getByRole('button', { name: label, exact: true });
      await expect(button).toBeInViewport();
      if (label === 'Plan Today') {
        await page.screenshot({
          path: `.tmp/quick-planning-${theme}.png`,
          fullPage: true,
        });
      }
      await button.click();
      await expect(row.locator('.commands')).toBeHidden();
      await waitForStatePersistence(page);
      const after = await readState(page);
      expect(after.planning.entities[task.id].placement?.target ?? null).toEqual(target);
      expect(after.tasks.entities[task.id]).toEqual(task);
      expect(after.workSession).toEqual(before.workSession);
    }
    await page.context().setOffline(false);
    await page.reload();
    await expect(row).toBeVisible();
    const reloaded = await readState(page);
    expect(reloaded.planning.entities[task.id].placement).toBeNull();
    expect(reloaded.tasks.entities[task.id]).toEqual(task);
    expect(reloaded.workSession).toEqual(before.workSession);
  });
}
