import { expect, test } from '../../fixtures/test.fixture';
import { Locator, Page } from '@playwright/test';
import { openPlanstrandActions } from '../../utils/planstrand-actions';

const savePrompt = async (page: Page, title: string): Promise<void> => {
  const dialog = page.locator('dialog-prompt');
  await dialog.locator('input').fill(title);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
};
const sectionFor = (page: Page, title: string): Locator =>
  page
    .locator('planstrand-page section')
    .filter({ has: page.getByRole('heading', { name: `▾ ${title}`, exact: true }) });
const createFolder = async (page: Page, title: string): Promise<Locator> => {
  await page
    .locator('planstrand-page header')
    .getByRole('button', { name: 'Create Folder', exact: true })
    .click();
  await savePrompt(page, title);
  const section = sectionFor(page, title);
  await expect(section).toBeVisible();
  return section;
};

test.describe('Planstrand Milestone A', () => {
  test('organizes, searches and plans a Folder Task through canonical destinations', async ({
    page,
  }) => {
    await page.goto('/#/master-tasks');
    const folder = await createFolder(page, 'Milestone Folder');
    await folder.getByRole('button', { name: 'Add Task', exact: true }).click();
    await savePrompt(page, 'Milestone canonical Task');
    const row = page
      .locator('planstrand-task-list .task-entry')
      .filter({ hasText: 'Milestone canonical Task' });
    await openPlanstrandActions(row);
    await row
      .getByRole('combobox', { name: 'Plan Task' })
      .selectOption({ label: 'Today' });
    await page.goto('/#/today');
    const planned = page.locator('planstrand-page section').first();
    await expect(planned).toContainText('Milestone canonical Task');
    await openPlanstrandActions(planned);
    await planned
      .getByRole('button', { name: 'Schedule WorkSession', exact: true })
      .click();
    await expect(page.locator('dialog-schedule-task')).toBeVisible();
    await page
      .locator('dialog-schedule-task')
      .getByRole('button', { name: 'Today', exact: true })
      .click();
    await page.locator('dialog-schedule-task input[type="time"]').fill('10:00');
    await page
      .locator('dialog-schedule-task [data-test-id="schedule-submit-btn"]')
      .click();
    await expect(page.locator('dialog-schedule-task')).toBeHidden();
    await planned.getByRole('combobox', { name: 'Plan Task' }).selectOption('WEEK');
    await expect(planned).not.toContainText('Milestone canonical Task');
    await page.goto('/#/this-week');
    const week = page.locator('planstrand-page section').first();
    await expect(week).toContainText('Milestone canonical Task');
    await openPlanstrandActions(week);
    const nextDay = await week
      .getByRole('combobox', { name: 'Plan Task' })
      .locator('option')
      .nth(4)
      .getAttribute('value');
    await week.getByRole('combobox', { name: 'Plan Task' }).selectOption(nextDay!);
    await expect(week).not.toContainText('Milestone canonical Task');
    const day = page
      .locator('planstrand-page section')
      .filter({ has: page.locator('option[value="' + nextDay + '"]') })
      .filter({ hasText: 'Milestone canonical Task' });
    await expect(day).toContainText('Milestone canonical Task');
    const dayHeading = await day.getByRole('heading').innerText();
    await openPlanstrandActions(day);
    await day.getByRole('combobox', { name: 'Plan Task' }).selectOption('UNPLAN');
    await expect(
      page.locator('planstrand-page section').filter({
        has: page.getByRole('heading', { name: dayHeading, exact: true }),
      }),
    ).not.toContainText('Milestone canonical Task');
    const unplanned = page.locator('planstrand-page section').last();
    await openPlanstrandActions(unplanned);
    await unplanned
      .getByRole('button', { name: 'Schedule WorkSession', exact: true })
      .click();
    await expect(page.locator('dialog-schedule-task input[type="time"]')).toHaveValue(
      '10:00',
    );
    await page
      .locator('dialog-schedule-task')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await page.goto('/#/search');
    await page.locator('search-page').getByRole('textbox').fill('Milestone canonical');
    await expect(page.locator('search-page mat-list-item')).toContainText(
      'Milestone Folder',
    );
    await page.goto('/#/master-tasks');
    await openPlanstrandActions(row);
    await row.getByRole('button', { name: /Move Task to Folder/ }).click();
    await page
      .locator('planstrand-folder-picker select')
      .selectOption({ label: 'Inbox' });
    await page
      .locator('planstrand-folder-picker')
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(sectionFor(page, 'Inbox')).toContainText('Milestone canonical Task');
    await expect(sectionFor(page, 'Milestone Folder')).not.toContainText(
      'Milestone canonical Task',
    );
    await page.screenshot({ path: '.tmp/milestone-a-master-tasks.png', fullPage: true });
  });

  test('reparents, renames and reorders recursive Folders with device-local collapse', async ({
    page,
  }) => {
    await page.goto('/#/master-tasks');
    const parent = await createFolder(page, 'Parent');
    await openPlanstrandActions(parent, 'folder');
    await parent.getByRole('button', { name: 'Create Folder', exact: true }).click();
    await savePrompt(page, 'Child');
    const child = sectionFor(page, 'Child');
    await expect(child).toBeVisible();
    await expect(
      parent.getByRole('button', { name: 'Delete Folder', exact: true }),
    ).toBeDisabled();
    await parent.getByRole('button', { name: '▾ Parent', exact: true }).click();
    await expect(child).toBeHidden();
    await page.reload();
    await expect(child).toBeHidden();
    await page.getByRole('button', { name: '▸ Parent', exact: true }).click();
    await openPlanstrandActions(child, 'folder');
    await child.getByRole('button', { name: 'Move Folder', exact: true }).click();
    await page.locator('planstrand-folder-picker select').selectOption('');
    await page
      .locator('planstrand-folder-picker')
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await openPlanstrandActions(parent, 'folder');
    await expect(
      parent.getByRole('button', { name: 'Delete Folder', exact: true }),
    ).toBeEnabled();
    await child.getByRole('button', { name: 'Rename Folder', exact: true }).click();
    await savePrompt(page, 'Renamed');
    await sectionFor(page, 'Renamed')
      .getByRole('button', { name: 'Move up', exact: true })
      .click();
    await expect(page.locator('planstrand-page section h2').nth(1)).toHaveText(
      '▾ Renamed',
    );
  });

  test('captures through the shared add-task bar into the Folder being browsed', async ({
    page,
  }) => {
    await page.goto('/#/master-tasks');
    await createFolder(page, 'Capture destination');
    await page
      .locator('planstrand-folder-navigation')
      .getByRole('link', { name: 'Capture destination', exact: true })
      .click();
    await page.keyboard.press('Shift+A');
    const bar = page.locator('add-task-bar');
    await expect(bar).toBeVisible();
    await bar.locator('textarea').first().fill('Shared bar Folder capture');
    await bar.locator('textarea').first().press('Enter');
    await expect(page.locator('planstrand-page section')).toContainText(
      'Shared bar Folder capture',
    );
    await page.goto('/#/today');
    await expect(page.locator('planstrand-page section').first()).not.toContainText(
      'Shared bar Folder capture',
    );
  });
});
