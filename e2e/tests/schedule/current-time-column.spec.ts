import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

test.use({ contextOptions: { timezoneId: 'UTC' } });
const configure = async (page: Page, firstDayOfWeek: number): Promise<void> => {
  await page.evaluate((firstDay) => {
    (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers.store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'localization',
      sectionCfg: { firstDayOfWeek: firstDay, timeZone: 'America/Vancouver' },
      isSkipSnack: true,
      meta: {
        isPersistent: true,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'localization',
        opType: 'UPD',
      },
    });
  }, firstDayOfWeek);
};
const assertColumn = async (page: Page, day: string, column: number): Promise<void> => {
  const week = page.locator('schedule > .scroll-wrapper schedule-week');
  const line = week.locator('#current-time');
  await expect(line).toHaveCSS('grid-column-start', String(column));
  const alignment = await week.evaluate((el, date) => {
    const indicator = el.querySelector('#current-time')!.getBoundingClientRect();
    const col = el
      .querySelector(`.col:not(.end-of-day)[data-day="${date}"]`)!
      .getBoundingClientRect();
    return {
      left: Math.abs(indicator.left - col.left),
      right: Math.abs(indicator.right - col.right),
    };
  }, day);
  expect(alignment.left).toBeLessThan(2);
  expect(alignment.right).toBeLessThan(2);
};
for (const firstDay of [1, 0]) {
  test(`Tuesday current-time column with weekday ${firstDay}, scrolling, Day and My Day`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-13T19:00:00Z'));
    await page.reload();
    await configure(page, firstDay);
    await page.setViewportSize(
      firstDay === 1 ? { width: 1280, height: 900 } : { width: 375, height: 812 },
    );
    await page.goto('/#/schedule');
    await page.getByRole('button', { name: 'View Week', exact: true }).click();
    const week = page.locator('schedule .scroll-wrapper schedule-week');
    await expect(week.locator('#current-time')).toHaveCSS('grid-row-start', '145');
    await assertColumn(page, '2026-10-13', firstDay === 1 ? 3 : 4);
    await expect(week.locator('.col.end-of-day[data-day="2026-10-13"]')).toHaveCSS(
      'grid-row-start',
      '145',
    );
    await expect(
      week
        .locator('.day')
        .filter({ has: page.locator('mat-icon', { hasText: 'wb_sunny' }) }),
    ).toHaveCount(1);
    if (firstDay === 0) {
      await expect
        .poll(() =>
          page.locator('schedule .scroll-wrapper').evaluate((el) => {
            el.scrollLeft = 180;
            return el.scrollLeft;
          }),
        )
        .toBeGreaterThan(0);
      await expect(week).toHaveAttribute('data-hscrolled', 'true');
      await assertColumn(page, '2026-10-13', 4);
    }
    await page.getByRole('button', { name: 'Next Week', exact: true }).click();
    await expect(week.locator('#current-time')).toHaveCount(0);
    await page.locator('schedule .today-btn').click();
    await assertColumn(page, '2026-10-13', firstDay === 1 ? 3 : 4);
    await page.getByRole('button', { name: 'View Day', exact: true }).click();
    await assertColumn(page, '2026-10-13', 2);
    await page.goto('/#/today');
    if (firstDay === 0)
      await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    const panel = page.locator('schedule-day-panel');
    await expect(panel.locator('#current-time')).toHaveCSS('grid-column-start', '2');
    await expect(panel.locator('#current-time')).toHaveCSS('grid-row-start', '145');
    await expect(panel.locator('.col:not(.end-of-day)')).toHaveAttribute(
      'data-day',
      '2026-10-13',
    );
  });
}

test('display-zone midnight and the existing refresh move the line to Wednesday', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-14T06:59:00Z') });
  await page.reload();
  await configure(page, 1);
  await page.goto('/#/schedule');
  await page.getByRole('button', { name: 'View Week', exact: true }).click();
  await assertColumn(page, '2026-10-13', 3);
  await page.clock.fastForward(120000);
  await assertColumn(page, '2026-10-14', 4);
  await expect(page.locator('schedule #current-time')).toHaveCSS('grid-row-start', '1');
  await page.clock.fastForward(240000);
  await expect(page.locator('schedule #current-time')).toHaveCSS('grid-row-start', '2');
  await page.goto('/#/today');
  const panel = page.locator('schedule-day-panel');
  await expect(panel.locator('#current-time')).toHaveCSS('grid-column-start', '2');
  await expect(panel.locator('#current-time')).toHaveCSS('grid-row-start', '2');
  await expect(panel.locator('.col:not(.end-of-day)')).toHaveAttribute(
    'data-day',
    '2026-10-14',
  );
});
