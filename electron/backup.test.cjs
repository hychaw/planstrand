const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node').register({
  transpileOnly: true,
  preferTsExts: true,
  project: path.join(__dirname, 'tsconfig.electron.json'),
});

const originalModuleLoad = Module._load;
const backupModulePath = path.resolve(__dirname, 'backup.ts');

// Windows-shaped so the `.replace('Roaming', ...)` derivation actually fires on
// Linux/macOS CI too — otherwise BACKUP_DIR_WINSTORE would equal BACKUP_DIR and
// every assertion below would pass vacuously.
const USER_DATA = 'C:\\Users\\testuser\\AppData\\Roaming\\superProductivity';
// path.join, like the module under test — the separator is the host's, not '\'.
const BACKUP_DIR = path.join(USER_DATA, 'backups');
const BACKUP_DIR_WINSTORE = BACKUP_DIR.replace(
  'Roaming',
  'Local\\Packages\\53707johannesjo.SuperProductivity_ch45amy23cdv6\\LocalCache\\Roaming',
);

let existingPaths;
let handleHandlers;
let onHandlers;
// fileName -> mtime (ms) served by the mocked readdirSync/statSync
let backupFiles;
let backupWriter;

const resetModule = () => {
  delete require.cache[backupModulePath];
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => USER_DATA },
        ipcMain: {
          on: (channel, handler) => onHandlers.set(channel, handler),
          handle: (channel, handler) => handleHandlers.set(channel, handler),
        },
      };
    }

    if (request === 'electron-log/main') {
      return { log: () => {}, error: () => {} };
    }

    if (request === './verified-backup' && parent?.filename === backupModulePath) {
      return { writeVerifiedBackup: (...args) => backupWriter(...args) };
    }

    // Scoped to backup.ts so ts-node / node:test keep the real fs.
    if (
      request === 'fs' &&
      parent &&
      typeof parent.filename === 'string' &&
      parent.filename.endsWith('backup.ts')
    ) {
      const realFs = originalModuleLoad.call(this, request, parent, isMain);
      return {
        ...realFs,
        existsSync: (p) => existingPaths.has(p),
        readdirSync: () => Array.from(backupFiles.keys()),
        statSync: (p) => ({ mtime: new Date(backupFiles.get(path.basename(p))) }),
      };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadBackupModule = () => {
  resetModule();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(backupModulePath);
};

test.beforeEach(() => {
  existingPaths = new Set();
  handleHandlers = new Map();
  onHandlers = new Map();
  backupFiles = new Map();
  backupWriter = () => 'verified.json';
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  delete process.windowsStore;
  resetModule();
});

// Sanity check: without this the Windows-only branches below could never be
// reached on a Linux CI runner and the suite would be green for the wrong reason.
test('derives a distinct Windows Store path from the userData path', () => {
  assert.notEqual(BACKUP_DIR_WINSTORE, BACKUP_DIR);
  assert.match(BACKUP_DIR_WINSTORE, /LocalCache\\Roaming/);
});

test('registers backup writes as a completion-aware IPC handler', () => {
  const { initBackupAdapter } = loadBackupModule();

  initBackupAdapter();

  assert.equal(handleHandlers.has('BACKUP'), true);
  assert.equal(onHandlers.has('BACKUP'), false);
});

test('BACKUP acknowledges only after verified writing and propagates failure', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  let written = false;
  backupWriter = (directory, data) => {
    assert.equal(directory, BACKUP_DIR);
    assert.deepEqual(data, { task: 'test' });
    written = true;
  };
  assert.equal(handleHandlers.get('BACKUP')(null, { data: { task: 'test' } }), undefined);
  assert.equal(written, true);
  backupWriter = () => {
    throw new Error('Backup could not be persisted and verified');
  };
  assert.throws(
    () => handleHandlers.get('BACKUP')(null, { data: {} }),
    /persisted and verified/,
  );
});

test('checkpoint IPC uses separate storage and returns explicit failure', () => {
  const { initBackupAdapter, UPGRADE_CHECKPOINT_DIR } = loadBackupModule();
  initBackupAdapter();
  assert.notEqual(UPGRADE_CHECKPOINT_DIR, BACKUP_DIR);
  backupWriter = (directory) => {
    assert.equal(directory, UPGRADE_CHECKPOINT_DIR);
    return path.join(directory, 'verified.json');
  };
  assert.deepEqual(handleHandlers.get('BACKUP_UPGRADE_CHECKPOINT')(null, {}), {
    ok: true,
    path: path.join(UPGRADE_CHECKPOINT_DIR, 'verified.json'),
    coverage: 'application-data',
  });
  backupWriter = () => {
    throw new Error('private content must not escape');
  };
  assert.deepEqual(handleHandlers.get('BACKUP_UPGRADE_CHECKPOINT')(null, {}), {
    ok: false,
    reason: 'WRITE_FAILED',
  });
});

test('BACKUP_LIST returns every backup file newest first', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  backupFiles.set('old.json', 1000);
  backupFiles.set('new.json', 3000);
  backupFiles.set('mid.json', 2000);
  backupFiles.set('notes.txt', 4000);

  const list = handleHandlers.get('BACKUP_LIST')();

  assert.deepEqual(
    list.map((f) => f.name),
    ['new.json', 'mid.json', 'old.json'],
  );
  assert.equal(list[0].path, path.join(BACKUP_DIR, 'new.json'));
  assert.equal(list[0].folder, BACKUP_DIR);
  assert.equal(list[0].created, 3000);
});

test('BACKUP_LIST is empty and BACKUP_IS_AVAILABLE false without a backup dir', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();

  assert.deepEqual(handleHandlers.get('BACKUP_LIST')(), []);
  assert.equal(handleHandlers.get('BACKUP_IS_AVAILABLE')(), false);
});

test('BACKUP_IS_AVAILABLE returns the newest file', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  backupFiles.set('old.json', 1000);
  backupFiles.set('new.json', 3000);

  assert.equal(handleHandlers.get('BACKUP_IS_AVAILABLE')().name, 'new.json');
});

test('non-Store builds always get the real backup dir', () => {
  const { getBackupDirForDisplay } = loadBackupModule();

  // Even if a LocalCache dir is left over from a previous Store install.
  existingPaths.add(BACKUP_DIR_WINSTORE);

  assert.equal(getBackupDirForDisplay(), BACKUP_DIR);
});

// Regression test for #995: a virtualized Store package redirects its writes
// into LocalCache, so showing the plain Roaming path sends the user to a folder
// their backups are not in.
test('Store builds get the LocalCache path when it exists', () => {
  process.windowsStore = true;
  const { getBackupDirForDisplay } = loadBackupModule();

  existingPaths.add(BACKUP_DIR_WINSTORE);

  assert.equal(getBackupDirForDisplay(), BACKUP_DIR_WINSTORE);
});

// Regression test for #9209: a non-virtualized Store package writes to the real
// AppData\Roaming, so the LocalCache path does not exist and must not be shown.
test('Store builds fall back to the real backup dir when LocalCache is absent', () => {
  process.windowsStore = true;
  const { getBackupDirForDisplay } = loadBackupModule();

  existingPaths.add(BACKUP_DIR);

  assert.equal(getBackupDirForDisplay(), BACKUP_DIR);
});
