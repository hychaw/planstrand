import { expect, test } from '../../fixtures/test.fixture';
const calendarAddDays = (day: string, count: number): string => {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};

test.use({ contextOptions: { timezoneId: 'America/New_York' } });
for (const [firstDayOfWeek, instant, start] of [
  [1, '2026-12-30T17:00:00Z', '2026-12-28'],
  [0, '2026-12-30T17:00:00Z', '2026-12-27'],
  [1, '2026-03-04T17:00:00Z', '2026-03-02'],
  [0, '2026-10-28T17:00:00Z', '2026-10-25'],
] as const) {
  test(`Calendar full week ${start} with first weekday ${firstDayOfWeek}`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(instant));
    await page.reload();
    await page.evaluate((firstDay) => {
      (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
        }
      ).__e2eTestHelpers.store.dispatch({
        type: '[Global Config] Update Global Config Section',
        sectionKey: 'localization',
        sectionCfg: { firstDayOfWeek: firstDay, timeZone: 'America/New_York' },
        isSkipSnack: true,
        meta: {
          isPersistent: true,
          entityType: 'GLOBAL_CONFIG',
          entityId: 'localization',
          opType: 'UPD',
        },
      });
    }, firstDayOfWeek);
    await page.goto('/#/schedule');
    const columns = page.locator('schedule-week .col:not(.end-of-day)[data-day]');
    await page.getByRole('button', { name: 'View Day', exact: true }).click();
    await expect(columns).toHaveCount(1);
    await expect(columns.first()).toHaveAttribute('data-day', instant.slice(0, 10));
    await page.getByRole('button', { name: 'View Week', exact: true }).click();
    const dates = (): Promise<(string | null)[]> =>
      columns.evaluateAll((els) => els.map((el) => el.getAttribute('data-day')));
    await expect
      .poll(dates)
      .toEqual(Array.from({ length: 7 }, (_, i) => calendarAddDays(start, i)));
    await page.getByRole('button', { name: 'Next Week', exact: true }).click();
    await expect(columns.first()).toHaveAttribute('data-day', calendarAddDays(start, 7));
    await page.getByRole('button', { name: 'Previous Week', exact: true }).click();
    await expect(columns.first()).toHaveAttribute('data-day', start);
    await page.getByRole('button', { name: 'Previous Week', exact: true }).click();
    await expect(columns.first()).toHaveAttribute('data-day', calendarAddDays(start, -7));
    await page.locator('schedule .today-btn').click();
    await expect(columns.first()).toHaveAttribute('data-day', start);
    await page.getByRole('button', { name: 'View Month', exact: true }).click();
    await expect(page.locator('schedule-month')).toBeVisible();
    await page.locator('.e2e-year-view-btn').click();
    await expect(page.locator('schedule-year')).toBeVisible();
  });
}
