import { test, expect } from '../../fixtures/test.fixture';
import { Locator } from '@playwright/test';
import { openPlanstrandActions } from '../../utils/planstrand-actions';

test.describe('Blue Thread V1.1', () => {
  test('keeps task and recursive Folder drag/drop semantics through reload', async ({
    page,
  }) => {
    await page.goto('/#/master-tasks');
    for (const title of ['Blue Origin', 'Blue Target']) {
      await page
        .locator('planstrand-page header')
        .getByRole('button', { name: 'Create Folder', exact: true })
        .click();
      const prompt = page.locator('dialog-prompt');
      await prompt.locator('input').fill(title);
      await prompt.getByRole('button', { name: 'Save', exact: true }).click();
    }
    const section = (title: string): Locator =>
      page
        .locator('planstrand-page section')
        .filter({ has: page.getByRole('heading', { name: `▾ ${title}`, exact: true }) });
    const origin = section('Blue Origin');
    const target = section('Blue Target');
    await origin.locator('.quick-capture input').fill('Blue dragged Task');
    await origin.locator('.quick-capture input').press('Enter');
    const row = page.locator('.task-entry').filter({ hasText: 'Blue dragged Task' });
    await row.hover();
    const drag = async (source: Locator, destination: Locator): Promise<void> => {
      await destination.scrollIntoViewIfNeeded();
      const from = (await source.boundingBox())!;
      const to = (await destination.boundingBox())!;
      const halfWidth = from.width / 2;
      const halfHeight = from.height / 2;
      const x = from.x + halfWidth;
      const y = from.y + halfHeight;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 8, y + 8, { steps: 3 });
      const targetHalfWidth = to.width / 2;
      const targetHalfHeight = to.height / 2;
      const targetX = to.x + targetHalfWidth;
      const targetY = to.y + targetHalfHeight;
      await page.mouse.move(targetX, targetY, { steps: 20 });
      await page.mouse.up();
    };
    await drag(row.locator('.task-drag-handle'), target.locator('.task-list'));
    await expect(target).toContainText('Blue dragged Task');
    await expect(origin).not.toContainText('Blue dragged Task');
    await drag(target.locator('h2'), origin.locator('h2'));
    const nestedLink = page.locator(
      'planstrand-folder-navigation a[title="Blue Origin / Blue Target"]',
    );
    await expect(nestedLink).toBeVisible();
    await page.reload();
    await expect(nestedLink).toBeVisible();
    await expect(target).toContainText('Blue dragged Task');
    await openPlanstrandActions(row);
    await row.getByRole('button', { name: /Move Task to Folder/ }).click();
    await page
      .locator('planstrand-folder-picker select')
      .selectOption({ label: 'Inbox' });
    await page
      .locator('planstrand-folder-picker')
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(section('Inbox')).toContainText('Blue dragged Task');
  });
  test('navigates Year, Month and Day, including a previous year and reload', async ({
    page,
  }) => {
    await page.goto('/#/schedule');
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    const year = page.locator('schedule-year');
    await expect(year.locator('section')).toHaveCount(12);
    const label = await page.locator('.schedule-nav-controls .title').textContent();
    await page.getByRole('button', { name: 'Previous year', exact: true }).click();
    await expect(page.locator('.schedule-nav-controls .title')).toHaveText(
      String(Number(label) - 1),
    );
    await page.reload();
    await expect(year).toBeVisible();
    // View mode is local; the current period resets on a fresh route as in V1.
    await year.getByRole('button', { name: 'February', exact: true }).click();
    await expect(page.locator('schedule-month')).toBeVisible();
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await year.locator('.day').first().click();
    await expect(page.locator('schedule-week')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'View Day', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('captures with Enter and keeps explicit task actions keyboard accessible', async ({
    page,
  }) => {
    await page.goto('/#/inbox');
    const capture = page.locator('.quick-capture input');
    await capture.fill('Blue Thread keyboard capture');
    await capture.press('Enter');
    const row = page
      .locator('.task-entry')
      .filter({ hasText: 'Blue Thread keyboard capture' });
    await expect(row).toBeVisible();
    await expect(row.locator('.commands')).toBeHidden();
    const actions = row.locator('summary');
    await actions.focus();
    await actions.press('Enter');
    await expect(row.getByRole('combobox', { name: 'Plan Task' })).toBeVisible();
    await actions.press('Escape');
    await expect(row.locator('.commands')).toBeHidden();
    await actions.press('Enter');
    await row.getByRole('combobox', { name: 'Plan Task' }).selectOption('WEEK');
    await expect(row.locator('.commands')).toBeHidden();
    await page.goto('/#/this-week');
    await expect(
      page.locator('section').filter({ hasText: 'Anytime this week' }),
    ).toContainText('Blue Thread keyboard capture');
    await page.reload();
    await expect(page.locator('planstrand-page')).toContainText(
      'Blue Thread keyboard capture',
    );
  });

  test('persists device density and themes and adapts Year and Today to phone/tablet', async ({
    page,
  }) => {
    await page.goto('/#/config');
    const appearance = page.locator('theme-selector');
    await appearance.getByRole('radio', { name: 'Compact', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-density', 'compact');
    await appearance.getByRole('radio', { name: 'Dark', exact: true }).click();
    await expect(page.locator('body')).toHaveClass(/isDarkTheme/);
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-density', 'compact');
    await expect(page.locator('body')).toHaveClass(/isDarkTheme/);
    await page.goto('/#/schedule');
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await expect(page.locator('schedule-year section')).toHaveCount(12);
    await page.screenshot({
      path: '.tmp/blue-thread-year-dark.png',
      animations: 'disabled',
    });
    await page.goto('/#/config');
    await appearance.getByRole('radio', { name: 'Comfortable', exact: true }).click();
    await appearance.getByRole('radio', { name: 'Light', exact: true }).click();
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#/schedule');
      await page.getByRole('button', { name: 'Year', exact: true }).click();
      await expect(page.locator('schedule-year section')).toHaveCount(12);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await page.screenshot({ path: `.tmp/blue-thread-year-${width}.png` });
    }
    await page.goto('/#/today');
    const switcher = page.locator('.today-switch');
    await expect(switcher).toBeVisible();
    await switcher.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(page.locator('.day-schedule')).toBeVisible();
    await expect(page.locator('.planning-sections')).toBeHidden();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration).toBe('1e-05s');
  });
});
