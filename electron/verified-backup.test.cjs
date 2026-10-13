const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
require('ts-node').register({
  transpileOnly: true,
  preferTsExts: true,
  project: path.join(__dirname, 'tsconfig.electron.json'),
});

const modulePath = path.resolve(__dirname, 'verified-backup.ts');
const originalLoad = Module._load;
const testDirectory = path.resolve(__dirname, '../.tmp');
let root;
let overrides;
let writeVerifiedBackup;
test.beforeEach(() => {
  fs.mkdirSync(testDirectory, { recursive: true });
  root = fs.mkdtempSync(path.join(testDirectory, 'planstrand-checkpoint-test-'));
  overrides = {};
  Module._load = function (request, parent, isMain) {
    if (request === 'fs' && parent?.filename === modulePath)
      return { ...fs, ...overrides };
    return originalLoad.call(this, request, parent, isMain);
  };
});
const load = () => {
  delete require.cache[modulePath];
  ({ writeVerifiedBackup } = require(modulePath));
};
test.afterEach(() => {
  Module._load = originalLoad;
  delete require.cache[modulePath];
  // Only the unique disposable directory created above can be removed.
  assert.equal(path.dirname(root), testDirectory);
  assert.match(path.basename(root), /^planstrand-checkpoint-test-/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('writes and reads exact JSON through a flushed temporary file and rename', () => {
  const order = [];
  overrides.fsyncSync = (fd) => {
    order.push('flush');
    fs.fsyncSync(fd);
  };
  overrides.renameSync = (from, to) => {
    order.push('rename');
    assert.equal(from, `${to}.tmp`);
    assert.equal(fs.existsSync(to), false);
    fs.renameSync(from, to);
  };
  load();
  const data = { task: { title: 'private fixture' }, archiveYoung: { task: {} } };
  const file = writeVerifiedBackup(root, data);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), data);
  assert.deepEqual(order, ['flush', 'rename']);
  assert.deepEqual(fs.readdirSync(root), [path.basename(file)]);
});

test('two rapid writes preserve both checkpoints and never overwrite a backup', () => {
  load();
  const first = writeVerifiedBackup(root, { generation: 1 });
  const second = writeVerifiedBackup(root, { generation: 2 });
  assert.notEqual(first, second);
  assert.deepEqual(JSON.parse(fs.readFileSync(first, 'utf8')), { generation: 1 });
  assert.equal(fs.readdirSync(root).length, 2);
});

for (const operation of [
  'mkdirSync',
  'openSync',
  'writeFileSync',
  'fsyncSync',
  'renameSync',
  'readFileSync',
]) {
  test(`failed ${operation} rejects and preserves the previous verified checkpoint`, () => {
    load();
    const first = writeVerifiedBackup(root, { generation: 1 });
    overrides[operation] = () => {
      throw new Error('private content');
    };
    load();
    assert.throws(() => writeVerifiedBackup(root, { generation: 2 }), /Backup .* failed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(first, 'utf8')), { generation: 1 });
    assert.deepEqual(fs.readdirSync(root), [path.basename(first)]);
  });
}

test('serialization failure rejects without touching the previous file', () => {
  load();
  const first = writeVerifiedBackup(root, { generation: 1 });
  const circular = {};
  circular.secret = circular;
  for (const data of [circular, { secret: 1n }, undefined]) {
    assert.throws(() => writeVerifiedBackup(root, data), /Backup serialization failed/);
  }
  assert.deepEqual(fs.readdirSync(root), [path.basename(first)]);
});

test('readback mismatch rejects before publication and keeps the previous file', () => {
  load();
  const first = writeVerifiedBackup(root, { generation: 1 });
  overrides.readFileSync = () => '{}';
  load();
  assert.throws(
    () => writeVerifiedBackup(root, { generation: 2 }),
    /Backup verification failed/,
  );
  assert.deepEqual(fs.readdirSync(root), [path.basename(first)]);
});

test('published readback failure removes only the failed attempt', () => {
  load();
  const first = writeVerifiedBackup(root, { generation: 1 });
  overrides.readFileSync = (file, encoding) => {
    if (file.endsWith('.json')) throw new Error('private fixture');
    return fs.readFileSync(file, encoding);
  };
  load();
  assert.throws(
    () => writeVerifiedBackup(root, { generation: 2 }),
    /Backup published verification failed/,
  );
  assert.deepEqual(fs.readdirSync(root), [path.basename(first)]);
});
