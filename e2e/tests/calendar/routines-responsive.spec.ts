import { expect, test } from '../../fixtures/test.fixture';
import { Locator } from '@playwright/test';

const widths = [1440, 1024, 768, 390, 320];

const destructiveContrast = async (host: Locator): Promise<number> =>
  host.evaluate((el) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const luminance = (color: string): number => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const channels = Array.from(ctx.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((value): number => {
          const channel = value / 255;
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        });
      const red = channels[0] * 0.2126;
      const green = channels[1] * 0.7152;
      const blue = channels[2] * 0.0722;
      return red + green + blue;
    };
    const fg = luminance(
      getComputedStyle(el.querySelector('button[color="warn"]')!).color,
    );
    const bg = luminance(
      getComputedStyle(el.closest('.mat-mdc-dialog-surface')!).backgroundColor,
    );
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });

test('Long template and entry names remain readable and actionable at all review widths', async ({
  page,
}, testInfo) => {
  await page.goto('/#/schedule');
  const trigger = page.locator('.e2e-weekly-templates');
  await trigger.click();
  const manager = page.locator('dialog-weekly-templates');
  await manager.getByRole('button', { name: 'Create template', exact: true }).click();
  await manager.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(manager.locator('fieldset')).toHaveAccessibleDescription(/Enter a name/);
  const name = 'LongTemplateNameWithoutSpaces'.repeat(5);
  await manager.locator('input[name=title]').fill(name);
  await manager.getByRole('button', { name: 'Save', exact: true }).click();
  const entryName = 'LongEntryNameWithoutSpaces'.repeat(5);
  for (let i = 0; i < 9; i++) {
    await manager.getByRole('button', { name: 'Add entry', exact: true }).click();
    const editor = page.locator('dialog-event');
    await editor.locator('input[name=title]').fill(i === 0 ? entryName : `Entry ${i}`);
    await editor.locator('input[name=timeZone]').fill('Europe/Berlin');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toBeHidden();
  }
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 400 ? 650 : 900 });
    const content = manager.locator('mat-dialog-content');
    // The host hides the content's overflow; inspect the actual scroll container.
    expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
      true,
    );
    await expect(manager).not.toContainText(/\u00c2|\u00e2\u20ac/);
    const edit = manager.getByRole('button', {
      name: `Edit Event: ${entryName}`,
      exact: true,
    });
    await edit.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`templates-${width}.png`),
      animations: 'disabled',
    });
    await edit.click();
    const editor = page.locator('dialog-event');
    await expect(editor.locator('input[name=title]')).toBeFocused();
    await editor.locator('input[name=timeZone]').scrollIntoViewIfNeeded();
    await expect(editor.locator('input[name=timeZone]')).toBeInViewport();
    expect(
      await editor
        .locator('mat-dialog-content')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`entry-${width}.png`),
      animations: 'disabled',
    });
    // Both directions must stay in the topmost dialog, including nested dialogs.
    await editor.getByRole('button', { name: 'Save', exact: true }).focus();
    await page.keyboard.press('Tab');
    expect(await editor.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await editor.locator('input[name=title]').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await editor.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(edit).toBeFocused();
  }
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(trigger).toBeFocused();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('.e2e-cancelled-occurrences').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.e2e-cancelled-occurrences')).toBeFocused();
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const theme of ['Light', 'Dark']) {
    await page.goto('/#/config');
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page
      .locator('theme-selector')
      .getByRole('radio', { name: theme, exact: true })
      .click();
    await page.goto('/#/schedule');
    await trigger.click();
    await manager.getByRole('button', { name: new RegExp(name) }).click();
    expect(await destructiveContrast(manager)).toBeGreaterThanOrEqual(4.5);
    await manager
      .getByRole('button', { name: 'Edit name and dates', exact: true })
      .click();
    expect(
      await manager
        .locator('input[name=startDate]')
        .evaluate(
          (el) => getComputedStyle(el, '::-webkit-calendar-picker-indicator').filter,
        ),
    ).toBe('none');
    await manager.getByRole('button', { name: 'Cancel', exact: true }).click();
    await manager
      .getByRole('button', { name: `Edit Event: ${entryName}`, exact: true })
      .click();
    const editor = page.locator('dialog-event');
    await expect(editor.locator('input[name=timeZone]')).toBeVisible();
    expect(await destructiveContrast(editor)).toBeGreaterThanOrEqual(4.5);
    expect(
      await editor
        .locator('input[name=date]')
        .evaluate(
          (el) => getComputedStyle(el, '::-webkit-calendar-picker-indicator').filter,
        ),
    ).toBe('none');
    await page.screenshot({
      path: testInfo.outputPath(`editor-${theme}.png`),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await manager.getByRole('button', { name: 'Close', exact: true }).click();
  }
});

