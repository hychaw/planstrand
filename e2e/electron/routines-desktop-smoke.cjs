// Full application journeys against the current Windows build and a disposable profile.
// All domain writes go through visible UI. Backup exports are read only for assertions.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron, expect } = require('@playwright/test');
const executablePath = path.resolve(
  process.argv[2] || '.tmp/app-builds/win-unpacked/Planstrand.exe',
);
const root = path.resolve('.tmp/routines-desktop-smoke');
fs.mkdirSync(root, { recursive: true });
const runDir = fs.mkdtempSync(path.join(root, 'run-'));
const profile = path.join(runDir, 'profile');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const errors = [];
const completed = [];
let app, page;
const step = async (name, work) => {
  console.log(`Checking: ${name}`);
  await work();
  completed.push(name);
  console.log(`PASS: ${name}`);
};
const goto = async (route) => {
  await page.evaluate((r) => {
    location.hash = r;
  }, route);
  await page.waitForURL((url) => url.hash === `#${route}`);
};
const launch = async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, '--disable-gpu'],
    env,
    timeout: 60000,
  });
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.waitForLoadState('domcontentloaded');
  page.on('pageerror', (e) => errors.push(e.message));
  const url = page.url();
  await page.goto('about:blank');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Berlin' });
  await page.clock.install({ time: new Date('2026-10-05T12:00:00Z') });
  await page.goto(url);
  await page.locator('planstrand-page').waitFor({ timeout: 60000 });
  await page.evaluate(() => {
    for (const k of [
      'SUP_ONBOARDING_PRESET_DONE',
      'SUP_ONBOARDING_HINTS_DONE',
      'SUP_IS_SHOW_TOUR',
      'SUP_EXAMPLE_TASKS_CREATED',
    ])
      localStorage.setItem(k, 'true');
  });
  await page.reload();
  await page.locator('planstrand-page').waitFor();
  await goto('/about');
  await expect(page.locator('planstrand-product-info')).toContainText(
    `Build ${revision.slice(0, 7)}`,
  );
};
const stop = async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
};
const fillTitle = async (input, title) => {
  await expect(input).toHaveClass(/ng-invalid/);
  await input.focus();
  await input.press('Tab');
  await expect(input).toHaveClass(/ng-touched/);
  await input.fill(title);
  await expect(input).toHaveValue(title);
};
const save = async (dialog) => {
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
};
const eventDialog = () => page.locator('dialog-event');
const blocks = (title) =>
  page.locator('schedule-event:not(.custom-drag-preview)').filter({ hasText: title });
