const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const childProcess = require('node:child_process');
require('ts-node').register({
  transpileOnly: true,
  preferTsExts: true,
  project: path.join(__dirname, 'tsconfig.electron.json'),
});

let records;
let queryError;
let queryCalls;
let liveQuery = false;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (
    request === 'node:child_process' &&
    parent?.filename.endsWith('update-installation.ts')
  ) {
    return {
      execFile: (executable, args, options, callback) => {
        if (liveQuery) return childProcess.execFile(executable, args, options, callback);
        queryCalls.push({ executable, args, options });
        callback(queryError, queryError ? '' : JSON.stringify(records));
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const installation = require('./update-installation.ts');
Module._load = originalLoad;

const registration = (directory) =>
  ['CurrentUser', 'LocalMachine'].flatMap((hive) =>
    ['Registry64', 'Registry32'].map((view) => ({
      hive,
      view,
      location: hive === 'CurrentUser' ? directory : '',
      uninstall:
        hive === 'CurrentUser'
          ? `"${directory}\\Uninstall Planstrand.exe" /currentuser`
          : '',
    })),
  );
const context = (directory) => ({
  packaged: true,
  platform: 'win32',
  arch: 'x64',
  channel: 'win-nsis',
  executable: path.win32.join(directory, 'Planstrand.exe'),
});
let root;
test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'planstrand-registration-test-'));
  records = registration(root);
  queryError = undefined;
  queryCalls = [];
  for (const name of ['Planstrand.exe', 'Uninstall Planstrand.exe'])
    fs.writeFileSync(path.join(root, name), 'Harmless fixture. Never executed.');
  fs.writeFileSync(
    path.join(root, 'planstrand-install.ini'),
    '[Planstrand]\r\nAppId=io.github.hychaw.planstrand\r\n',
  );
});
test.afterEach(() => {
  const relative = path.relative(os.tmpdir(), path.resolve(root));
  assert.ok(
    relative.startsWith('planstrand-registration-test-') && !relative.includes(path.sep),
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('GUID remains bound to the actual electron-builder registration contract', () => {
  const { UUID } = require('builder-util-runtime');
  assert.equal(
    installation.UPDATE_INSTALL_GUID,
    UUID.v5(
      'io.github.hychaw.planstrand',
      UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'),
    ),
  );
  const config = fs.readFileSync(
    path.join(__dirname, '../electron-builder.yaml'),
    'utf8',
  );
  assert.match(config, /appId: io.github.hychaw.planstrand/);
  assert.doesNotMatch(config, /\bguid:/);
});

test('current-user x64 registration and its exact executable destination are eligible', async () => {
  assert.equal(
    installation.registeredInstallationDirectory(context(root), records),
    root,
  );
  assert.equal(await installation.isRegisteredUpdateInstallation(context(root)), true);
  assert.equal(queryCalls.length, 1);
  const call = queryCalls[0];
  assert.equal(path.isAbsolute(call.executable), true);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.timeout, 10000);
  assert.equal(call.options.maxBuffer, 16384);
  assert.ok(call.args.includes('-NoProfile') && call.args.includes('-NonInteractive'));
  const script = Buffer.from(call.args.at(-1), 'base64').toString('utf16le');
  assert.ok(script.includes(installation.UPDATE_INSTALL_GUID));
  assert.ok(!script.includes(root));
  assert.doesNotMatch(script, /SetValue|DeleteSubKey|Start-Process/);
});

test('Portable, Store, development, unpacked, unknown and unsupported architectures never query registry', async () => {
  for (const override of [
    { packaged: false },
    { platform: 'linux' },
    { platform: 'darwin' },
    { arch: 'arm64' },
    { arch: 'ia32' },
    { channel: 'win-portable' },
    { channel: 'win-store' },
    { channel: 'development' },
    { channel: null },
  ]) {
    assert.equal(
      await installation.isRegisteredUpdateInstallation({
        ...context(root),
        ...override,
      }),
      false,
    );
  }
  assert.equal(queryCalls.length, 0);
});

test('marker and channel alone are not registration evidence', async () => {
  records = registration('');
  for (const r of records) r.uninstall = '';
  assert.equal(await installation.isRegisteredUpdateInstallation(context(root)), false);
});

test('wrong destination, uninstaller arguments, partial, duplicate and mixed registrations fail closed', () => {
  for (const edit of [
    (r) => {
      r[0].location += '\\foreign';
      r[1].location = r[0].location;
    },
    (r) => {
      r[0].uninstall += ' /S';
      r[1].uninstall = r[0].uninstall;
    },
    (r) => {
      r[0].uninstall = r[0].uninstall.replace('/currentuser', '/allusers');
      r[1].uninstall = r[0].uninstall;
    },
    (r) => {
      r[0].uninstall = '';
      r[1].uninstall = '';
    },
    (r) => {
      r[1].location = `${root}-foreign`;
    },
    (r) => {
      r[2].uninstall = 'foreign';
    },
    (r) => {
      r.pop();
    },
    (r) => {
      r[1] = r[0];
    },
    (r) => {
      r[0] = null;
    },
  ]) {
    const r = registration(root);
    edit(r);
    assert.equal(
      installation.registeredInstallationDirectory(context(root), r),
      undefined,
    );
  }
});

test('UNC, device, drive-root, noncanonical, trailing-dot and stream destinations are refused', () => {
  for (const directory of [
    'C:\\',
    '\\\\server\\share\\app',
    '\\\\?\\C:\\app',
    'C:\\a\\..\\app',
    'C:\\app.',
    'C:\\app ',
    'C:\\app:stream',
    'C:\\app\\',
  ]) {
    assert.equal(
      installation.registeredInstallationDirectory(
        context(directory),
        registration(directory),
      ),
      undefined,
    );
  }
});

test('custom installation directories are preserved; profiles are never used to infer eligibility', () => {
  const directory = 'D:\\Custom Applications\\Planstrand';
  assert.equal(
    installation.registeredInstallationDirectory(
      context(directory),
      registration(directory),
    ),
    directory,
  );
  assert.equal(
    installation.registeredInstallationDirectory(
      { ...context(directory), executable: 'C:\\Other\\Planstrand.exe' },
      registration(directory),
    ),
    undefined,
  );
});

test('missing, foreign, duplicate or oversized ownership marker is rejected', async () => {
  for (const content of [
    '',
    '[Other]\nAppId=io.github.hychaw.planstrand',
    '[Planstrand]\nAppId=foreign',
    '[Planstrand]\nAppId=io.github.hychaw.planstrand\nAppId=foreign',
    'x'.repeat(1025),
  ]) {
    fs.writeFileSync(path.join(root, 'planstrand-install.ini'), content);
    assert.equal(await installation.isRegisteredUpdateInstallation(context(root)), false);
  }
  fs.unlinkSync(path.join(root, 'planstrand-install.ini'));
  assert.equal(await installation.isRegisteredUpdateInstallation(context(root)), false);
});

test('missing or non-file installed executables and repository destinations are rejected', async () => {
  fs.unlinkSync(path.join(root, 'Uninstall Planstrand.exe'));
  assert.equal(await installation.isRegisteredUpdateInstallation(context(root)), false);
  fs.mkdirSync(path.join(root, 'Uninstall Planstrand.exe'));
  assert.equal(await installation.isRegisteredUpdateInstallation(context(root)), false);
  fs.rmdirSync(path.join(root, 'Uninstall Planstrand.exe'));
  fs.writeFileSync(path.join(root, 'Uninstall Planstrand.exe'), 'fixture');
  fs.mkdirSync(path.join(root, '.git'));
  assert.equal(await installation.isRegisteredUpdateInstallation(context(root)), false);
});

test('junction installation aliases are rejected without traversing a foreign destination', async () => {
  const alias = `${root}-alias`;
  try {
    fs.symlinkSync(root, alias, 'junction');
    records = registration(alias);
    assert.equal(
      await installation.isRegisteredUpdateInstallation(context(alias)),
      false,
    );
  } finally {
    if (fs.existsSync(alias)) fs.unlinkSync(alias);
  }
});

test('registry failure is opaque and never becomes eligibility', async () => {
  queryError = new Error('private path or registry diagnostic');
  assert.equal(await installation.isRegisteredUpdateInstallation(context(root)), false);
  await assert.rejects(
    installation.readInstallationRegistrations(),
    /^Error: Installation unavailable$/,
  );
});

test(
  'actual Windows read-only registry query returns all four views',
  { skip: process.platform !== 'win32' },
  async () => {
    liveQuery = true;
    try {
      const result = await installation.readInstallationRegistrations();
      assert.equal(result.length, 4);
      assert.equal(new Set(result.map((r) => `${r.hive}/${r.view}`)).size, 4);
    } finally {
      liveQuery = false;
    }
  },
);
