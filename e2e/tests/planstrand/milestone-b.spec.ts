import { expect, test } from '../../fixtures/test.fixture';

test.describe('Fast-Track Milestone B local Events', () => {
  test('creates, edits, persists offline, converts to all-day across views and deletes', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/schedule');
    await page.getByRole('button', { name: 'View Day', exact: true }).click();
    await page.getByRole('button', { name: 'New Event', exact: true }).first().click();
    const dialog = page.locator('dialog-event');
    await dialog.locator('input[name=title]').fill('Milestone B Event');
    await dialog.locator('input[name=start]').fill('10:00');
    await dialog.locator('input[name=end]').fill('11:00');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const event = page.locator('schedule-event').filter({ hasText: 'Milestone B Event' });
    await expect(event).toHaveCount(1);
    await event.click();
    await dialog.locator('input[name=title]').fill('Edited B Event');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.locator('schedule-event').filter({ hasText: 'Edited B Event' }),
    ).toHaveCount(1);
    await page.reload();
    await page.context().setOffline(true);
    const edited = page.locator('schedule-event').filter({ hasText: 'Edited B Event' });
    await expect(edited).toHaveCount(1);
    await edited.click();
    await dialog.locator('input[name=allDay]').check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.locator('.week-header schedule-event').filter({ hasText: 'Edited B Event' }),
    ).toHaveCount(1);
    await page.getByRole('button', { name: 'View Week', exact: true }).click();
    await expect(edited).toHaveCount(1);
    await page.getByRole('button', { name: 'View Month', exact: true }).click();
    await expect(edited).toHaveCount(1);
    await edited.click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .locator('dialog-confirm')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(edited).toHaveCount(0);
  });
});
