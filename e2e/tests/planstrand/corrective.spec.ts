import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';

test('Task drag into My Day creates one independent persisted WorkSession', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#/inbox');
  const capture = page.locator('.quick-capture input');
  await capture.fill('Flight briefing drag regression');
  await capture.press('Enter');
  await page.goto('/#/today');
  const row = page
    .locator('.task-entry')
    .filter({ hasText: 'Flight briefing drag regression' });
  await row.hover();
  const source = (await row.locator('.task-drag-handle').boundingBox())!;
  const zone = (await page.locator('schedule-day-panel').boundingBox())!;
  const halfWidth = source.width / 2;
  const x = source.x + halfWidth;
  const halfHeight = source.height / 2;
  const y = source.y + halfHeight;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y + 10, { steps: 3 });
  await expect(page.locator('.cdk-drag-preview')).toBeVisible();
  const targetHalfWidth = zone.width / 2;
  await page.mouse.move(zone.x + targetHalfWidth, zone.y + 240, { steps: 25 });
  await expect(page.locator('schedule-week .custom-drag-preview')).toBeVisible();
  await page.mouse.up();
  const session = page
    .locator('schedule-event:not(.custom-drag-preview)')
    .filter({ hasText: 'Flight briefing drag regression' });
  await expect(session).toHaveCount(1);
  await expect(page.locator('.planning-sections > section').first()).not.toContainText(
    'Flight briefing drag regression',
  );
  await expect(row.locator('task')).not.toHaveClass(/isDone/);
  await waitForStatePersistence(page);
  await page.reload();
  await expect(session).toHaveCount(1);
  await expect(row).toHaveCount(1);
});

test('utility controls remain accessible and collapsed icons stay inside their rail', async ({
  page,
}) => {
  await page.goto('/#/today');
  const utilities = page.getByRole('button', { name: 'Utilities', exact: true });
  await expect(page.locator('.tour-addBtn')).toBeHidden();
  await utilities.click();
  await expect(page.locator('.tour-addBtn')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tour-addBtn')).toBeHidden();
  await expect(page).toHaveURL(/#\/today$/);
  for (const width of [1600, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    const nav = page.locator('magic-side-nav .nav-sidenav');
    const toggle = nav.locator('.mode-toggle');
    for (let repeat = 0; repeat < 2; repeat++) {
      await toggle.click();
      await expect(nav).toHaveClass(/compactMode/);
      for (const name of ['Today', 'This Week', 'Tasks', 'Calendar']) {
        await expect(nav.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
      }
      await expect
        .poll(async () => {
          const rail = await nav.boundingBox();
          const icons = await nav.locator('nav-item .nav-icon').evaluateAll((elements) =>
            elements
              .map((el) => el.getBoundingClientRect())
              .filter((rect) => rect.width > 0)
              .map((rect) => ({ x: rect.x, width: rect.width })),
          );
          const railHalfWidth = rail!.width / 2;
          const railCenter = rail!.x + railHalfWidth;
          return (
            icons.length >= 7 &&
            icons.every((box) => {
              const halfWidth = box.width / 2;
              const center = box.x + halfWidth;
              return Math.abs(center - railCenter) < 2;
            })
          );
        })
        .toBe(true);
      await toggle.click();
      await expect(nav).toHaveClass(/fullMode/);
    }
  }
});
