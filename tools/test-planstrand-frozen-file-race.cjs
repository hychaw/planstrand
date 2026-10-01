// Frozen v19.1.0 adapter regression. Run from the repository root.
// Controlled plaintext transport and DI; no real remote files are changed.
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const localRequire = createRequire(process.cwd() + '/package.json');
const ts = localRequire('typescript');
const file =
  'src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts';
const source = execFileSync('git', ['show', 'v19.1.0:' + file], { encoding: 'utf8' });
const errorsSource = execFileSync(
  'git',
  ['show', 'v19.1.0:src/app/op-log/core/errors/sync-errors.ts'],
  { encoding: 'utf8' },
);
const constantsSource = execFileSync(
  'git',
  ['show', 'v19.1.0:packages/sync-providers/src/file-based-sync-data.ts'],
  { encoding: 'utf8' },
);
const transpile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
  }).outputText;
const parsed = ts.createSourceFile(
  'errors.ts',
  errorsSource,
  ts.ScriptTarget.Latest,
  true,
);
const errorClass = parsed.statements.find(
  (s) => ts.isClassDeclaration(s) && s.name.text === 'SyncDataCorruptedError',
);
const errorsModule = { exports: {} };
vm.runInNewContext(transpile(errorClass.getText(parsed)), {
  exports: errorsModule.exports,
});
const mocks = { ...errorsModule.exports };
for (const name of [
  'DecompressError',
  'DecryptError',
  'FileSyncTargetChangedError',
  'InvalidDataSPError',
  'JsonParseError',
  'LegacySyncFormatDetectedError',
  'PlaintextWhenEncryptionExpectedError',
  'RemoteFileNotFoundAPIError',
  'SplitSyncFormatDetectedError',
  'UploadRevToMatchMismatchAPIError',
])
  mocks[name] = class extends Error {};
