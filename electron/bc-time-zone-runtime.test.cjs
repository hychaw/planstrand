// Opt-in native integration: build Electron first, then run with
// PLANSTRAND_TEST_ELECTRON_TIMEZONE=1 node --test electron/bc-time-zone-runtime.test.cjs
const fs = require('node:fs');
const path = require('node:path');

const snapshot = () => {
  const instants = [
    '2025-01-15T08:00:00Z',
    '2025-07-15T07:00:00Z',
    '2025-11-02T08:59:59Z',
    '2025-11-02T09:00:00Z',
    '2026-01-15T08:00:00Z',
    '2026-03-08T09:59:59Z',
    '2026-03-08T10:00:00Z',
    '2026-10-14T06:59:59Z',
    '2026-10-14T07:00:00Z',
    '2026-11-01T08:59:59Z',
    '2026-11-01T09:00:00Z',
    '2026-12-15T07:00:00Z',
    '2027-01-15T07:00:00Z',
    '2030-01-15T07:00:00Z',
  ];
  return {
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dates: instants.map((utc) => {
      const date = new Date(utc);
      const fields = (zone) => {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: zone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        }).formatToParts(date);
        const get = (type) => parts.find((p) => p.type === type).value;
        return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
      };
      return {
        utc,
        offset: date.getTimezoneOffset(),
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`,
        vancouver: fields('America/Vancouver'),
        tokyo: fields('Asia/Tokyo'),
        epoch: date.getTime(),
      };
    }),
  };
};

if (process.versions.electron) {
  require('./initialize-system-time-zone');
  const { app, BrowserWindow } = require('electron');
  const directory = process.env.PLANSTRAND_TIMEZONE_PROBE_DIR;
  app.setPath('userData', path.join(directory, 'profile'));
  app
    .whenReady()
    .then(async () => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true },
      });
      await win.loadURL('data:text/html,<title>Timezone regression</title>');
      const renderer = await win.webContents.executeJavaScript(`(${snapshot})()`);
      const worker = await win.webContents.executeJavaScript(`new Promise(resolve => {
      const url = URL.createObjectURL(new Blob([${JSON.stringify(`postMessage((${snapshot})())`)}], {type:'text/javascript'}));
      const worker = new Worker(url);
      worker.onmessage = event => { resolve(event.data); worker.terminate(); URL.revokeObjectURL(url); };
    })`);
      fs.writeFileSync(
        path.join(directory, 'result.json'),
        JSON.stringify(
          {
            versions: process.versions,
            TZ: process.env.TZ,
            main: snapshot(),
            renderer,
            worker,
          },
          null,
          2,
        ),
      );
      app.quit();
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
} else {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const { spawnSync, execFileSync } = require('node:child_process');
  const enabled =
    process.platform === 'win32' && process.env.PLANSTRAND_TEST_ELECTRON_TIMEZONE === '1';
  const run = (TZ) => {
    fs.mkdirSync(path.join(__dirname, '../.tmp'), { recursive: true });
    const directory = fs.mkdtempSync(path.join(__dirname, '../.tmp/bc-native-'));
    const env = { ...process.env, PLANSTRAND_TIMEZONE_PROBE_DIR: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ICU_TIMEZONE_FILES_DIR;
    delete env.TZ;
    if (TZ) env.TZ = TZ;
    const child = spawnSync(require('electron'), [__filename], {
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(child.status, 0, `${child.error ?? ''}\n${child.stderr}`);
    return JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'));
  };

  test(
    'native BC startup: historical rules, midnight, November and future dates agree in main, renderer and worker',
    { skip: !enabled },
    () => {
      assert.equal(
        execFileSync('tzutil', ['/g'], { encoding: 'utf8', windowsHide: true }).trim(),
        'British Columbia Standard Time',
        'This native regression requires the BC Windows zone; never change the OS for this test.',
      );
      const result = run();
      assert.equal(result.TZ, 'America/Vancouver');
      assert.deepEqual(result.main, result.renderer);
      assert.deepEqual(result.main, result.worker);
      const expected = [
        ['2025-01-15 00:00:00', 480],
        ['2025-07-15 00:00:00', 420],
        ['2025-11-02 01:59:59', 420],
        ['2025-11-02 01:00:00', 480],
        ['2026-01-15 00:00:00', 480],
        ['2026-03-08 01:59:59', 480],
        ['2026-03-08 03:00:00', 420],
        ['2026-10-13 23:59:59', 420],
        ['2026-10-14 00:00:00', 420],
        ['2026-11-01 01:59:59', 420],
        ['2026-11-01 02:00:00', 420],
        ['2026-12-15 00:00:00', 420],
        ['2027-01-15 00:00:00', 420],
        ['2030-01-15 00:00:00', 420],
      ];
      result.main.dates.forEach((date, index) => {
        assert.equal(date.date, expected[index][0]);
        assert.equal(date.vancouver, date.date);
        assert.equal(date.offset, expected[index][1]);
        assert.equal(date.epoch, Date.parse(date.utc));
      });
    },
  );

  test(
    'native startup preserves explicit TZ and explicit IANA formatting',
    { skip: !enabled },
    () => {
      const result = run('Asia/Tokyo');
      assert.equal(result.TZ, 'Asia/Tokyo');
      for (const context of [result.main, result.renderer, result.worker]) {
        assert.equal(context.zone, 'Asia/Tokyo');
        for (const date of context.dates) {
          assert.equal(date.date, date.tokyo);
          assert.equal(date.offset, -540);
        }
        assert.equal(context.dates.at(-1).vancouver, '2030-01-15 00:00:00');
      }
    },
  );
}
