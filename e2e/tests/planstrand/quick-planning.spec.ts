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
    // Bootstrap timers against the pinned date instead of changing a running clock.
    await page.reload();
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
      // Exercise the same menu in all three planning surfaces.
      if (label === 'Plan Tomorrow') await page.goto('/#/today');
      if (label === 'Move to This Week') await page.goto('/#/this-week');
      if (label === 'Unplan') await page.goto('/#/inbox');
      await openPlanstrandActions(row);
      const button = row.getByRole('button', { name: label, exact: true });
      await expect(button).toBeInViewport();
      if (label === 'Plan Today') {
        await page.screenshot({
          path: `.tmp/quick-planning-${theme}.png`,
          fullPage: true,
        });
      }
      if (label === 'Plan Tomorrow') {
        await button.focus();
        await page.keyboard.press('Enter');
      } else await button.click();
      await expect(row.locator('.commands')).toBeHidden();
      if (label === 'Plan Today' || label === 'Unplan') {
        await expect(row.locator('.task-actions summary')).toBeFocused();
      }
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

for (const theme of ['Light', 'Dark']) {
  test(`custom destinations, week navigation and indicators in ${theme}`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-12-30T10:01:00Z'));
    await page.reload();
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
    const title = 'Custom destination Task';
    await page.locator('.quick-capture input').fill(title);
    await page.locator('.quick-capture input').press('Enter');
    const row = page.locator('.task-entry').filter({ hasText: title });
    await expect(row.locator('.row-planning-status')).toHaveText('Unplanned');
    await waitForStatePersistence(page);
    const before = await readState(page);
    const task = Object.values(before.tasks.entities).find(
      (item) => item?.title === title,
    )!;
    await page.context().setOffline(true);
    for (const [button, input, target] of [
      ['Choose Date', '2027-01-06', { type: 'DAY', key: '2027-01-06' }],
      ['Choose Week', '2027-01-07', { type: 'WEEK', key: '2027-01-04' }],
      ['Choose Date', '2024-02-29', { type: 'DAY', key: '2024-02-29' }],
    ] as const) {
      await openPlanstrandActions(row);
      await row.getByRole('button', { name: button, exact: true }).click();
      const dialog = page.locator('planstrand-planning-destination-dialog');
      const date = dialog.locator('date-picker-input input');
      await expect(date).toBeFocused();
      // The shared date control follows the configured en-GB input format.
      await date.fill(input.split('-').reverse().join('/'));
      await date.press('Tab');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(row.getByRole('button', { name: button, exact: true })).toBeFocused();
      await waitForStatePersistence(page);
      const after = await readState(page);
      expect(after.planning.entities[task.id].placement?.target).toEqual(target);
      expect(after.tasks.entities[task.id]).toEqual(task);
      expect(after.workSession).toEqual(before.workSession);
      await expect(row.locator('.row-planning-status')).toContainText(
        target.type === 'WEEK'
          ? 'Week of Jan 4, 2027'
          : target.key === '2024-02-29'
            ? 'Feb 29, 2024'
            : 'Jan 6, 2027',
      );
      await page.keyboard.press('Escape');
      await expect(row.locator('.task-actions summary')).toBeFocused();
    }
    await openPlanstrandActions(row);
    await row.getByRole('button', { name: 'Move to Next Week', exact: true }).click();
    await page.goto('/#/this-week');
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: 'Next week', exact: true }).click();
    await expect(page.locator('.period-label')).toContainText('Jan 4, 2027');
    await expect(page.locator('.period-label')).toContainText('Viewing another week');
    await expect(
      page.locator('.week-anytime').getByText(title, { exact: true }),
    ).toBeVisible();
    await page
      .locator('.week-anytime')
      .getByRole('button', { name: /Add Task/ })
      .click();
    const prompt = page.locator('dialog-prompt');
    await prompt.locator('input').fill('Added to displayed week');
    await prompt.getByRole('button', { name: /Save|OK|Add Task/i }).click();
    await expect(
      page.locator('.week-anytime').getByText('Added to displayed week', { exact: true }),
    ).toBeVisible();
    await openPlanstrandActions(row);
    await row.getByRole('button', { name: 'Choose Date', exact: true }).click();
    const dialog = page.locator('planstrand-planning-destination-dialog');
    await dialog.locator('input').fill('06/01/2027');
    await dialog.locator('input').press('Tab');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page
        .locator('section')
        .filter({ has: page.locator('h2', { hasText: 'Wednesday' }) })
        .getByText(title, { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Previous week', exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: 'Previous week', exact: true }).click();
    await expect(page.locator('.period-label')).toContainText('Dec 21, 2026');
    await page.getByRole('button', { name: 'Current Week', exact: true }).click();
    await expect(page.locator('.period-label')).toContainText('Dec 28, 2026');
    await page.goto('/#/today');
    await expect(page.locator('.period-label')).toContainText('December 31, 2026');
    await page.goto('/#/inbox');
    await openPlanstrandActions(row);
    await row.getByRole('button', { name: 'Unplan', exact: true }).click();
    await expect(row.locator('.row-planning-status')).toHaveText('Unplanned');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.context().setOffline(false);
  });
}
