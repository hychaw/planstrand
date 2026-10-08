// Seed the published V1 workspace and verify the same isolated profile in V1.1.
// Invoked only by the installer safety script after its ownership preflight.
const fs = require('node:fs');
const path = require('node:path');
const { _electron, expect } = require('@playwright/test');
const [mode, executablePath, profile, evidence] = process.argv.slice(2);
const { version } = require('../../planstrand-product.json');
let app;
async function main() {
  expect(['seed', 'verify']).toContain(mode);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, '--disable-gpu'],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const url = page.url();
  await page.goto('about:blank');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Vancouver' });
  await page.clock.install({ time: new Date('2026-10-04T19:21:00Z') });
  await page.addInitScript(() => {
    for (const key of [
      'SUP_ONBOARDING_PRESET_DONE',
      'SUP_ONBOARDING_HINTS_DONE',
      'SUP_IS_SHOW_TOUR',
      'SUP_EXAMPLE_TASKS_CREATED',
    ])
      localStorage.setItem(key, 'true');
  });
  await page.goto(url);
  await page.locator('planstrand-page').waitFor({ timeout: 60000 });
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
  const navigate = async (route) => {
    await page.evaluate((r) => {
      location.hash = r;
    }, route);
    await page.waitForURL((url) => url.hash === `#${route}`);
  };
  const prompt = async (text) => {
    const dialog = page.locator('dialog-prompt');
    const input = dialog.locator('input');
    await expect(input).toHaveClass(/ng-invalid/);
    await input.focus();
    await input.press('Tab');
    await expect(input).toHaveClass(/ng-touched/);
    await input.fill(text);
    await expect(input).toHaveClass(/ng-valid/);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  await navigate('/master-tasks');
  await expect(
    page.getByRole('heading', {
      name: mode === 'seed' ? 'Master Tasks' : 'Tasks',
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  if (mode === 'seed') {
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe('19.1.0');
    await page
      .locator('planstrand-page header')
      .getByRole('button', { name: 'Create Folder', exact: true })
      .click();
    await prompt('Upgrade Folder');
    const folder = page.locator('planstrand-page section').filter({
      has: page.getByRole('heading', { name: '▾ Upgrade Folder', exact: true }),
    });
    await folder.getByRole('button', { name: 'Add Task', exact: true }).click();
    await prompt('Upgrade Task');
    const task = folder.locator('.task-entry').filter({ hasText: 'Upgrade Task' });
    await task
      .getByRole('combobox', { name: 'Plan Task' })
      .selectOption({ label: 'Today' });
    await navigate('/today');
    await page
      .locator('.task-entry')
      .filter({ hasText: 'Upgrade Task' })
      .getByRole('button', { name: 'Schedule WorkSession', exact: true })
      .click();
    const dialog = page.locator('dialog-schedule-task');
    await dialog.getByRole('button', { name: 'Today', exact: true }).click();
    await dialog.locator('input[type=time]').fill('10:00');
    await dialog.locator('[data-test-id=schedule-submit-btn]').click();
    await expect(dialog).toBeHidden();
    await navigate('/schedule');
    await page.getByRole('button', { name: 'New Event', exact: true }).first().click();
    const event = page.locator('dialog-event');
    await event.locator('input[name=title]').fill('Upgrade Event');
    await event.locator('input[name=start]').fill('12:00');
    await event.locator('input[name=end]').fill('13:00');
    await event.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(event).toBeHidden();
  } else {
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version);
  }
  await navigate('/master-tasks');
  await expect(page.locator('planstrand-page')).toContainText('Upgrade Folder');
  const task = page.locator('.task-entry').filter({ hasText: 'Upgrade Task' });
  await expect(task).toHaveCount(1);
  const taskId = await task.locator('task').getAttribute('id');
  expect(taskId).toBeTruthy();
  if (mode === 'verify')
    expect(taskId).toBe(JSON.parse(fs.readFileSync(evidence, 'utf8')).taskId);
  await navigate('/today');
  await expect(page.locator('planstrand-page section').first()).toContainText(
    'Upgrade Task',
  );
  await navigate('/schedule');
  await page.getByRole('button', { name: 'View Day', exact: true }).first().click();
  const blocks = page.locator('schedule-event:not(.custom-drag-preview)');
  // The protected V1 binary emits its inherited automatic Task-flow block as
  // well as the real reservation. V1.1 must suppress only that legacy projection.
  const expectedBlocks = mode === 'seed' ? 2 : 1;
  await expect(blocks.filter({ hasText: 'Upgrade Task' })).toHaveCount(expectedBlocks);
  await expect(blocks.filter({ hasText: 'Upgrade Event' })).toHaveCount(1);
  if (mode === 'verify')
    await expect(
      page
        .locator('schedule-event.blue-thread-session')
        .filter({ hasText: 'Upgrade Task' }),
    ).toHaveCount(1);
  await page.reload();
  await expect(blocks.filter({ hasText: 'Upgrade Task' })).toHaveCount(expectedBlocks);
  await expect(blocks.filter({ hasText: 'Upgrade Event' })).toHaveCount(1);
  await navigate('/config');
  await page
    .locator('mat-tab-header .mat-mdc-tab:has(mat-icon:has-text("cloud_sync"))')
    .click();
  const exportButton = page.locator(
    'file-imex button:has(mat-icon:has-text("file_upload"))',
  );
  if (!(await exportButton.isVisible()))
    await page
      .locator('collapsible')
      .filter({ hasText: 'Import/Export' })
      .locator('.collapsible-header, .header')
      .click();
  const downloadDirectory = path.join(path.dirname(evidence), `${mode}-backup`);
  fs.mkdirSync(downloadDirectory);
  await app.evaluate(
    ({ app }, directory) => app.setPath('downloads', directory),
    downloadDirectory,
  );
  await exportButton.click();
  await expect
    .poll(
      () => fs.readdirSync(downloadDirectory).find((f) => /^sp-backup_.*\.json$/.test(f)),
      {
        timeout: 30000,
      },
    )
    .not.toBeUndefined();
  const backupFile = fs
    .readdirSync(downloadDirectory)
    .find((f) => /^sp-backup_.*\.json$/.test(f));
  const state = JSON.parse(
    fs.readFileSync(path.join(downloadDirectory, backupFile), 'utf8'),
  ).data.appDataComplete;
  const savedTask = Object.values(state.task.entities).find(
    (task) => task.title === 'Upgrade Task',
  );
  expect(savedTask).toBeTruthy();
  const sessions = Object.values(state.workSession.entities).filter(
    (session) => session.taskId === savedTask.id,
  );
  expect(sessions).toHaveLength(1);
  const sessionIds = sessions.map((session) => session.id);
  if (mode === 'verify')
    expect(sessionIds).toEqual(JSON.parse(fs.readFileSync(evidence, 'utf8')).sessionIds);
  const result = {
    mode,
    taskId,
    profile,
    version: await app.evaluate(({ app }) => app.getVersion()),
    passed: true,
    sessionIds,
    renderedTaskBlocks: expectedBlocks,
  };
  fs.writeFileSync(
    mode === 'seed' ? evidence : path.join(path.dirname(evidence), 'upgrade-result.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close();
  });
