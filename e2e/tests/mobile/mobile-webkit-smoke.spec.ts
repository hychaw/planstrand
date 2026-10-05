import { expect, test } from '../../fixtures/test.fixture';

test.describe('Mobile WebKit smoke', () => {
  test('supports touch navigation and task creation', async ({ page, testPrefix }) => {
    const mobileNav = page.locator('mobile-bottom-nav');
    await expect(mobileNav).toBeVisible();

    await mobileNav.getByRole('button', { name: 'This Week', exact: true }).tap();
    await expect(page).toHaveURL(/\/#\/this-week/);
    await expect(page.locator('planstrand-page')).toBeVisible();

    await mobileNav.getByRole('button', { name: 'Today', exact: true }).tap();
    await expect(page).toHaveURL(/\/#\/today/);
    await expect(page.locator('planstrand-task-list').first()).toBeVisible();

    await mobileNav.getByRole('button', { name: 'Add new task', exact: true }).tap();
    const taskTitle = `${testPrefix}-MobileWebKit`;
    const addTaskInput = page.locator('add-task-bar.global .main-input');
    await expect(addTaskInput).toBeVisible();
    await addTaskInput.fill(taskTitle);
    await page.locator('.e2e-add-task-submit').tap();

    await expect(page.locator('task').filter({ hasText: taskTitle })).toHaveCount(1);
  });
});
