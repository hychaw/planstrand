import { expect, test } from '@playwright/test';
import legacyData from '../../fixtures/legacy-full-migration-backup.json';
import { skipOnboardingForE2E } from '../../utils/waits';
import {
  readMigratedState,
  seedLegacyDatabase,
} from '../../utils/legacy-migration-helpers';

test.use({ video: 'off' });

test('restored legacy working hours require explicit Planstrand display opt-in', async ({
  page,
}) => {
  await page.addInitScript(skipOnboardingForE2E);
  await page.route('**/*.js', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await seedLegacyDatabase(page, legacyData.data);
  await page.unroute('**/*.js');
  const backup = page.waitForEvent('download');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await backup;
  await expect(page.locator('magic-side-nav')).toBeVisible();
  await expect
    .poll(async () => {
      const state = await readMigratedState<{
        globalConfig?: { schedule?: { isWorkStartEndEnabled?: boolean } };
        task?: { ids: string[] };
      }>(page);
      return {
        legacyFlag: state.globalConfig?.schedule?.isWorkStartEndEnabled,
        taskLoaded: state.task?.ids.includes('parent-task-1'),
      };
    })
    .toEqual({ legacyFlag: true, taskLoaded: true });
  const markers = page.locator('.work-start, .work-end');
  for (const view of ['Day', 'Week']) {
    await page.goto('/#/schedule');
    await page
      .getByRole('button', { name: new RegExp(`^(View )?${view}$`), exact: true })
      .click();
    await expect(markers).toHaveCount(0);
  }
  await page.goto('/#/config');
  const optIn = page.getByRole('checkbox', {
    name: 'Show working-hour markers on this device',
    exact: true,
  });
  await expect(optIn).not.toBeChecked();
  await optIn.check();
  await page.reload();
  await expect(optIn).toBeChecked();
  for (const view of ['Day', 'Week']) {
    await page.goto('/#/schedule');
    await page
      .getByRole('button', { name: new RegExp(`^(View )?${view}$`), exact: true })
      .click();
    await expect(markers).toHaveCount(2);
  }
  await page.goto('/#/config');
  await optIn.uncheck();
  await page.goto('/#/schedule');
  await expect(markers).toHaveCount(0);
  const after = await readMigratedState<{
    globalConfig: { schedule: { isWorkStartEndEnabled: boolean } };
  }>(page);
  expect(after.globalConfig.schedule.isWorkStartEndEnabled).toBe(true);
});
