import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';

test('separates Task and Planning actions, dismisses the other menu and supports keyboard focus', async ({
  page,
}) => {
  await page.goto('/#/inbox');
  for (const title of ['Menu A', 'Menu B']) {
    await page.locator('.quick-capture input').fill(title);
    await page.locator('.quick-capture input').press('Enter');
  }
  const row = page.locator('.task-entry').filter({ hasText: 'Menu B' });
  const summary = row.locator('summary').first();
  await summary.press('Enter');
  await expect(row.locator('.commands')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Move up', exact: true })).toHaveCount(0);
  await expect(
    row.getByRole('button', { name: 'Move Task to Folder', exact: true }),
  ).toHaveCount(0);
  await row.locator('task').first().click({ button: 'right' });
  await expect(row.locator('.commands')).toBeHidden();
  await expect(
    page.getByRole('menuitem', { name: 'Move up', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.quick-access')).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', {
      name: /Plan Today|Schedule WorkSession|Move to Top|Move to Bottom/i,
    }),
  ).toHaveCount(0);
  // Keyboard opening also closes an active context overlay.
  await summary.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(row.locator('.commands')).toBeVisible();
  await summary.press('Escape');
  await expect(summary).toBeFocused();
  await row.locator('task').first().focus();
  await page.keyboard.press('Shift+F10');
  const up = page.getByRole('menuitem', { name: 'Move up', exact: true });
  await up.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.task-entry task .task-title')).toHaveText([
    'Menu B',
    'Menu A',
  ]);
  await expect(row.locator('task').first()).toBeFocused();
});

test('moves Folder ownership from the context menu and preserves nested sibling ordering after reload', async ({
  page,
}) => {
  await page.goto('/#/master-tasks');
  await page.getByRole('button', { name: 'Create Folder', exact: true }).first().click();
  await page.locator('dialog-prompt input').fill('Menu Folder');
  await page
    .locator('dialog-prompt')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  const inbox = page
    .locator('.folder-section')
    .filter({ has: page.getByRole('heading', { name: '▾ Inbox', exact: true }) });
  await inbox.locator('.quick-capture input').fill('Menu Parent');
  await inbox.locator('.quick-capture input').press('Enter');
  const row = page.locator('.task-entry').filter({ hasText: 'Menu Parent' });
  await row.locator('task').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move Task to Folder', exact: true }).click();
  await page
    .locator('planstrand-folder-picker select')
    .selectOption({ label: 'Menu Folder' });
  await page
    .locator('planstrand-folder-picker')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  const folder = page
    .locator('.folder-section')
    .filter({ has: page.getByRole('heading', { name: '▾ Menu Folder', exact: true }) });
  await expect(folder).toContainText('Menu Parent');
  await expect(inbox).not.toContainText('Menu Parent');
  await page.evaluate(() => {
    const store = (window as any).__e2eTestHelpers.store;
    let parent: any;
    const sub = store.subscribe(
      (state: any) =>
        (parent = Object.values(state.tasks.entities).find(
          (t: any) => t.title === 'Menu Parent',
        )),
    );
    sub.unsubscribe();
    // Use the app's existing Task command via the rendered component.
    const host = document.getElementById('t-' + parent.id)!;
    const service = (window as any).ng.getComponent(host)._taskService;
    service.addSubTaskTo(parent.id, { title: 'Menu Child A' });
    service.addSubTaskTo(parent.id, { title: 'Menu Child B' });
  });
  const children = folder.locator('.sub-tasks task');
  await expect(children.locator('.task-title')).toHaveText([
    'Menu Child A',
    'Menu Child B',
  ]);
  await children.filter({ hasText: 'Menu Child A' }).click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Move up', exact: true }),
  ).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Move down', exact: true }).click();
  await expect(children.locator('.task-title')).toHaveText([
    'Menu Child B',
    'Menu Child A',
  ]);
  await children.filter({ hasText: 'Menu Child A' }).locator('summary').press('Enter');
  await expect(
    children
      .filter({ hasText: 'Menu Child A' })
      .getByRole('button', { name: 'Plan Tomorrow', exact: true }),
  ).toBeVisible();
  await children.filter({ hasText: 'Menu Child A' }).locator('summary').press('Escape');
  await waitForStatePersistence(page);
  await page.reload();
  await expect(children.locator('.task-title')).toHaveText([
    'Menu Child B',
    'Menu Child A',
  ]);
  await expect(folder).toContainText('Menu Parent');
});

test.describe('touch Task menu access', () => {
  test.use({
    contextOptions: {
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    },
  });
  test('has separate touch controls for essential Task actions and Planning', async ({
    page,
  }) => {
    await page.goto('/#/inbox');
    await page.locator('.quick-capture input').fill('Touch menu');
    await page.locator('.quick-capture input').press('Enter');
    const row = page.locator('.task-entry').filter({ hasText: 'Touch menu' });
    await row.locator('.task-context-trigger').tap();
    await expect(
      page.getByRole('menuitem', { name: 'Move Task to Folder', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Delete task', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Move up', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await row.locator('summary').tap();
    const plan = row.getByRole('button', { name: 'Plan Tomorrow', exact: true });
    await expect(plan).toBeVisible();
    await plan.tap();
    await expect(row.locator('.commands')).toBeHidden();
    await row.locator('summary').tap();
    await expect(
      row.getByRole('button', { name: 'Schedule WorkSession', exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: '.tmp/task-menu-touch.png' });
  });
});
