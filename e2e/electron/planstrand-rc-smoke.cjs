// Focused packaged RC flow. Uses real UI and isolated profiles; no domain API bypass.
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { version } = require('../../planstrand-product.json');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const executablePath = path.resolve(
  process.argv[2] || '.tmp/app-builds/win-unpacked/Planstrand.exe',
);
const root = path.resolve('.tmp/rc-smoke');
fs.mkdirSync(root, { recursive: true });
const runDir = fs.mkdtempSync(path.join(root, 'run-'));
let app;
const failures = [];
const launch = async (profile) => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, '--disable-gpu'],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const appUrl = page.url();
  // Install the clock before application timers start. Replacing timers in a
  // live RxJS app leaves old native intervals unable to cancel their callbacks.
  await page.goto('about:blank');
  // Vancouver wall time must agree with the current-time row and persisted items.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Vancouver' });
  await page.clock.install({ time: new Date('2026-10-04T19:21:00Z') });
  page.on('pageerror', (e) => failures.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(appUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('planstrand-page').waitFor({ timeout: 60000 });
  expect(await app.evaluate(({ app }) => app.getName())).toBe('Planstrand');
  expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version);
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
  await expect(page).toHaveTitle(/Planstrand/);
  await page.evaluate(() => {
    for (const key of [
      'SUP_ONBOARDING_PRESET_DONE',
      'SUP_ONBOARDING_HINTS_DONE',
      'SUP_IS_SHOW_TOUR',
      'SUP_EXAMPLE_TASKS_CREATED',
    ])
      localStorage.setItem(key, 'true');
  });
  await page.reload();
  await page.locator('planstrand-page').waitFor();
  await goto(page, '/about');
  const about = page.locator('planstrand-product-info');
  await expect(about).toContainText(`Version ${version}`);
  await expect(about).toContainText(`Build ${revision.slice(0, 7)}`);
  await expect(about).not.toContainText(/19\.1\.0W|NO_REV|NO_BRANCH/);
  await goto(page, '/config');
  await expect(page.locator('.version-footer')).toContainText(`Planstrand ${version}`);
  await goto(page, '/today');
  return page;
};
const stop = async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
};
const goto = async (page, route) => {
  await page.evaluate((r) => {
    location.hash = r;
  }, route);
  await page.waitForURL((url) => url.hash === `#${route}`);
  if (route === '/master-tasks' || route === '/today') {
    const name = route === '/master-tasks' ? 'Tasks' : 'Today';
    await expect(
      page.getByRole('heading', { name, exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.locator('planstrand-page')).toHaveCount(1);
  } else {
    await expect(page.locator('planstrand-page')).toHaveCount(0);
  }
};
const fillNewTitle = async (input, text) => {
  // The control can be visible before NgModel finishes initializing. Filling
  // then can be overwritten by its initial empty value on fast Windows hosts.
  await expect(input).toHaveClass(/ng-invalid/);
  await input.focus();
  await input.press('Tab');
  await expect(input).toHaveClass(/ng-touched/);
  await input.fill(text);
  await expect(input).toHaveValue(text);
  await expect(input).toHaveClass(/ng-valid/);
};
const prompt = async (page, text) => {
  const dialog = page.locator('dialog-prompt');
  await fillNewTitle(dialog.locator('input'), text);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
};
const openBackup = async (page) => {
  await goto(page, '/config');
  await page
    .locator('mat-tab-header .mat-mdc-tab:has(mat-icon:has-text("cloud_sync"))')
    .click();
  const section = page.locator('collapsible').filter({ hasText: 'Import/Export' });
  const button = page.locator('file-imex button:has(mat-icon:has-text("file_upload"))');
  if (!(await button.isVisible()))
    await section.locator('.collapsible-header, .header').click();
  await expect(button).toBeVisible();
  return button;
};
const importBackup = async (page, file) => {
  await openBackup(page);
  const completed = page.waitForEvent('console', {
    predicate: (m) => m.text().includes('Load(import) all data'),
    timeout: 60000,
  });
  await page.locator('file-imex input[type=file]').setInputFiles(file);
  await completed;
};
const checkData = async (page) => {
  await goto(page, '/master-tasks');
  await expect(page.locator('planstrand-page')).toContainText('RC Folder');
  await expect(page.locator('planstrand-page')).toContainText('RC Task');
  await goto(page, '/today');
  await expect(page.locator('planstrand-page section').first()).toContainText('RC Task');
  await goto(page, '/schedule');
  await expect(page.getByRole('button', { name: 'View Day', exact: true })).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: 'View Day', exact: true }).click();
  await expect(
    page
      .locator('schedule-event.blue-thread-session:not(.custom-drag-preview)')
      .filter({ hasText: 'RC Task' }),
  ).toHaveCount(1);
  await expect(
    page
      .locator('schedule-event:not(.custom-drag-preview)')
      .filter({ hasText: 'RC Event' }),
  ).toHaveCount(1);
  for (const view of ['Month', 'Week', 'Day']) {
    const toggle = page.getByRole('button', { name: `View ${view}`, exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    if (view !== 'Month') {
      await expect(page.locator('schedule-week .week-header .day')).toHaveCount(
        view === 'Day' ? 1 : 7,
      );
    }
    const early = page
      .locator('schedule-event:not(.custom-drag-preview)')
      .filter({ hasText: 'RC Early Event' });
    await expect(early).toHaveCount(1);
    if (view === 'Month') {
      await expect(
        page.locator('.month-day-cell[data-day="2026-10-04"]').filter({ has: early }),
      ).toHaveCount(1);
    } else {
      await expect
        .poll(() => early.evaluate((el) => getComputedStyle(el).gridRowStart))
        .toBe('25');
      await expect(async () => {
        await early.scrollIntoViewIfNeeded();
        await expect(early).toBeInViewport();
      }).toPass({ timeout: 5000 });
      await expect
        .poll(() =>
          page
            .locator('#current-time')
            .evaluate((el) => getComputedStyle(el).gridRowStart),
        )
        .toBe('149');
    }
  }
};
(async () => {
  const profile = path.join(runDir, 'profile');
  let page = await launch(profile);
  await expect(page).toHaveURL(/#\/today$/);
  await goto(page, '/master-tasks');
  await page
    .locator('planstrand-page header')
    .getByRole('button', { name: 'Create Folder', exact: true })
    .click();
  await prompt(page, 'RC Folder');
  const folder = page
    .locator('planstrand-page section')
    .filter({ has: page.getByRole('heading', { name: '▾ RC Folder', exact: true }) });
  await folder.getByRole('button', { name: 'Add Task', exact: true }).click();
  await prompt(page, 'RC Task');
  const task = page
    .locator('planstrand-task-list .task-entry')
    .filter({ hasText: 'RC Task' });
  await task.locator('.task-actions summary').click();
  await task
    .getByRole('combobox', { name: 'Plan Task' })
    .selectOption({ label: 'Today' });
  await goto(page, '/today');
  const focusTask = page
    .locator('planstrand-task-list .task-entry')
    .filter({ hasText: 'RC Task' });
  await focusTask.locator('.task-actions summary').click();
  await focusTask
    .getByRole('button', { name: 'Schedule WorkSession', exact: true })
    .click();
  const schedule = page.locator('dialog-schedule-task');
  await schedule.getByRole('button', { name: 'Today', exact: true }).click();
  await schedule.locator('input[type=time]').fill('10:00');
  await schedule.locator('[data-test-id=schedule-submit-btn]').click();
  await expect(schedule).toBeHidden();
  await goto(page, '/schedule');
  await expect(page.getByRole('button', { name: 'View Day', exact: true })).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: 'View Day', exact: true }).click();
  await page.getByRole('button', { name: 'New Event', exact: true }).first().click();
  const event = page.locator('dialog-event');
  await fillNewTitle(event.locator('input[name=title]'), 'RC Event');
  await event.locator('input[name=start]').fill('12:00');
  await event.locator('input[name=end]').fill('13:00');
  await event.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(event).toBeHidden();
  await page.getByRole('button', { name: 'New Event', exact: true }).first().click();
  await fillNewTitle(event.locator('input[name=title]'), 'RC Early Event');
  await event.locator('input[name=start]').fill('09:00');
  await event.locator('input[name=end]').fill('10:00');
  await event.locator('input[name=timeZone]').fill('UTC');
  await event.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(event).toBeHidden();
  await checkData(page);
  await page.screenshot({ path: path.join(runDir, 'schedule.png') });
  const exportButton = await openBackup(page);
  // Electron downloads are main-process managed, not Playwright page downloads.
  await app.evaluate(({ app }, dir) => app.setPath('downloads', dir), runDir);
  await exportButton.click();
  await expect
    .poll(() => fs.readdirSync(runDir).find((f) => /^sp-backup_.*\.json$/.test(f)), {
      timeout: 30000,
    })
    .not.toBeUndefined();
  const exportFile = fs.readdirSync(runDir).find((f) => /^sp-backup_.*\.json$/.test(f));
  const backup = path.join(runDir, 'backup.json');
  fs.copyFileSync(path.join(runDir, exportFile), backup);
  const exported = JSON.parse(fs.readFileSync(backup, 'utf8'));
  const earlyRecord = Object.values(exported.data.appDataComplete.event.entities).find(
    (e) => e.title === 'RC Early Event',
  );
  expect(earlyRecord.start).toBe(Date.parse('2026-10-04T09:00:00Z'));
  expect(earlyRecord.end).toBe(Date.parse('2026-10-04T10:00:00Z'));
  expect(earlyRecord.timeZone).toBe('UTC');
  await stop();
  page = await launch(profile);
  await checkData(page);
  await stop();
  page = await launch(path.join(runDir, 'restored'));
  await importBackup(page, backup);
  await checkData(page);
  await stop();
  page = await launch(path.join(runDir, 'legacy'));
  await importBackup(
    page,
    path.resolve('src/app/op-log/backup/test-fixtures/legacy-v10-backup.json'),
  );
  await goto(page, '/master-tasks');
  await expect(page.locator('planstrand-page')).toContainText('My Project');
  await expect(page.locator('planstrand-task-list .task-entry')).not.toHaveCount(0);
  await page.screenshot({ path: path.join(runDir, 'legacy.png') });
  await stop();
  expect(failures).toEqual([]);
  fs.writeFileSync(
    path.join(runDir, 'result.json'),
    JSON.stringify(
      {
        executablePath,
        profile,
        passed: true,
        flows: [
          'Folder',
          'Task',
          'Today',
          'WorkSession',
          'Event',
          'process restart',
          'backup restore',
          'legacy v10 migration',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`Planstrand packaged RC smoke passed: ${runDir}`);
})()
  .catch(async (e) => {
    console.error(e);
    if (app) {
      const page = await app.firstWindow().catch(() => null);
      if (page)
        await page.screenshot({ path: path.join(runDir, 'failure.png') }).catch(() => {});
    }
    fs.writeFileSync(
      path.join(runDir, 'result.json'),
      JSON.stringify({ executablePath, passed: false, error: String(e) }, null, 2),
    );
    process.exitCode = 1;
  })
  .finally(stop);
