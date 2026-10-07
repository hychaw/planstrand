import { test, expect } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';

test('focused shell, useful Utilities and simplified Settings', async ({ page }) => {
  await page.goto('/#/today');
  const nav = page.locator('magic-side-nav nav');
  for (const name of ['Today', 'This Week', 'Tasks', 'Calendar']) {
    await expect(nav.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  for (const text of ['More', 'Search', 'Help', 'Settings', 'Support us', 'Legacy']) {
    await expect(nav).not.toContainText(text);
  }
  await expect(nav.locator('planstrand-folder-navigation')).toContainText('Inbox');
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page.locator('search-page').getByRole('textbox')).toBeVisible();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  const utilities = page.locator('#planstrand-utilities');
  await expect(
    utilities.locator(
      'play-button, focus-button, simple-counter-button, [class*="plugin"]',
    ),
  ).toHaveCount(0);
  await expect(
    utilities.getByRole('button', { name: 'Add Task', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  const appMenu = page.getByRole('button', { name: 'App menu', exact: true });
  await appMenu.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('menuitem', { name: 'Settings', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Help', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(appMenu).toBeFocused();
  await page.getByRole('button', { name: 'App menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(6);
  for (const name of [
    'General',
    'Appearance',
    'Tasks',
    'Calendar',
    'Sync & Backup',
    'About',
  ]) {
    await expect(page.getByRole('tab', { name: new RegExp(`${name}$`) })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Show Work Start / End on this device' }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'App menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'About', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'About Planstrand' })).toBeVisible();
  await page
    .getByText('Open-source acknowledgements / Licenses', { exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Super Productivity', exact: true }),
  ).toBeVisible();
  for (const notice of ['/assets/upstream-license.txt', '/3rdpartylicenses.txt']) {
    const response = await page.request.get(notice);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('Copyright');
  }
  await page.getByRole('button', { name: 'App menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Help', exact: true })).toBeVisible();
});

test('week Add captures directly into Anytime, Monday and Thursday and survives reload', async ({
  page,
}) => {
  await page.goto('/#/this-week');
  for (const day of ['Anytime This Week', 'Monday', 'Thursday']) {
    await page.getByRole('button', { name: `Add Task: ${day}`, exact: true }).click();
    const prompt = page.locator('dialog-prompt');
    await prompt.locator('input').fill(`Capture for ${day}`);
    await prompt.getByRole('button', { name: 'Save', exact: true }).click();
    const section = page.locator('.planning-sections > section').filter({
      has: page.getByRole('button', { name: `Add Task: ${day}`, exact: true }),
    });
    await expect(section.locator('.task-entry')).toContainText(`Capture for ${day}`);
  }
  await waitForStatePersistence(page);
  await page.reload();
  for (const day of ['Anytime This Week', 'Monday', 'Thursday']) {
    const section = page.locator('.planning-sections > section').filter({
      has: page.getByRole('button', { name: `Add Task: ${day}`, exact: true }),
    });
    await expect(section.locator('.task-entry')).toContainText(`Capture for ${day}`);
  }
  await expect(page.locator('.unplanned-section')).not.toContainText('Capture for');
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await page.locator('search-page').getByRole('textbox').fill('Capture for Monday');
  await page
    .locator('search-page .task-title')
    .filter({ hasText: 'Capture for Monday' })
    .click();
  await expect(page).toHaveURL(/#\/folder\//);
  await expect(page.locator('task-detail-panel')).toContainText('Capture for Monday');
});

test('My Day creation hover clears after rapid exit and scrolling without a permanent drag banner', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#/today');
  const panel = page.locator('schedule-day-panel');
  await expect(panel.locator('.empty-state')).toHaveCount(0);
  const grid = panel.locator('.grid-container');
  await expect(grid).toBeVisible();
  // My Day scrolls to the current time once after opening. That scroll correctly
  // clears a hover preview, so begin the gesture after it has settled.
  await page.waitForTimeout(250);
  const box = (await panel.boundingBox())!;
  const halfWidth = box.width / 2;
  await page.mouse.move(box.x + halfWidth, box.y + 240);
  await page.mouse.move(box.x + halfWidth, box.y + 250);
  await expect(grid.locator('create-task-placeholder')).toBeVisible();
  await page.mouse.move(10, 10);
  await expect(grid.locator('create-task-placeholder')).toHaveCount(0);
  await page.waitForTimeout(80);
  await expect(grid.locator('create-task-placeholder')).toHaveCount(0);
  await page.mouse.move(box.x + halfWidth, box.y + 240);
  await expect(grid.locator('create-task-placeholder')).toBeVisible();
  await page.mouse.wheel(0, 100);
  await expect(grid.locator('create-task-placeholder')).toHaveCount(0);
  await page.goto('/#/this-week');
  await expect(page.locator('create-task-placeholder')).toHaveCount(0);
});
