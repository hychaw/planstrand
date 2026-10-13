const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { promises: fs } = require('node:fs');
const fsModule = require('node:fs');
const Module = require('node:module');

require('ts-node').register({
  transpileOnly: true,
  preferTsExts: true,
  project: path.join(__dirname, 'tsconfig.electron.json'),
});

const originalModuleLoad = Module._load;
const originalWriteFile = fsModule.promises.writeFile;
const originalReadFile = fsModule.promises.readFile;
const originalRename = fsModule.promises.rename;

let userDataDir;
let logCalls = [];
let errorCalls = [];

const simpleStoreModulePath = path.resolve(__dirname, 'simple-store.ts');
const getStorePath = () => path.join(userDataDir, 'simpleSettings');

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: (key) => {
            assert.equal(key, 'userData');
            return userDataDir;
          },
        },
      };
    }
    if (request === 'electron-log/main') {
      return {
        log: (...args) => logCalls.push(args),
        error: (...args) => errorCalls.push(args),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const resetModule = () => {
  delete require.cache[simpleStoreModulePath];
};

const loadSimpleStoreModule = () => {
  resetModule();
  return require(simpleStoreModulePath);
};

test.beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-simple-store-'));
  logCalls = [];
  errorCalls = [];
  fsModule.promises.writeFile = originalWriteFile;
  fsModule.promises.readFile = originalReadFile;
  fsModule.promises.rename = originalRename;
  installMocks();
});

test.afterEach(async () => {
  Module._load = originalModuleLoad;
  fsModule.promises.writeFile = originalWriteFile;
  fsModule.promises.readFile = originalReadFile;
  fsModule.promises.rename = originalRename;
  resetModule();
  const relative = path.relative(os.tmpdir(), path.resolve(userDataDir));
  assert.ok(relative.startsWith('sp-simple-store-') && !relative.includes(path.sep));
  await fs.rm(userDataDir, { recursive: true, force: true });
});

test('loadSimpleStoreAll quarantines corrupt JSON files', async () => {
  const storePath = getStorePath();
  await fs.writeFile(storePath, '{"broken"', 'utf8');

  const { loadSimpleStoreAll } = loadSimpleStoreModule();
  const data = await loadSimpleStoreAll();

  assert.deepEqual(data, {});

  const dirEntries = await fs.readdir(userDataDir);
  const quarantined = dirEntries.find((entry) =>
    entry.startsWith('simpleSettings.corrupt-'),
  );
  assert.ok(quarantined, 'expected corrupt file to be quarantined');
  await assert.rejects(fs.access(storePath));
  assert.ok(
    errorCalls.some(([message]) =>
      String(message).includes('Failed to parse simple store JSON'),
    ),
  );
});

test('saveSimpleStore replaces legacy directories with a file', async () => {
  const storePath = getStorePath();
  await fs.mkdir(storePath, { recursive: true });

  const { saveSimpleStore, loadSimpleStoreAll } = loadSimpleStoreModule();
  await saveSimpleStore('main', { theme: 'dark' });

  const stat = await fs.stat(storePath);
  assert.equal(stat.isFile(), true);
  assert.deepEqual(await loadSimpleStoreAll(), { main: { theme: 'dark' } });
});

