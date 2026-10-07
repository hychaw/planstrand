import { test as base, expect } from '../../fixtures/test.fixture';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';
import {
  attachPageErrorCollector,
  assertNoRuntimeBrowserErrors,
} from '../../utils/runtime-errors';
import { openPlanstrandActions } from '../../utils/planstrand-actions';

const oct6 = new Date('2026-10-06T21:59:30Z');
// Install the clock before bootstrap so existing RxJS timers are never replaced.
const test = base.extend({
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    const errors = attachPageErrorCollector(page, 'rollover');
    await page.clock.install({ time: oct6 });
    await page.addInitScript(skipOnboardingForE2E);
    await page.goto('/#/today');
    await waitForAppReady(page);
    await use(page);
    assertNoRuntimeBrowserErrors(errors, 'rollover');
  },
});
test.use({ contextOptions: { timezoneId: 'Europe/Berlin' } });

test('Today rolls over without reload and an already-open Task menu plans the new day', async ({
  page,
}) => {
  await page.goto('/#/today');
  await expect(page.locator('.period-label')).toContainText('Tuesday, October 6, 2026');
  await page.getByRole('button', { name: 'Add Task: Tuesday', exact: true }).click();
  const prompt = page.locator('dialog-prompt');
  await prompt.locator('input').fill('October 6 focus');
  await prompt.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.planning-sections > section').first()).toContainText(
    'October 6 focus',
  );
  await page.getByRole('button', { name: 'Add Task: Tuesday', exact: true }).click();
  await prompt.locator('input').fill('Saved after midnight');
  await page.clock.fastForward(60000);
  await expect(page.locator('.period-label')).toContainText('Wednesday, October 7, 2026');
  await expect(page.locator('.planning-sections > section').first()).not.toContainText(
    'October 6 focus',
  );

  await prompt.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.planning-sections > section').first()).toContainText(
    'Saved after midnight',
  );

  await page.goto('/#/master-tasks');
  await page.locator('.quick-capture input').first().fill('Plan after midnight');
  await page.locator('.quick-capture input').first().press('Enter');
  const row = page.locator('.task-entry').filter({ hasText: 'Plan after midnight' });
  await openPlanstrandActions(row);
  // Suspend callbacks and advance another day while this menu stays open.
  await page.clock.setSystemTime(new Date('2026-10-07T22:01:00Z'));
  await row.locator('select').selectOption('TODAY');
  await page.goto('/#/today');
  await expect(page.locator('.period-label')).toContainText('Thursday, October 8, 2026');
  await expect(page.locator('.planning-sections > section').first()).toContainText(
    'Plan after midnight',
  );
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('.planning-sections > section').first()).toContainText(
    'Plan after midnight',
  );
});

test('This Week keeps its range at ordinary midnight and recovers its current day on focus', async ({
  page,
}) => {
  await page.goto('/#/this-week');
  const range = await page.locator('.period-label').innerText();
  await expect(page.locator('.is-today-heading')).toContainText('Tuesday');
  await page.clock.fastForward(60000);
  await expect(page.locator('.is-today-heading')).toContainText('Wednesday');
  await expect(page.locator('.period-label')).toHaveText(range);

  await page.getByRole('button', { name: 'Add Task: Wednesday', exact: true }).click();
  await page.locator('dialog-prompt input').fill('Wednesday placement');
  await page
    .locator('dialog-prompt')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  const wednesday = page.locator('.planning-sections > section').filter({
    has: page.getByRole('button', { name: 'Add Task: Wednesday', exact: true }),
  });
  await expect(wednesday).toContainText('Wednesday placement');

  // Simulate suspended callbacks overnight, then returning to the same page.
  await page.clock.setSystemTime(new Date('2026-10-08T08:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.is-today-heading')).toContainText('Thursday');
  await expect(page.locator('.period-label')).toHaveText(range);
  await expect(wednesday).toContainText('Wednesday placement');
  await page.goto('/#/today');
  await expect(page.locator('.period-label')).toContainText('Thursday, October 8, 2026');
  await expect(page.locator('.planning-sections > section').first()).not.toContainText(
    'Wednesday placement',
  );
});

test('This Week advances across Sunday midnight and Add uses the new week/day', async ({
  page,
}) => {
  await page.clock.setSystemTime(new Date('2026-10-11T21:59:30Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.goto('/#/this-week');
  await expect(page.locator('.is-today-heading')).toContainText('Sunday');
  await page
    .getByRole('button', { name: 'Add Task: Anytime This Week', exact: true })
    .click();
  await page.locator('dialog-prompt input').fill('Submitted in the new week');
  await page.clock.fastForward(60000);
  await expect(page.locator('.is-today-heading')).toContainText('Monday');
  await expect(page.locator('.period-label')).toContainText('Oct 12');
  await page
    .locator('dialog-prompt')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(page.locator('.planning-sections > section').first()).toContainText(
    'Submitted in the new week',
  );
  for (const section of ['Anytime This Week', 'Monday']) {
    await page.getByRole('button', { name: `Add Task: ${section}`, exact: true }).click();
    await page.locator('dialog-prompt input').fill(`New week ${section}`);
    await page
      .locator('dialog-prompt')
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    const panel = page.locator('.planning-sections > section').filter({
      has: page.getByRole('button', { name: `Add Task: ${section}`, exact: true }),
    });
    await expect(panel).toContainText(`New week ${section}`);
  }
});

test('Calendar Month/Year highlight and Today recover across rollover and focus', async ({
  page,
}) => {
  await page.goto('/#/schedule');
  await page.getByRole('button', { name: 'View Month', exact: true }).click();
  await expect(page.locator('.month-day-cell.today')).toHaveAttribute(
    'data-day',
    '2026-10-06',
  );
  // Fix the selected month; its highlight must still refresh.
  await page.getByRole('button', { name: /^Previous Month$/i }).click();
  await page.getByRole('button', { name: /^Next Month$/i }).click();
  await page.clock.fastForward(60000);
  await expect(page.locator('.month-day-cell.today')).toHaveAttribute(
    'data-day',
    '2026-10-07',
  );
  await page.locator('.e2e-year-view-btn').click();
  await expect(page.locator('schedule-year [aria-current="date"]')).toHaveAttribute(
    'aria-label',
    /(?:7 October|October 7).*2026/,
  );
  await page.clock.setSystemTime(new Date('2026-10-08T08:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('schedule-year [aria-current="date"]')).toHaveAttribute(
    'aria-label',
    /(?:8 October|October 8).*2026/,
  );
  await page.locator('.e2e-day-view-btn').click();
  await page.getByRole('button', { name: /^Previous Day$/i }).click();
  await page.locator('.today-btn').click();
  await expect(page.locator('schedule-week')).toContainText('8');
});