const constantsModule = { exports: {} };
vm.runInNewContext(transpile(constantsSource), { exports: constantsModule.exports });
Object.assign(mocks, constantsModule.exports);
const cfg = { isCompress: false, isEncrypt: false };
const encode = (data) => 'pf_' + data.version + '__' + JSON.stringify(data);
class Codec {
  async compressAndEncryptData(_cfg, _key, data) {
    return encode(data);
  }
  async decompressAndDecryptData(_cfg, _key, text) {
    try {
      return JSON.parse(text.slice(text.indexOf('__') + 2));
    } catch {
      throw new mocks.JsonParseError();
    }
  }
}
const noop = () => {};
Object.assign(mocks, {
  Injectable: () => (x) => x,
  inject: () => ({
    get: () => null,
    loadArchiveYoung: async () => undefined,
    loadArchiveOld: async () => undefined,
    getStateSnapshotForOperationLog: () => ({ sentinel: 'legacy' }),
  }),
  EncryptAndCompressHandlerService: Codec,
  SyncProviderId: { Dropbox: 'Dropbox', OneDrive: 'OneDrive' },
  OpLog: { normal: noop, warn: noop, log: noop, verbose: noop, err: noop },
  stripLocalOnlySyncSettingsFromAppData: (x) => x,
  mergeVectorClocks: (a, b) => ({ ...a, ...b }),
  compareVectorClocks: () => 'EQUAL',
  encodeOperation: (op) => ({
    id: op.id,
    a: op.actionType,
    o: op.opType,
    e: op.entityType,
    p: op.payload,
    c: op.clientId,
    v: op.vectorClock,
    t: op.timestamp,
    s: op.schemaVersion,
  }),
});
const mod = { exports: {} };
vm.runInNewContext(transpile(source), {
  exports: mod.exports,
  require: () => mocks,
  localStorage: { getItem: () => null, setItem: noop },
  console,
  crypto: globalThis.crypto,
});
const Adapter = mod.exports.FileBasedSyncAdapterService;
function providerFor(data) {
  const files = new Map();
  let seq = 0;
  const p = {
    id: 'LocalFile',
    files,
    async removeFile(path) {
      files.delete(path);
    },
    async downloadFile(path) {
      if (!files.has(path)) throw new mocks.RemoteFileNotFoundAPIError();
      return files.get(path);
    },
    async getFileRev(path) {
      return { rev: (await p.downloadFile(path)).rev };
    },
    async uploadFile(path, dataStr, rev, force) {
      if (!force && (files.get(path)?.rev ?? null) !== rev)
        throw new mocks.UploadRevToMatchMismatchAPIError();
      const response = { dataStr, rev: String(++seq) };
      files.set(path, response);
      return { rev: response.rev };
    },
  };
  p.seed = async (path, body) => p.uploadFile(path, encode(body), null, true);
  return p;
}
const legacy = {
  version: 2,
  syncVersion: 1,
  schemaVersion: 1,
  vectorClock: { old: 1 },
  lastModified: 1,
  clientId: 'old',
  state: { sentinel: 'legacy' },
  recentOps: [],
};
(async () => {
  const p = providerFor();
  await p.seed('sync-data.json', legacy);
  const old = new Adapter();
  const original = await old._downloadSyncFile(p, cfg);
  const isolated = {
    ...legacy,
    version: 4,
    product: 'planstrand',
    compatibility: { requiredOpTypes: [] },
    state: { sentinel: 'planstrand' },
  };
  await p.seed('planstrand-sync-data.json', isolated);
  await p.seed('planstrand-sync-data.json.bak', isolated);
  const planstrandBefore = JSON.stringify(
    [...p.files].filter(([name]) => name.startsWith('planstrand-')),
  );
  // Give the proposed transition the strongest backup protection: both copies
  // already contain v4 before the delayed old writer resumes.
  await p.seed('sync-data.json.bak', { ...legacy, version: 4 });
  await p.uploadFile(
    'sync-data.json',
    encode({ ...legacy, version: 4, state: { sentinel: 'future' } }),
    original.rev,
    false,
  );
  // Exact frozen backup writer; this write is independent of primary CAS.
  await old._writeBakFile(p, cfg, undefined, 'sync-data.json.bak', original.data, 2);
  await assert.rejects(
    p.uploadFile('sync-data.json', encode(legacy), original.rev, false),
    mocks.UploadRevToMatchMismatchAPIError,
  );
  console.log(
    'PASS: stale primary CAS rejected; stale legacy backup nevertheless installed',
  );
  // Frozen release considers even a valid newer version recoverable corruption.
  const cold = new Adapter();
  const response = await cold._downloadOps(p, cfg, undefined, 0);
  assert.equal(response.snapshotState.sentinel, 'legacy');
  console.log(
    'REPRODUCED: frozen v19.1.0 returns legacy snapshot from backup beside intact v4 primary',
  );
  const api = cold.createAdapter(p, cfg, undefined);
  await api.setLastServerSeq(response.latestSeq);
  await api.uploadOps(
    [
      {
        id: 'baseline',
        clientId: 'old',
        actionType: '[Task] Update task',
        opType: 'UPD',
        entityType: 'TASK',
        payload: {},
        vectorClock: { old: 2 },
        timestamp: 2,
        schemaVersion: 1,
      },
    ],
    'old',
    response.latestSeq,
    response.snapshotState,
  );
  assert.equal(
    JSON.parse((await p.downloadFile('sync-data.json')).dataStr.split('__')[1]).version,
    2,
  );
  console.log(
    'REPRODUCED: frozen v19.1.0 conditionally heals v2 over the fenced primary',
  );
  await api.deleteAllData();
  assert.equal(
    JSON.stringify([...p.files].filter(([name]) => name.startsWith('planstrand-'))),
    planstrandBefore,
  );
  // Execute the production namespace/manifest boundary, then the frozen layout
  // reader on its in-memory projection to prove a cold reader selects its state.
  const fs = require('node:fs');
  const protocolModule = { exports: {} };
  const protocol = fs.readFileSync(
    'src/app/op-log/sync-providers/file-based/planstrand-file-protocol.ts',
    'utf8',
  );
  const dependencies = { ...mocks, SUPER_SYNC_BASELINE_OP_TYPES: ['CRT', 'UPD', 'DEL'] };
  vm.runInNewContext(transpile(protocol), {
    exports: protocolModule.exports,
    require: () => dependencies,
  });
  const transportModule = { exports: {} };
  const transport = fs.readFileSync(
    'src/app/op-log/sync-providers/file-based/planstrand-file-transport.ts',
    'utf8',
  );
  vm.runInNewContext(transpile(transport), {
    exports: transportModule.exports,
    require: () => ({
      ...dependencies,
      ...protocolModule.exports,
      extractSyncFileStateFromPrefix: (text) => ({
        modelVersion: Number(text.match(/^pf_(\d+)__/)[1]),
      }),
    }),
  });
  const boundary = new transportModule.exports.PlanstrandFileTransport(
    p,
    cfg,
    undefined,
    {
      supportedOpTypes: new Set(['CRT', 'UPD', 'DEL']),
      requiredOpTypes: [],
      assertTargetCurrent: noop,
    },
  );
  const coldPlanstrand = new Adapter();
  assert.equal(
    (await coldPlanstrand._downloadOps(boundary.provider, cfg, undefined, 0))
      .snapshotState.sentinel,
    'planstrand',
  );
  console.log(
    'PASS: delayed backup writer, recovery, legacy writes and deleteAllData leave Planstrand primary/backup byte-identical; cold namespace reader returns Planstrand state',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
