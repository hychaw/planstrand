import { expect, test } from '../../fixtures/test.fixture';

const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

test.describe('Schedule split segments', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('should open the session menu when a continued segment is clicked', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    // Set the Task estimate before creating its independent WorkSession.
    await workViewPage.addTask('Runs past midnight 30h');
    const task = taskPage.getTaskByText('Runs past midnight').first();
    await task.focus();
    await page.keyboard.press('s');
    const dialog = page.locator('dialog-schedule-task');
    await expect(dialog).toBeVisible();
    await dialog.locator('.mat-calendar-body-today').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await dialog.locator('input[type="time"]').fill('12:00');
    await dialog.locator('[data-test-id="schedule-submit-btn"]').click();
    await expect(dialog).toBeHidden();
    await page.getByRole('menuitem', { name: 'Schedule' }).click();

    // A 30h estimate crosses midnight no matter which hour the click lands on,
    // so the split does not depend on the grid's scroll position or on the time
    // of day the test runs at. Two later columns stay visible for the tails.
    const segments = page
      .locator('schedule-event.ScheduledTask')
      .filter({ hasText: 'Runs past midnight' });
    await expect(segments).toHaveCount(2);
    const continuedSegment = segments.nth(1);
    await expect(continuedSegment).toBeVisible();

    await continuedSegment.click({ position: { x: 0, y: 0 } });

    await expect(
      page.getByRole('menuitem', { name: 'Unschedule', exact: true }),
    ).toBeVisible();
    // Removing a continued segment removes the same session across both days.
    await page.getByRole('menuitem', { name: 'Unschedule', exact: true }).click();
    await expect(segments).toHaveCount(0);
  });
});
