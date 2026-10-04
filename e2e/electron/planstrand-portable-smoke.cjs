const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { chromium, expect } = require('@playwright/test');
const executable = path.resolve(
  process.argv[2] || '.tmp/app-builds/Planstrand-Portable.exe',
);
const root = path.resolve('.tmp/rc-smoke');
fs.mkdirSync(root, { recursive: true });
const dir = fs.mkdtempSync(path.join(root, 'portable-'));
const profile = path.join(dir, 'profile');
let child, browser, page;
const launch = async () => {
  const port = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(
    executable,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--disable-gpu'],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const log = fs.createWriteStream(path.join(dir, 'launch.log'), { flags: 'a' });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const endpoint = `http://127.0.0.1:${port}`;
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(endpoint + '/json/version')).ok;
        } catch {
          return false;
        }
      },
      { timeout: 60000 },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(endpoint);
  page = browser
    .contexts()[0]
    .pages()
    .find((p) => !p.url().startsWith('devtools:'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  await page.reload();
  await page.locator('planstrand-page').waitFor({ timeout: 60000 });
  await expect(page).toHaveTitle(/Planstrand/);
  expect(await page.evaluate(() => window.ea.getUserDataPath())).toBe(profile);
};
const stop = async () => {
  if (page) await page.evaluate(() => window.ea.shutdownNow()).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null)
    await new Promise((resolve) => {
      child.once('exit', resolve);
      setTimeout(resolve, 10000);
    });
  page = undefined;
  browser = undefined;
};
(async () => {
  await launch();
  await page.evaluate(() => {
    location.hash = '/master-tasks';
  });
  await page
    .locator('planstrand-page header')
    .getByRole('button', { name: 'Create Folder', exact: true })
    .click();
  let prompt = page.locator('dialog-prompt');
  await prompt.locator('input').fill('Portable Folder');
  await prompt.getByRole('button', { name: 'Save', exact: true }).click();
  const folder = page.locator('planstrand-page section').filter({
    has: page.getByRole('heading', { name: '▾ Portable Folder', exact: true }),
  });
  await folder.getByRole('button', { name: 'Add Task', exact: true }).click();
  prompt = page.locator('dialog-prompt');
  await prompt.locator('input').fill('Portable Task');
  await prompt.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(folder).toContainText('Portable Task');
  // Export is unnecessary here; close only after the real persistence completion.
  await page.reload();
  await expect(page.locator('planstrand-page')).toContainText('Portable Task');
  await stop();
  await launch();
  await page.evaluate(() => {
    location.hash = '/master-tasks';
  });
  await expect(page.locator('planstrand-page')).toContainText('Portable Folder');
  await expect(page.locator('planstrand-page')).toContainText('Portable Task');
  await page.screenshot({ path: path.join(dir, 'restart.png') });
  await stop();
  // Dispatching from master uses master's workflow definition, but checks out
  // the reviewed ref's scripts. Keep the installer regression in that existing
  // CI entry point so the corrected SHA is tested before artifact upload.
  if (process.platform === 'win32' && process.env.GITHUB_ACTIONS === 'true') {
    execFileSync(
      'pwsh.exe',
      [
        '-NoProfile',
        '-File',
        path.join(__dirname, 'planstrand-installer-safety.ps1'),
        '-Installer',
        path.join(path.dirname(executable), 'Planstrand-Setup.exe'),
      ],
      { stdio: 'inherit', windowsHide: true, timeout: 300000 },
    );
  }
  fs.writeFileSync(
    path.join(dir, 'result.json'),
    JSON.stringify(
      {
        executable,
        profile,
        passed: true,
        flows: ['portable launch', 'Folder', 'Task', 'process restart', 'persistence'],
      },
      null,
      2,
    ),
  );
  console.log(`Portable smoke passed: ${dir}`);
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
    fs.writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify({ passed: false, error: String(e) }, null, 2),
    );
  })
  .finally(stop);