test('saveSimpleStore serializes concurrent writes so keys are merged', async () => {
  const { saveSimpleStore, loadSimpleStoreAll } = loadSimpleStoreModule();

  let unblockFirstWrite;
  const firstWriteBlocked = new Promise((resolve) => {
    unblockFirstWrite = resolve;
  });
  let firstWriteSeen = false;

  fsModule.promises.writeFile = async (...args) => {
    const [target] = args;
    if (!firstWriteSeen && String(target).includes('.tmp')) {
      firstWriteSeen = true;
      await firstWriteBlocked;
    }
    return originalWriteFile.apply(fsModule.promises, args);
  };

  const firstSave = saveSimpleStore('alpha', { ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  const secondSave = saveSimpleStore('beta', { ok: true });

  unblockFirstWrite();
  await Promise.all([firstSave, secondSave]);

  assert.deepEqual(await loadSimpleStoreAll(), {
    alpha: { ok: true },
    beta: { ok: true },
  });
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const blockNextWrite = () => {
  const started = deferred();
  const completion = deferred();
  let blocked = false;
  fsModule.promises.writeFile = async (...args) => {
    if (!blocked && String(args[0]).includes('.tmp')) {
      blocked = true;
      started.resolve();
      await completion.promise;
    }
    return originalWriteFile.apply(fsModule.promises, args);
  };
  return { started: started.promise, completion };
};

test('settings preparation requires explicit authorization and does not read or mutate files itself', async () => {
  const store = loadSimpleStoreModule();
  assert.deepEqual(await store.prepareSimpleStoreForUpdate({ userConfirmed: false }), {
    ok: false,
    reason: 'CONSENT_REQUIRED',
  });
  assert.deepEqual(await fs.readdir(userDataDir), []);
  await store.saveSimpleStore('existing', { keep: true });
  const before = await fs.readFile(getStorePath(), 'utf8');
  const result = await store.prepareSimpleStoreForUpdate({ userConfirmed: true });
  assert.equal(result.ok, true);
  assert.equal(result.coverage, 'electron-simple-settings');
  assert.equal(await fs.readFile(getStorePath(), 'utf8'), before);
  result.lease.resume();
});

test('settings preparation closes admission immediately, waits for every accepted save and holds until resume', async () => {
  const store = loadSimpleStoreModule();
  const blocker = blockNextWrite();
  const first = store.saveSimpleStore('alpha', { keep: 1 });
  await blocker.started;
  const second = store.saveSimpleStore('beta', { keep: 2 });
  const preparation = store.prepareSimpleStoreForUpdate({ userConfirmed: true });
  let completed = false;
  void preparation.then(() => {
    completed = true;
  });
  await assert.rejects(
    store.saveSimpleStore('late', { forbidden: true }),
    /^Error: Settings paused for update preparation$/,
  );
  await assert.rejects(
    store.loadSimpleStoreAll(),
    /^Error: Settings paused for update preparation$/,
  );
  assert.equal(completed, false);
  blocker.completion.resolve();
  await Promise.all([first, second]);
  const result = await preparation;
  assert.equal(result.ok, true);
  assert.equal(result.lease.active, true);
  assert.deepEqual(JSON.parse(await fs.readFile(getStorePath(), 'utf8')), {
    alpha: { keep: 1 },
    beta: { keep: 2 },
  });
  await assert.rejects(store.saveSimpleStore('background', true));
  result.lease.resume();
  result.lease.resume();
  assert.equal(result.lease.active, false);
  await store.saveSimpleStore('after', true);
  assert.deepEqual(await store.loadSimpleStoreAll(), {
    alpha: { keep: 1 },
    beta: { keep: 2 },
    after: true,
  });
});

test('settings preparation waits for rename acknowledgement, not only the temporary-file write', async () => {
  const store = loadSimpleStoreModule();
  const renameStarted = deferred();
  const completeRename = deferred();
  fsModule.promises.rename = async (...args) => {
    renameStarted.resolve();
    await completeRename.promise;
    return originalRename.apply(fsModule.promises, args);
  };
  const write = store.saveSimpleStore('main', { keep: true });
  await renameStarted.promise;
  const preparation = store.prepareSimpleStoreForUpdate({ userConfirmed: true });
  let completed = false;
  void preparation.then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  completeRename.resolve();
  await write;
  const result = await preparation;
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(await fs.readFile(getStorePath(), 'utf8')), {
    main: { keep: true },
  });
  result.lease.resume();
});

test('concurrent requests reject safely and an old lease cannot reopen a later preparation', async () => {
  const store = loadSimpleStoreModule();
  const first = await store.prepareSimpleStoreForUpdate({ userConfirmed: true });
  assert.deepEqual(await store.prepareSimpleStoreForUpdate({ userConfirmed: true }), {
    ok: false,
    reason: 'BUSY',
  });
  first.lease.resume();
  const second = await store.prepareSimpleStoreForUpdate({ userConfirmed: true });
  first.lease.resume();
  assert.equal(first.lease.active, false);
  assert.equal(second.lease.active, true);
  await assert.rejects(store.saveSimpleStore('late', true));
  second.lease.resume();
});

test('failed accepted writes prevent success even when a later queued write succeeds; normal saves resume', async () => {
  const store = loadSimpleStoreModule();
  await store.saveSimpleStore('existing', { keep: true });
  const blocker = blockNextWrite();
  const failed = store.saveSimpleStore('failed', true);
  const rejection = assert.rejects(failed, /injected write failure/);
  await blocker.started;
  const next = store.saveSimpleStore('next', true);
  const preparation = store.prepareSimpleStoreForUpdate({ userConfirmed: true });
  blocker.completion.reject(new Error('injected write failure'));
  await rejection;
  await next;
  assert.deepEqual(await preparation, { ok: false, reason: 'PERSISTENCE_FAILED' });
  await store.saveSimpleStore('ordinary', true);
  assert.deepEqual(await store.loadSimpleStoreAll(), {
    existing: { keep: true },
    next: true,
    ordinary: true,
  });
  assert.deepEqual(await store.prepareSimpleStoreForUpdate({ userConfirmed: true }), {
    ok: false,
    reason: 'PERSISTENCE_FAILED',
  });
});

test('timeout returns failure, preserves the accepted write and restores normal serial ordering', async () => {
  const store = loadSimpleStoreModule();
  const blocker = blockNextWrite();
  const accepted = store.saveSimpleStore('beforeTimeout', true);
  await blocker.started;
  const result = await store.prepareSimpleStoreForUpdate({
    userConfirmed: true,
    timeoutMs: 5,
  });
  assert.deepEqual(result, { ok: false, reason: 'TIMED_OUT' });
  const after = store.saveSimpleStore('afterTimeout', true);
  blocker.completion.resolve();
  await Promise.all([accepted, after]);
  assert.deepEqual(await store.loadSimpleStoreAll(), {
    beforeTimeout: true,
    afterTimeout: true,
  });
  const retry = await store.prepareSimpleStoreForUpdate({ userConfirmed: true });
  assert.equal(retry.ok, true);
  retry.lease.resume();
});

test('cancellation during drain reopens admission without dropping accepted writes or a later lease', async () => {
  const store = loadSimpleStoreModule();
  const blocker = blockNextWrite();
  const write = store.saveSimpleStore('beforeCancel', true);
  await blocker.started;
  const controller = new AbortController();
  const preparation = store.prepareSimpleStoreForUpdate({
    userConfirmed: true,
    signal: controller.signal,
  });
  controller.abort();
  assert.deepEqual(await preparation, { ok: false, reason: 'CANCELLED' });
  const after = store.saveSimpleStore('afterCancel', true);
  const nextPreparation = store.prepareSimpleStoreForUpdate({ userConfirmed: true });
  blocker.completion.resolve();
  await Promise.all([write, after]);
  const next = await nextPreparation;
  assert.equal(next.ok, true);
  await assert.rejects(store.saveSimpleStore('late', true));
  next.lease.resume();
  assert.deepEqual(await store.loadSimpleStoreAll(), {
    beforeCancel: true,
    afterCancel: true,
  });
});

test('cancellation after preparation invalidates its lease and leaves stored data intact', async () => {
  const store = loadSimpleStoreModule();
  const controller = new AbortController();
  const result = await store.prepareSimpleStoreForUpdate({
    userConfirmed: true,
    signal: controller.signal,
  });
  controller.abort();
  assert.equal(result.lease.active, false);
  await store.saveSimpleStore('resumed', true);
  assert.deepEqual(await store.loadSimpleStoreAll(), { resumed: true });
  assert.deepEqual(
    await store.prepareSimpleStoreForUpdate({
      userConfirmed: true,
      signal: controller.signal,
    }),
    { ok: false, reason: 'CANCELLED' },
  );
});

test('repair-capable reads cannot start while paused, including corrupt and legacy settings paths', async () => {
  const store = loadSimpleStoreModule();
  for (const legacy of [false, true]) {
    if (legacy) {
      await fs.unlink(getStorePath());
      await fs.mkdir(getStorePath());
    } else await fs.writeFile(getStorePath(), '{"invalid"', 'utf8');
    const result = await store.prepareSimpleStoreForUpdate({ userConfirmed: true });
    await assert.rejects(store.loadSimpleStoreAll());
    assert.deepEqual(await fs.readdir(userDataDir), ['simpleSettings']);
    assert.equal((await fs.stat(getStorePath())).isDirectory(), legacy);
    result.lease.resume();
  }
});

test('an already admitted corrupt-file read is awaited, and its failure cannot produce preparation success', async () => {
  const store = loadSimpleStoreModule();
  await fs.writeFile(getStorePath(), '{"invalid"', 'utf8');
  const readStarted = deferred();
  const completeRead = deferred();
  fsModule.promises.readFile = async (...args) => {
    readStarted.resolve();
    await completeRead.promise;
    return originalReadFile.apply(fsModule.promises, args);
  };
  const read = store.loadSimpleStoreAll();
  await readStarted.promise;
  const preparation = store.prepareSimpleStoreForUpdate({ userConfirmed: true });
  completeRead.resolve();
  assert.deepEqual(await read, {});
  assert.deepEqual(await preparation, { ok: false, reason: 'PERSISTENCE_FAILED' });
  const files = await fs.readdir(userDataDir);
  assert.equal(files.length, 1);
  assert.ok(files[0].startsWith('simpleSettings.corrupt-'));
  assert.equal(
    await originalReadFile.call(
      fsModule.promises,
      path.join(userDataDir, files[0]),
      'utf8',
    ),
    '{"invalid"',
  );
});
