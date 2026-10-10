import { expect, test } from '../../fixtures/test.fixture';

test('Weekly Templates Calendar workflow, keyboard focus and mobile layout', async ({
  page,
}, testInfo) => {
  // A wrapped toolbar must remain clickable above the sticky Calendar header.
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto('/#/schedule');
  await page.locator('.e2e-cancelled-occurrences').click();
  await page
    .locator('dialog-cancelled-occurrences')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  const trigger = page.locator('.e2e-weekly-templates');
  await trigger.click();
  const manager = page.locator('dialog-weekly-templates');
  await manager.getByRole('button', { name: 'Create template', exact: true }).click();
  await expect(manager.locator('input[name="title"]')).toBeFocused();
  await manager.locator('input[name="title"]').fill('Smoke week');
  await manager.getByRole('button', { name: 'Save', exact: true }).click();
  for (const title of ['Smoke class A', 'Smoke class B']) {
    await manager.getByRole('button', { name: 'Add entry', exact: true }).click();
    const editor = page.locator('dialog-event');
    await editor.locator('input[name="title"]').fill(title);
    await editor.locator('input[name="allDay"]').check();
    // Include every weekday so visibility is independent of the test date.
    for (const day of [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
      await editor.getByRole('checkbox', { name: day, exact: true }).check();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(
      manager.getByRole('button', { name: 'Add entry', exact: true }),
    ).toBeFocused();
  }
  await expect(manager).not.toContainText(/\u00c2|\u00e2\u20ac/);
  await manager.getByRole('button', { name: 'Activate', exact: true }).click();
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(
    page.locator('schedule-event').filter({ hasText: 'Smoke class A' }).first(),
  ).toBeVisible();
  for (const view of ['Day', 'Month', 'Week']) {
    await page.getByRole('button', { name: `View ${view}`, exact: true }).click();
    await expect(
      page.locator('schedule-event').filter({ hasText: 'Smoke class A' }).first(),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Year', exact: true }).click();
  await expect(page.locator('schedule-year .activity.has-items').first()).toBeVisible();
  await trigger.click();
  await manager.getByRole('button', { name: /Smoke week/ }).click();
  await manager.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.locator('schedule-event').filter({ hasText: 'Smoke class A' }),
  ).toHaveCount(0);
  await expect(page.locator('schedule-year .activity.has-items')).toHaveCount(0);
  await page.getByRole('button', { name: 'View Week', exact: true }).click();
  await trigger.click();
  await manager.getByRole('button', { name: /Smoke week/ }).click();
  await manager
    .getByRole('button', { name: 'Edit Event: Smoke class A', exact: true })
    .click();
  const editor = page.locator('dialog-event');
  await editor.locator('input[name="title"]').fill('Smoke edited');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await manager.getByRole('button', { name: 'Activate', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    manager.getByRole('button', { name: 'Add entry', exact: true }),
  ).toBeInViewport();
  expect(await manager.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('weekly-templates-mobile.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(manager).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(
    page.locator('schedule-event').filter({ hasText: 'Smoke edited' }).first(),
  ).toBeVisible();
});
