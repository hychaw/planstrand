import { expect, test } from '../../fixtures/test.fixture';
import { openPlanstrandActions } from '../../utils/planstrand-actions';
import { waitForStatePersistence } from '../../utils/waits';
import type { Locator, Page } from '@playwright/test';

test.use({ contextOptions: { timezoneId: 'UTC' } });

const titles = ['Order A', 'Order B', 'Order C'];
const row = (scope: Page | Locator, title: string): Locator =>
  scope.locator('.task-entry').filter({ hasText: title });
const order = (scope: Page | Locator): Locator =>
  scope.locator('.task-entry task .task-title');
const snapshot = (page: Page): Promise<unknown> =>
  page.evaluate(() => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              cb: (state: {
                tasks: { ids: string[]; entities: unknown };
                workSession: unknown;
                planning: unknown;
              }) => void,
            ) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let result: unknown;
    const sub = store.subscribe((state) => {
      result = {
        tasks: { ids: state.tasks.ids, entities: state.tasks.entities },
        workSession: state.workSession,
        planning: state.planning,
      };
    });
    sub.unsubscribe();
    return result;
  });
const move = async (
  scope: Page | Locator,
  title: string,
  label: string,
  keyboard = false,
): Promise<void> => {
  const entry = row(scope, title);
  await openPlanstrandActions(entry);
  const button = entry.getByRole('button', { name: label, exact: true });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  if (keyboard) {
    await button.focus();
    await button.press('Enter');
  } else await button.click();
  await expect(entry.locator('.commands')).toBeHidden();
};

for (const theme of ['Light', 'Dark']) {
  test(`canonical and Planning reorder persists in ${theme}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-12-30T09:00:00Z'));
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
    for (const title of titles) {
      await page.locator('.quick-capture input').fill(title);
      await page.locator('.quick-capture input').press('Enter');
      await expect(row(page, title)).toBeVisible();
    }
    await openPlanstrandActions(row(page, 'Order A'));
    await row(page, 'Order A')
      .getByRole('button', { name: 'Schedule WorkSession', exact: true })
      .click();
    const dialog = page.locator('dialog-schedule-task');
    await dialog.getByRole('button', { name: 'Today', exact: true }).click();
    await dialog.locator('input[type=time]').fill('10:00');
    await dialog.locator('[data-test-id=schedule-submit-btn]').click();
    await expect(dialog).toBeHidden();
    await row(page, 'Order A').locator('summary').press('Escape');
    await waitForStatePersistence(page);
    const before = await snapshot(page);
    expect(
      Object.keys((before as { workSession: { entities: object } }).workSession.entities),
    ).toHaveLength(1);
    await move(page, 'Order B', 'Move up', true);
    await expect(order(page)).toHaveText(['Order B', 'Order A', 'Order C']);
    await move(page, 'Order B', 'Move down');
    await expect(order(page)).toHaveText(titles);
    await openPlanstrandActions(row(page, 'Order A'));
    await expect(
      row(page, 'Order A').getByRole('button', { name: 'Move up', exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: `.tmp/phase-5c2a-ordering-${theme}.png`,
      fullPage: true,
    });
    await row(page, 'Order A').locator('summary').press('Escape');
    // Same-list pointer drop must use the supplied position, not Folder movement.
    const source = row(page, 'Order C').locator('.task-drag-handle');
    const target = row(page, 'Order A');
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    const halfSourceWidth = from!.width / 2;
    const sourceX = from!.x + halfSourceWidth;
    const halfSourceHeight = from!.height / 2;
    const sourceY = from!.y + halfSourceHeight;
    const halfTargetWidth = to!.width / 2;
    const targetX = to!.x + halfTargetWidth;
    await page.mouse.move(sourceX, sourceY);
    await page.mouse.down();
    await page.mouse.move(sourceX, from!.y - 12, { steps: 5 });
    await page.mouse.move(targetX, to!.y + 2, { steps: 20 });
    await page.mouse.up();
    await expect(order(page)).toHaveText(['Order C', 'Order A', 'Order B']);
    for (const route of ['/master-tasks', '/folder/INBOX_FOLDER', '/today']) {
      await page.goto('/#' + route);
      await expect(order(page)).toHaveText(['Order C', 'Order A', 'Order B']);
    }
    const unplanned = page.locator('.unplanned-section');
    await move(unplanned, 'Order A', 'Move up', true);
    await expect(order(unplanned)).toHaveText(['Order A', 'Order C', 'Order B']);
    await waitForStatePersistence(page);
    await page.reload();
    await expect(order(page.locator('.unplanned-section'))).toHaveText([
      'Order A',
      'Order C',
      'Order B',
    ]);
    expect(await snapshot(page)).toEqual(before);
    for (const title of titles) {
      await openPlanstrandActions(row(page, title));
      await row(page, title)
        .getByRole('button', { name: 'Plan Today', exact: true })
        .click();
    }
    const focus = page.locator('.planning-sections > section').first();
    await move(focus, 'Order B', 'Move up', true);
    await expect(order(focus)).toHaveText(['Order B', 'Order A', 'Order C']);
    const planned = await snapshot(page);
    await move(focus, 'Order B', 'Move down');
    await expect(order(focus)).toHaveText(['Order A', 'Order B', 'Order C']);
    await move(focus, 'Order B', 'Move up');
    await page.goto('/#/this-week');
    const day = page
      .locator('.planning-sections > section')
      .filter({ hasText: 'Order B' })
      .first();
    await move(day, 'Order B', 'Move down', true);
    await expect(order(day)).toHaveText(['Order A', 'Order B', 'Order C']);
    await move(day, 'Order B', 'Move up');
    for (const title of titles) {
      await openPlanstrandActions(row(page, title));
      await row(page, title)
        .getByRole('button', { name: 'Move to This Week', exact: true })
        .click();
    }
    const week = page.locator('.week-anytime');
    await move(week, 'Order B', 'Move up');
    await expect(order(week)).toHaveText(['Order B', 'Order A', 'Order C']);
    await waitForStatePersistence(page);
    await page.reload();
    await expect(order(page.locator('.week-anytime'))).toHaveText([
      'Order B',
      'Order A',
      'Order C',
    ]);
    const final = (await snapshot(page)) as { tasks: unknown; workSession: unknown };
    expect(final.tasks).toEqual((planned as { tasks: unknown }).tasks);
    expect(final.workSession).toEqual((planned as { workSession: unknown }).workSession);
  });
}
