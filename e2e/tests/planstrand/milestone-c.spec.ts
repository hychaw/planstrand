import { expect, test } from '../../fixtures/test.fixture';
import { Locator, Page } from '@playwright/test';
import { waitForStatePersistence } from '../../utils/waits';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
} from '../../utils/runtime-errors';

const savePrompt = async (page: Page, title: string): Promise<void> => {
  const dialog = page.locator('dialog-prompt');
  await dialog.locator('input').fill(title);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
};

const eventFor = (page: Page, title: string): Locator =>
  page.locator('schedule-event:not(.custom-drag-preview)').filter({ hasText: title });

const moveDown = async (page: Page, event: Locator): Promise<void> => {
  await expect(event).toHaveClass(/draggable/);
  await event.scrollIntoViewIfNeeded();
  const box = (await event.boundingBox())!;
  const halfWidth = box.width / 2;
  const centerX = box.x + halfWidth;
  const halfHeight = box.height / 2;
  const centerY = box.y + halfHeight;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX, centerY + 84, {
    steps: 12,
  });
  await page.mouse.up();
};

const resize = async (page: Page, event: Locator): Promise<void> => {
  const handle = event.locator('.resize-handle');
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const halfWidth = box.width / 2;
  const centerX = box.x + halfWidth;
  const halfHeight = box.height / 2;
  const centerY = box.y + halfHeight;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX, centerY + 84, {
    steps: 12,
  });
  await page.mouse.up();
  // The existing resize guard intentionally ignores clicks for 200 ms after release.
  await page.waitForTimeout(250);
};