const day = async (date = '2026-10-05') => {
  await goto('/schedule');
  await page.getByRole('button', { name: 'View Month', exact: true }).click();
  await page.locator(`.month-day-cell[data-day="${date}"] .month-day-number`).click();
  await expect(
    page.getByRole('button', { name: 'View Day', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
};
const editOccurrence = async (title, date = '2026-10-05') => {
  await day(date);
  await blocks(title).first().click();
  await expect(eventDialog()).toBeVisible();
  await expect(eventDialog()).not.toContainText(/\u00c2|\u00e2\u20ac/);
  return eventDialog();
};
const confirm = async (name) => {
  const dialog = page.locator('dialog-confirm');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
};
const createEvent = async (title, frequency, allDay, interval = 1) => {
  await day();
  await page.locator('.e2e-new-event').click();
  const dialog = eventDialog();
  await fillTitle(dialog.locator('input[name=title]'), title);
  await dialog.locator('select[name=creationRepeat]').selectOption(frequency);
  await dialog.locator('input[name=allDay]').setChecked(allDay);
  await dialog.locator('input[name=date]').fill('2026-10-05');
  if (frequency !== 'none') {
    await dialog.locator('input[name=interval]').fill(String(interval));
    if (frequency === 'weekly')
      for (const weekday of ['Monday', 'Wednesday', 'Friday'])
        await dialog.getByRole('checkbox', { name: weekday, exact: true }).check();
    if (title !== 'Daily all-day')
      await dialog.locator('input[name=recurrenceEndDate]').fill('2026-12-31');
  }
  if (!allDay) {
    await dialog.locator('input[name=start]').fill('09:00');
    await dialog.locator('input[name=timeZone]').fill('Europe/Berlin');
    if (frequency === 'none') await dialog.locator('input[name=end]').fill('10:00');
    else await dialog.locator('input[name=duration]').fill('45');
  }
  await save(dialog);
  await expect(blocks(title)).toHaveCount(1);
};
const exportState = async (label) => {
  const downloads = path.join(runDir, label);
  fs.mkdirSync(downloads);
  await app.evaluate(({ app }, dir) => app.setPath('downloads', dir), downloads);
  await goto('/config');
  await page
    .locator('mat-tab-header .mat-mdc-tab:has(mat-icon:has-text("cloud_sync"))')
    .click();
  const section = page.locator('collapsible').filter({ hasText: 'Import/Export' });
  const button = page.locator('file-imex button:has(mat-icon:has-text("file_upload"))');
  if (!(await button.isVisible()))
    await section.locator('.collapsible-header, .header').click();
  await button.click();
  await expect
    .poll(() => fs.readdirSync(downloads).find((f) => /^sp-backup_.*\.json$/.test(f)), {
      timeout: 30000,
    })
    .toBeTruthy();
  const file = path.join(
    downloads,
    fs.readdirSync(downloads).find((f) => /^sp-backup_.*\.json$/.test(f)),
  );
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  return exported.data.appDataComplete;
};
const manager = () => page.locator('dialog-weekly-templates');
const openTemplates = async () => {
  await goto('/schedule');
  await page.locator('.e2e-weekly-templates').click();
  await expect(manager()).toBeVisible();
};
const closeTemplates = async () => {
  await manager().getByRole('button', { name: 'Close', exact: true }).click();
  await expect(manager()).toBeHidden();
};
const selectTemplate = async (title) => {
  await manager()
    .getByRole('button', { name: new RegExp(title) })
    .click();
};
const createTemplate = async (title) => {
  await openTemplates();
  await manager().getByRole('button', { name: 'Create template', exact: true }).click();
  await expect(manager().locator('input[name=title]')).toBeFocused();
  await manager().locator('input[name=title]').fill(title);
  await manager().locator('input[name=startDate]').fill('2026-10-05');
  await manager().locator('input[name=endDate]').fill('2026-10-19');
  await saveTemplate();
};
const saveTemplate = async () => {
  await manager().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(manager().locator('form')).toBeHidden();
  await expect(manager()).not.toContainText(/\u00c2|\u00e2\u20ac/);
};
const addEntry = async (title, timed = false) => {
  await manager().getByRole('button', { name: 'Add entry', exact: true }).click();
  const dialog = eventDialog();
  await fillTitle(dialog.locator('input[name=title]'), title);
  await dialog.locator('input[name=allDay]').setChecked(!timed);
  await dialog.getByRole('checkbox', { name: 'Wednesday', exact: true }).check();
  if (timed) {
    await dialog.locator('input[name=timeZone]').fill('America/New_York');
    await dialog.locator('input[name=duration]').fill('90');
  }
  await save(dialog);
  await expect(
    manager().getByRole('button', { name: 'Add entry', exact: true }),
  ).toBeFocused();
};
const slice = (data, names) =>
  Object.fromEntries(
    names.map((n) => [
      n,
      n === 'folder' ? { ids: data[n].ids, entities: data[n].entities } : data[n],
    ]),
  );
(async () => {
  await launch();
  await step(
    'existing Folder, Task, Today, This Week, WorkSession scheduling/completion and one-off Event',
    async () => {
      await goto('/master-tasks');
      await page
        .locator('planstrand-page header')
        .getByRole('button', { name: 'Create Folder', exact: true })
        .click();
      await fillTitle(page.locator('dialog-prompt input'), 'Desktop Folder');
      await save(page.locator('dialog-prompt'));
      const folder = page.locator('planstrand-page section').filter({
        has: page.getByRole('heading', {
          name: /Desktop Folder/,
        }),
      });
      await folder.getByRole('button', { name: 'Add Task', exact: true }).click();
      await fillTitle(page.locator('dialog-prompt input'), 'Desktop Task');
      await save(page.locator('dialog-prompt'));
      let task = page
        .locator('planstrand-task-list .task-entry')
        .filter({ hasText: 'Desktop Task' });
      await task.locator('.task-actions summary').click();
      await task
        .getByRole('combobox', { name: 'Plan Task' })
        .selectOption({ label: 'Today' });
      await goto('/today');
      await expect(page.locator('planstrand-page')).toContainText('Desktop Task');
      await goto('/this-week');
      await expect(page.locator('planstrand-page')).toContainText('Desktop Task');
      await goto('/today');
      task = page
        .locator('planstrand-task-list .task-entry')
        .filter({ hasText: 'Desktop Task' });
      await task.locator('.task-actions summary').click();
      await task
        .getByRole('button', { name: 'Schedule WorkSession', exact: true })
        .click();
      const schedule = page.locator('dialog-schedule-task');
      await schedule.getByRole('button', { name: 'Today', exact: true }).click();
      await schedule.locator('input[type=time]').fill('11:00');
      await schedule.locator('[data-test-id=schedule-submit-btn]').click();
      await expect(schedule).toBeHidden();
      await day();
      await blocks('Desktop Task').first().click();
      await page.getByRole('menuitem', { name: 'Mark WorkSession as completed' }).click();
      await blocks('Desktop Task').first().click();
      await expect(
        page.getByRole('menuitem', { name: 'Mark as incomplete' }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await createEvent('Desktop one-off', 'none', false);
    },
  );
  const baseline = await exportState('baseline');
  await step(
    'six recurring schedule combinations; weekdays, intervals and optional end bounds',
    async () => {
      for (const frequency of ['daily', 'weekly', 'monthly'])
        for (const allDay of [true, false])
          await createEvent(
            `${frequency[0].toUpperCase() + frequency.slice(1)} ${allDay ? 'all-day' : 'timed'}`,
            frequency,
            allDay,
            frequency === 'weekly' ? 2 : 1,
          );
    },
  );
  await step(
    'occurrence override, move, cancel, toolbar restore and keyboard focus',
    async () => {
      let dialog = await editOccurrence('Daily all-day');
      await dialog.locator('input[name=title]').fill('Moved occurrence');
      await dialog.locator('input[name=date]').fill('2026-10-06');
      await save(dialog);
      await expect(blocks('Daily all-day')).toHaveCount(0);
      await day('2026-10-06');
      await expect(blocks('Moved occurrence')).toHaveCount(1);
      dialog = await editOccurrence('Daily timed');
      await dialog
        .getByRole('button', { name: 'Cancel this occurrence', exact: true })
        .click();
      await confirm('Cancel this occurrence');
      await expect(dialog).toBeHidden();
      await expect(blocks('Daily timed')).toHaveCount(0);
      await page.locator('.e2e-cancelled-occurrences').click();
      const cancelled = page.locator('dialog-cancelled-occurrences');
      await expect(cancelled).toContainText('Daily timed');
      await cancelled
        .getByRole('button', { name: /^Restore original schedule: Daily timed/ })
        .click();
      await expect(cancelled).toBeHidden();
      await expect(page.locator('.e2e-cancelled-occurrences')).toBeFocused();
      await expect(blocks('Daily timed')).toHaveCount(1);
    },
  );
  await step(
    'This and future, Entire series and retain/decline exception consent',
    async () => {
      let dialog = await editOccurrence('Daily timed', '2026-10-07');
      await dialog.locator('select[name=scope]').selectOption('future');
      await dialog.locator('input[name=title]').fill('Future timed');
      await dialog.locator('input[name=duration]').fill('60');
      await save(dialog);
      await day();
      await expect(blocks('Daily timed')).toHaveCount(1);
      await day('2026-10-07');
      await expect(blocks('Future timed')).toHaveCount(1);
      dialog = await editOccurrence('Daily timed');
      await dialog.locator('select[name=scope]').selectOption('series');
      await dialog.locator('input[name=title]').fill('Entire timed');
      await save(dialog);
      dialog = await editOccurrence('Daily all-day', '2026-10-08');
      await dialog
        .getByRole('button', { name: 'Cancel this occurrence', exact: true })
        .click();
      await confirm('Cancel this occurrence');
      await expect(dialog).toBeHidden();
      dialog = await editOccurrence('Daily all-day', '2026-10-07');
      await dialog.locator('select[name=scope]').selectOption('series');
      await dialog.locator('input[name=interval]').fill('2');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await confirm('Cancel');
      await expect(dialog.locator('input[name=interval]')).toHaveValue('2');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await confirm('Retain existing exceptions');
      await expect(dialog).toBeHidden();
    },
  );
  await step('series deletion confirmation and persistent cancellation', async () => {
    let dialog = await editOccurrence('Monthly timed');
    await dialog
      .getByRole('button', { name: 'Delete entire series', exact: true })
      .click();
    await confirm('Cancel');
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Delete entire series', exact: true })
      .click();
    await confirm('Delete entire series');
    await expect(dialog).toBeHidden();
    await expect(blocks('Monthly timed')).toHaveCount(0);
    dialog = await editOccurrence('Entire timed', '2026-10-08');
    await dialog
      .getByRole('button', { name: 'Cancel this occurrence', exact: true })
      .click();
    await confirm('Cancel this occurrence');
    await expect(dialog).toBeHidden();
  });
  await step(
    'template create/rename/date validation, multiple entries, inactive editing and entry deletion',
    async () => {
      await createTemplate('Desktop template');
      await addEntry('Template Alpha');
      await addEntry('Template Beta', true);
      await addEntry('Remove entry');
      await manager()
        .getByRole('button', { name: 'Edit Event: Remove entry', exact: true })
        .click();
      await eventDialog()
        .getByRole('button', { name: 'Delete entire series', exact: true })
        .click();
      await confirm('Delete entire series');
      await expect(eventDialog()).toBeHidden();
      await expect(
        manager().getByRole('button', { name: 'Add entry', exact: true }),
      ).toBeFocused();
      await manager()
        .getByRole('button', { name: 'Edit Event: Template Alpha', exact: true })
        .click();
      await eventDialog().locator('input[name=interval]').fill('0');
      await eventDialog().getByRole('button', { name: 'Save', exact: true }).click();
      await expect(eventDialog().getByRole('alert')).toBeVisible();
      await expect(eventDialog().locator('input[name=interval]')).toHaveValue('0');
      await eventDialog().locator('input[name=interval]').fill('1');
      await eventDialog().locator('input[name=title]').fill('Template Alpha edited');
      await save(eventDialog());
      await manager()
        .getByRole('button', { name: 'Edit name and dates', exact: true })
        .click();
      await manager().locator('input[name=endDate]').fill('2026-10-01');
      await manager().getByRole('button', { name: 'Save', exact: true }).click();
      await expect(manager().getByRole('alert')).toBeVisible();
      await manager().locator('input[name=title]').fill('Desktop renamed');
      await manager().locator('input[name=endDate]').fill('2026-10-19');
      await saveTemplate();
      await page.screenshot({
        path: path.join(runDir, 'templates-desktop.png'),
        animations: 'disabled',
      });
      await closeTemplates();
      await day();
      await expect(blocks('Template Alpha edited')).toHaveCount(0);
    },
  );
  await step(
    'activation, bounds, reactivation and overlapping active templates',
    async () => {
      await openTemplates();
      await selectTemplate('Desktop renamed');
      await manager().getByRole('button', { name: 'Activate', exact: true }).click();
      await closeTemplates();
      await day();
      await expect(blocks('Template Alpha edited')).toHaveCount(1);
      const originalId = await blocks('Template Alpha edited').getAttribute('id');
      await openTemplates();
      await selectTemplate('Desktop renamed');
      await manager().getByRole('button', { name: 'Deactivate', exact: true }).click();
      await closeTemplates();
      await expect(blocks('Template Alpha edited')).toHaveCount(0);
      await openTemplates();
      await selectTemplate('Desktop renamed');
      await manager().getByRole('button', { name: 'Activate', exact: true }).click();
      await closeTemplates();
      await expect(blocks('Template Alpha edited')).toHaveAttribute('id', originalId);
      await openTemplates();
      await selectTemplate('Desktop renamed');
      await manager()
        .getByRole('button', { name: 'Edit name and dates', exact: true })
        .click();
      await manager().locator('input[name=startDate]').fill('2026-10-07');
      await saveTemplate();
      await closeTemplates();
      await expect(blocks('Template Alpha edited')).toHaveCount(0);
      await day('2026-10-07');
      await expect(blocks('Template Alpha edited')).toHaveCount(1);
      await createTemplate('Overlap template');
      await addEntry('Overlap Alpha');
      await manager().getByRole('button', { name: 'Activate', exact: true }).click();
      await closeTemplates();
      await day('2026-10-07');
      await expect(blocks('Overlap Alpha')).toHaveCount(1);
      await expect(blocks('Template Alpha edited')).toHaveCount(1);
    },
  );
  await step(
    'template permanent deletion confirmation; other template and standalone Events independent',
    async () => {
      await openTemplates();
      await selectTemplate('Overlap template');
      await manager().getByRole('button', { name: 'Delete', exact: true }).click();
      await confirm('Cancel');
      await manager().getByRole('button', { name: 'Delete', exact: true }).click();
      await confirm('Delete');
      await expect(
        manager().getByRole('button', { name: 'Create template', exact: true }),
      ).toBeFocused();
      await closeTemplates();
      await day('2026-10-07');
      await expect(blocks('Overlap Alpha')).toHaveCount(0);
      await expect(blocks('Template Alpha edited')).toHaveCount(1);
      await expect(blocks('Entire timed')).toHaveCount(1);
    },
  );
  await step(
    'Day, Week, Month, Year; narrow dialogs, scroll and Escape focus',
    async () => {
      for (const view of ['Day', 'Week', 'Month']) {
        await page.getByRole('button', { name: `View ${view}`, exact: true }).click();
        await expect(blocks('Template Alpha edited').first()).toBeAttached();
      }
      await page.getByRole('button', { name: 'Year', exact: true }).click();
      await expect(
        page.locator('schedule-year .activity.has-items').first(),
      ).toBeVisible();
      await day('2026-10-07');
      await page.screenshot({
        path: path.join(runDir, 'calendar-desktop.png'),
        animations: 'disabled',
      });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.isDestroyed())
          .setSize(390, 844),
      );
      await openTemplates();
      await selectTemplate('Desktop renamed');
      await expect(
        manager().getByRole('button', { name: 'Add entry', exact: true }),
      ).toBeInViewport();
      expect(await manager().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: path.join(runDir, 'templates-mobile.png'),
        animations: 'disabled',
      });
      await manager()
        .getByRole('button', { name: 'Edit Event: Template Beta', exact: true })
        .click();
      await expect(eventDialog().locator('input[name=title]')).toBeFocused();
      await eventDialog().locator('input[name=timeZone]').scrollIntoViewIfNeeded();
      await expect(eventDialog().locator('input[name=timeZone]')).toBeInViewport();
      await page.screenshot({
        path: path.join(runDir, 'entry-mobile.png'),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(eventDialog()).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(manager()).toBeHidden();
      await expect(page.locator('.e2e-weekly-templates')).toBeFocused();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.isDestroyed())
          .setSize(1280, 900),
      );
    },
  );
  const before = await exportState('before-restart');
  await step(
    'no generated Tasks, WorkSessions, Planning memberships or permanent Event instances',
    async () => {
      expect(
        slice(before, ['task', 'workSession', 'planning', 'event', 'folder']),
      ).toEqual(slice(baseline, ['task', 'workSession', 'planning', 'event', 'folder']));
      expect(
        Object.values(before.eventSeries.entities).filter((s) => s.templateId).length,
      ).toBe(4);
      expect(
        Object.values(before.occurrenceException.entities).some(
          (e) => e.value.kind === 'cancelled',
        ),
      ).toBe(true);
    },
  );
  await stop();
  await launch();
  const after = await exportState('after-restart');
  await step(
    'process restart preserves all domain data, exception keys, template states and occurrence identities',
    async () => {
      expect(
        slice(after, [
          'task',
          'workSession',
          'planning',
          'event',
          'folder',
          'eventSeries',
          'occurrenceException',
          'weeklyTemplate',
        ]),
      ).toEqual(
        slice(before, [
          'task',
          'workSession',
          'planning',
          'event',
          'folder',
          'eventSeries',
          'occurrenceException',
          'weeklyTemplate',
        ]),
      );
      await day('2026-10-07');
      await expect(blocks('Template Alpha edited')).toHaveCount(1);
      await expect(blocks('Entire timed')).toHaveCount(1);
      await day('2026-10-06');
      await expect(blocks('Moved occurrence')).toHaveCount(1);
      await day('2026-10-08');
      await expect(blocks('Entire timed')).toHaveCount(0);
      await page.locator('.e2e-cancelled-occurrences').click();
      await expect(page.locator('dialog-cancelled-occurrences')).toContainText(
        'Entire timed',
      );
      await page.keyboard.press('Escape');
      await goto('/today');
      await expect(page.locator('planstrand-page')).toContainText('Desktop Task');
      await goto('/master-tasks');
      await expect(page.locator('planstrand-page')).toContainText('Desktop Folder');
      expect(errors).toEqual([]);
    },
  );
  if (process.argv.includes('--review')) {
    await day('2026-10-07');
    await openTemplates();
    await selectTemplate('Desktop renamed');
    console.log(`VISUAL REVIEW READY: ${runDir}`);
    while (!fs.existsSync(path.join(runDir, 'review.done')))
      await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fs.writeFileSync(
    path.join(runDir, 'result.json'),
    JSON.stringify(
      { passed: true, executablePath, revision, profile, completed, errors },
      null,
      2,
    ),
  );
  console.log(`Desktop routines smoke passed: ${runDir}`);
})()
  .catch(async (error) => {
    console.error(error);
    if (page)
      await page.screenshot({ path: path.join(runDir, 'failure.png') }).catch(() => {});
    fs.writeFileSync(
      path.join(runDir, 'result.json'),
      JSON.stringify(
        {
          passed: false,
          executablePath,
          revision,
          profile,
          completed,
          errors,
          error: String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(stop);