test('Recurring editors, scopes, validation and confirmations at review widths', async ({
  page,
}, testInfo) => {
  await page.goto('about:blank');
  await page.clock.install({ time: new Date('2026-10-05T12:00:00Z') });
  await page.goto('/#/schedule');
  await page.getByRole('button', { name: 'View Month', exact: true }).click();
  await page.locator('.month-day-cell[data-day="2026-10-05"] .month-day-number').click();
  const editor = page.locator('dialog-event');
  const blocks = (title: string): Locator =>
    page.locator('schedule-event:not(.custom-drag-preview)').filter({ hasText: title });
  for (const frequency of ['daily', 'weekly', 'monthly']) {
    await page.locator('.e2e-new-event').click();
    await editor.locator('input[name=title]').fill(`${frequency} review`);
    await editor.locator('select[name=creationRepeat]').selectOption(frequency);
    await editor.locator('input[name=date]').fill('2026-10-05');
    await editor.locator('input[name=allDay]').uncheck();
    await editor.locator('input[name=start]').fill('09:00');
    await editor.locator('input[name=timeZone]').fill('Europe/Berlin');
    await editor.locator('input[name=duration]').fill('45');
    await editor.locator('input[name=interval]').fill('2');
    await editor.locator('input[name=recurrenceEndDate]').fill('2026-12-31');
    if (frequency === 'weekly') {
      for (const day of ['Monday', 'Wednesday', 'Friday'])
        await editor.getByRole('checkbox', { name: day, exact: true }).check();
    }
    if (frequency === 'weekly') {
      await editor.locator('input[name=interval]').fill('0');
      await editor.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(
        editor.locator('mat-dialog-content > fieldset'),
      ).toHaveAccessibleDescription(/positive whole-number interval/);
      for (const width of widths) {
        await page.setViewportSize({ width, height: width < 400 ? 650 : 900 });
        const content = editor.locator('mat-dialog-content');
        expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
          true,
        );
        await editor.getByRole('alert').scrollIntoViewIfNeeded();
        await expect(editor.getByRole('alert')).toBeInViewport();
        await expect(
          editor.getByRole('button', { name: 'Save', exact: true }),
        ).toBeInViewport();
        await page.screenshot({
          path: testInfo.outputPath(`recurrence-${width}.png`),
          animations: 'disabled',
        });
      }
      await editor.locator('input[name=interval]').fill('2');
    }
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(blocks(`${frequency} review`)).toHaveCount(1);
  }
  await blocks('daily review').click();
  await expect(editor.locator('select[name=scope]')).toHaveValue('occurrence');
  await editor.locator('input[name=title]').fill('Occurrence review');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await blocks('Occurrence review').click();
  await editor
    .getByRole('button', { name: 'Restore original schedule', exact: true })
    .click();
  await expect(blocks('daily review')).toHaveCount(1);
  await blocks('daily review').click();
  await editor
    .getByRole('button', { name: 'Cancel this occurrence', exact: true })
    .click();
  await page
    .locator('dialog-confirm')
    .getByRole('button', { name: 'Cancel this occurrence', exact: true })
    .click();
  await page.locator('.e2e-cancelled-occurrences').click();
  const cancelled = page.locator('dialog-cancelled-occurrences');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 650 });
    expect(
      await cancelled
        .locator('mat-dialog-content')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`cancelled-${width}.png`),
      animations: 'disabled',
    });
  }
  await cancelled
    .getByRole('button', { name: /^Restore original schedule: daily review/ })
    .click();
  await expect(blocks('daily review')).toHaveCount(1);
  for (const scope of ['future', 'series']) {
    await blocks('daily review').click();
    await editor.locator('select[name=scope]').selectOption(scope);
    await editor.locator('input[name=duration]').fill(scope === 'future' ? '60' : '75');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toBeHidden();
  }
  await page.getByRole('button', { name: 'Next Day', exact: true }).click();
  await page.getByRole('button', { name: 'Next Day', exact: true }).click();
  await blocks('daily review').click();
  await editor.locator('input[name=title]').fill('Retained occurrence');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Previous Day', exact: true }).click();
  await page.getByRole('button', { name: 'Previous Day', exact: true }).click();
  await blocks('daily review').click();
  await editor.locator('select[name=scope]').selectOption('series');
  await editor.locator('input[name=interval]').fill('3');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog-confirm')).toContainText('logical occurrence slots');
  await page
    .locator('dialog-confirm')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(editor.locator('input[name=interval]')).toHaveValue('3');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .locator('dialog-confirm')
    .getByRole('button', { name: 'Retain existing exceptions', exact: true })
    .click();
  await expect(editor).toBeHidden();
  await blocks('monthly review').click();
  await editor.getByRole('button', { name: 'Delete entire series', exact: true }).click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 650 });
    await expect(
      page
        .locator('dialog-confirm')
        .getByRole('button', { name: 'Delete entire series', exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`confirm-${width}.png`),
      animations: 'disabled',
    });
  }
  await page
    .locator('dialog-confirm')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Delete entire series', exact: true }),
  ).toBeFocused();
  await editor.getByRole('button', { name: 'Delete entire series', exact: true }).click();
  await page
    .locator('dialog-confirm')
    .getByRole('button', { name: 'Delete entire series', exact: true })
    .click();
  await expect(blocks('monthly review')).toHaveCount(0);
});