test.describe('Planstrand V1 shipping smoke', () => {
  test('guides a fresh desktop and phone user through primary empty-state actions', async ({
    browser,
    baseURL,
  }) => {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 900 },
      });
      const page = await context.newPage();
      const errors = attachPageErrorCollector(page, 'V1 first use');
      try {
        await page.goto('/');
        await expect(page).toHaveURL(/#\/today$/);
        await expect(page.locator('planstrand-page')).toContainText(
          'Choose Plan Task on an unplanned task below',
        );
        await expect(page.locator('onboarding-hint')).toHaveCount(0);
        await page.goto('/#/inbox');
        const inbox = page.locator('planstrand-page section');
        await inbox.getByRole('button', { name: 'Add Task', exact: true }).click();
        await savePrompt(page, 'My first Planstrand Task');
        await expect(inbox).toContainText('My first Planstrand Task');
        await page.goto('/#/schedule');
        await page
          .getByRole('button', { name: 'New Event', exact: true })
          .first()
          .click();
        await expect(page.locator('dialog-event input[name=title]')).toBeFocused();
        await page
          .locator('dialog-event')
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        assertNoRuntimeBrowserErrors(errors, 'V1 first use');
      } finally {
        await context.close();
      }
    }
  });
  test('lands on Today and keeps primary navigation usable at representative widths', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/#\/today$/);
    await expect(page).toHaveTitle('Planstrand');
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [route, selector] of [
        ['inbox', 'planstrand-page'],
        ['master-tasks', 'planstrand-page'],
        ['today', 'planstrand-page'],
        ['this-week', 'planstrand-page'],
        ['schedule', 'schedule'],
      ]) {
        await page.goto(`/#/${route}`);
        await expect(page.locator(selector).last()).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }
      if (width === 390)
        await page
          .locator('mobile-bottom-nav')
          .getByRole('button', { name: 'Navigation', exact: true })
          .click();
      const nav = page.locator('magic-side-nav nav');
      for (const name of ['Inbox', 'Master Tasks', 'Today', 'This Week', 'Calendar']) {
        await expect(nav.getByRole('menuitem', { name, exact: true })).toBeVisible();
      }
      await expect(
        nav.getByRole('menuitem', { name: 'Planner', exact: true }),
      ).toBeHidden();
      const more = nav.locator('summary');
      await more.focus();
      await page.keyboard.press('Enter');
      await expect(
        nav.getByRole('menuitem', { name: 'Planner', exact: true }),
      ).toBeVisible();
      await more.click();
      if (width === 390)
        await nav.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'New Event', exact: true }).first().click();
      const editor = page.locator('dialog-event');
      await expect(editor.locator('input[name=title]')).toBeFocused();
      const bounds = (await page.locator('.mat-mdc-dialog-surface').boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.screenshot({ path: `.tmp/milestone-c-${width}.png` });
    }
    await page.goto('/#/folder/deleted-folder');
    await expect(page.locator('planstrand-page')).toContainText(
      'This Folder is no longer available',
    );
    await page.goto('/#/unknown-route');
    await expect(page).toHaveURL(/#\/today$/);
  });

  test('orders planned tasks, preserves WorkSessions when unplanned and after move/resize/reload', async ({
    page,
  }) => {
    await page.goto('/#/inbox');
    const inbox = page.locator('planstrand-page section');
    for (const title of ['Ship first Task', 'Ship second Task']) {
      await inbox.getByRole('button', { name: 'Add Task', exact: true }).click();
      await savePrompt(page, title);
      await inbox
        .locator('.task-entry')
        .filter({ hasText: title })
        .getByRole('combobox', { name: 'Plan Task' })
        .selectOption({ label: 'Today' });
    }
    await page.goto('/#/today');
    const planned = page.locator('planstrand-page section').first();
    const second = planned.locator('.task-entry').filter({ hasText: 'Ship second Task' });
    await second.getByRole('button', { name: 'Move up', exact: true }).click();
    await expect(planned.locator('task').first()).toContainText('Ship second Task');
    await second
      .getByRole('button', { name: 'Schedule WorkSession', exact: true })
      .click();
    const dialog = page.locator('dialog-schedule-task');
    await dialog.getByRole('button', { name: 'Today', exact: true }).click();
    await dialog.locator('input[type=time]').fill('10:00');
    await dialog.locator('[data-test-id=schedule-submit-btn]').click();
    await expect(dialog).toBeHidden();
    await second.getByRole('combobox', { name: 'Plan Task' }).selectOption('UNPLAN');
    await expect(planned).not.toContainText('Ship second Task');
    await page.goto('/#/schedule');
    await page.getByRole('button', { name: 'View Day', exact: true }).click();
    const session = eventFor(page, 'Ship second Task');
    await expect(session).toHaveCount(1);
    const originalClock = await session.locator('.time-badge').textContent();
    await moveDown(page, session);
    await expect(session.locator('.time-badge')).not.toHaveText(originalClock!);
    const movedClock = await session.locator('.time-badge').textContent();
    const before = (await session.boundingBox())!.height;
    await resize(page, session);
    await expect
      .poll(async () => (await session.boundingBox())!.height)
      .toBeGreaterThan(before);
    const resizedHeight = (await session.boundingBox())!.height;
    await waitForStatePersistence(page);
    await page.reload();
    await expect(session.locator('.time-badge')).toHaveText(movedClock!);
    expect(Math.abs((await session.boundingBox())!.height - resizedHeight)).toBeLessThan(
      3,
    );
    await page.goto('/#/today');
    await expect(page.locator('planstrand-page section').first()).not.toContainText(
      'Ship second Task',
    );
    await expect(page.locator('planstrand-page section').last()).toContainText(
      'Ship second Task',
    );
    const detail = page.locator('task-detail-panel');
    if (!(await detail.isVisible())) {
      const task = page
        .locator('planstrand-page section')
        .last()
        .locator('task')
        .filter({ hasText: 'Ship second Task' });
      await task.focus();
      await task.press('i');
    }
    await expect(page.locator('task-detail-panel')).toBeVisible();
  });

  test('persists real Event drag and resize, all-day CRUD, and offline reload', async ({
    page,
  }) => {
    await page.goto('/#/schedule');
    await page.getByRole('button', { name: 'View Day', exact: true }).click();
    await page.getByRole('button', { name: 'New Event', exact: true }).first().click();
    const dialog = page.locator('dialog-event');
    await dialog.locator('input[name=title]').fill('Ship timed Event');
    await dialog.locator('input[name=start]').fill('10:00');
    await dialog.locator('input[name=end]').fill('11:00');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const event = eventFor(page, 'Ship timed Event');
    await expect(event).toHaveCount(1);
    await moveDown(page, event);
    await event.click();
    await expect(dialog.locator('input[name=start]')).not.toHaveValue('10:00');
    const movedStart = await dialog.locator('input[name=start]').inputValue();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await resize(page, event);
    await event.click();
    const resizedEnd = await dialog.locator('input[name=end]').inputValue();
    expect(resizedEnd).not.toBe('11:00');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await waitForStatePersistence(page);
    await page.reload();
    await event.click();
    await expect(dialog.locator('input[name=start]')).toHaveValue(movedStart);
    await expect(dialog.locator('input[name=end]')).toHaveValue(resizedEnd);
    await dialog.locator('input[name=title]').fill('Ship edited Event');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'New Event', exact: true }).first().click();
    await dialog.locator('input[name=title]').fill('Ship all-day Event');
    await dialog.locator('input[name=allDay]').check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    for (const view of ['Day', 'Week', 'Month']) {
      await page.getByRole('button', { name: `View ${view}`, exact: true }).click();
      await expect(eventFor(page, 'Ship edited Event')).toHaveCount(1);
      await expect(eventFor(page, 'Ship all-day Event')).toHaveCount(1);
    }
    await waitForStatePersistence(page);
    await page.context().setOffline(true);
    // Development/E2E builds have no service worker. Offline edits still persist;
    // offline boot is also exercised when a production PWA worker controls the page.
    const hasWorker = await page.evaluate(() => !!navigator.serviceWorker?.controller);
    if (hasWorker) await page.reload();
    await expect(eventFor(page, 'Ship all-day Event')).toHaveCount(1);
    await eventFor(page, 'Ship all-day Event').click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .locator('dialog-confirm')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(eventFor(page, 'Ship all-day Event')).toHaveCount(0);
    await waitForStatePersistence(page);
    if (!hasWorker) await page.context().setOffline(false);
    await page.reload();
    await expect(eventFor(page, 'Ship all-day Event')).toHaveCount(0);
    await expect(eventFor(page, 'Ship edited Event')).toHaveCount(1);
  });
});
