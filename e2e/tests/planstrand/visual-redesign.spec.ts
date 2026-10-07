import { test, expect } from '../../fixtures/test.fixture';
import { openPlanstrandActions } from '../../utils/planstrand-actions';

test('Today separates completed planned Tasks without duplicating capture or placement', async ({
  page,
}) => {
  await page.goto('/#/inbox');
  const input = page.locator('.quick-capture input');
  await input.fill('Review final flight plan');
  await input.press('Enter');
  const row = page.locator('.task-entry').filter({ hasText: 'Review final flight plan' });
  await openPlanstrandActions(row);
  await row.getByRole('combobox', { name: 'Plan Task' }).selectOption({ label: 'Today' });
  await page.goto('/#/today');
  await expect(page.locator('.planning-sections > section').first()).toContainText(
    'Review final flight plan',
  );
  await row.locator('done-toggle').click();
  await expect(page.locator('.completed-section')).toContainText(
    'Review final flight plan',
  );
  await expect(page.locator('.planning-sections > section').first()).not.toContainText(
    'Review final flight plan',
  );
  await expect(row).toHaveCount(1);
  for (const title of ['Check weather briefing', 'Review route alternatives']) {
    await page.goto('/#/inbox');
    await input.fill(title);
    await input.press('Enter');
    const captured = page.locator('.task-entry').filter({ hasText: title });
    await openPlanstrandActions(captured);
    await captured
      .getByRole('combobox', { name: 'Plan Task' })
      .selectOption({ label: 'Today' });
  }
  await page.goto('/#/today');
  const focus = page.locator('.planning-sections > section').first();
  const last = focus.locator('.task-entry').last();
  const lastTitle = await last.locator('.task-title').innerText();
  await openPlanstrandActions(last);
  await last.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(focus.locator('.task-entry').first()).toContainText(lastTitle);
  await page.reload();
  await expect(page.locator('.completed-section')).toContainText(
    'Review final flight plan',
  );
  await expect(row).toHaveCount(1);
  await expect(focus.locator('.task-entry').first()).toContainText(lastTitle);
});
