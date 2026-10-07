import { expect, test } from '../../fixtures/test.fixture';

test('Settings and About present the Planstrand product version and retain licenses', async ({
  page,
}) => {
  await page.goto('/#/config');
  const footer = page.locator('.version-footer');
  await expect(footer).toContainText('Planstrand');
  await expect(footer).toContainText('1.1.0-rc.1');
  await expect(footer).not.toContainText('19.1.0');
  expect(await footer.getAttribute('title')).not.toMatch(/NO_REV|NO_BRANCH|19\.1\.0/);
  await page.goto('/#/about');
  await expect(page.locator('planstrand-product-info')).toContainText(
    'Version 1.1.0-rc.1',
  );
  await expect(page.locator('planstrand-product-info')).not.toContainText('19.1.0');
  await expect(page.locator('planstrand-product-info')).not.toContainText(
    /NO_REV|NO_BRANCH/,
  );
  await page
    .getByText('Open-source acknowledgements / Licenses', { exact: true })
    .click();
  const acknowledgements = page.locator('planstrand-product-info details');
  await expect(acknowledgements).toContainText('Super Productivity');
  await expect(acknowledgements).toContainText('MIT License');
  await expect(
    acknowledgements.getByRole('link', { name: 'Dependency licenses' }),
  ).toBeVisible();
});
