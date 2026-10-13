const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Duplex } = require('node:stream');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const Module = require('node:module');
const https = require('node:https');
require('ts-node').register({
  transpileOnly: true,
  preferTsExts: true,
  project: path.join(__dirname, 'tsconfig.electron.json'),
});

const fixtureKey = generateKeyPairSync('ed25519');
const keys = {
  fixture: fixtureKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};
const trust = require('./update-trust.ts');
const tag = 'v1.3.0-rc.1';
const artifact = Buffer.from('Harmless fixture bytes. This is not an executable.');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const manifest = {
  schema: 1,
  keyId: 'fixture',
  appId: trust.UPDATE_APP_ID,
  version: tag.slice(1),
  tag,
  platform: 'win32',
  arch: 'x64',
  package: 'nsis',
  filename: trust.UPDATE_INSTALLER,
  bytes: artifact.length,
  sha256: digest(artifact),
};
const bytes = trust.manifestBytes(manifest);
const signature = sign(null, bytes, fixtureKey.privateKey);
const assetUrl = (name) =>
  `https://github.com/hychaw/planstrand/releases/download/${tag}/${name}`;
const api = 'https://api.github.com/repos/hychaw/planstrand/releases';
const release = () => ({
  tag_name: tag,
  draft: false,
  prerelease: true,
  html_url: `https://github.com/hychaw/planstrand/releases/tag/${tag}`,
  assets: [
    [trust.UPDATE_INSTALLER, artifact],
    [trust.UPDATE_MANIFEST, bytes],
    [trust.UPDATE_SIGNATURE, signature],
  ].map(([name, data]) => ({
    name,
    state: 'uploaded',
    size: data.length,
    browser_download_url: assetUrl(name),
  })),
});

let routes;
let requests;
let tlsFixture;
let handlers;
let corruptStaging;
const mainFrame = { url: 'file:///fixture/index.html' };
const sender = { mainFrame };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'node:fs' && parent?.filename.endsWith('update-download.ts'))
    return {
      ...fs,
      createReadStream: (file) => {
        if (corruptStaging) fs.appendFileSync(file, 'corrupted on disk');
        return fs.createReadStream(file);
      },
    };
  if (request === 'electron' && parent?.filename.endsWith('update-ipc.ts'))
    return {
      app: { isPackaged: false, getPath: () => '.tmp' },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    };
  if (request === './main-window' && parent?.filename.endsWith('update-ipc.ts'))
    return {
      getAppLoadedUrl: () => mainFrame.url,
      getWin: () => ({ webContents: sender }),
    };
  if (request === 'node:https' && parent?.filename.endsWith('update-https.ts'))
    return {
      Agent: https.Agent,
      get: (url, options, callback) => {
        requests.push({ url: url.href, options });
        if (tlsFixture) {
          const agent = options.agent;
          const original = agent.createConnection;
          agent.createConnection = (opts) =>
            require('node:tls').connect({ ...opts, socket: tlsFixture.client });
          try {
            return https.get(url, options, callback);
          } finally {
            agent.createConnection = original;
          }
        }
        const req = new EventEmitter();
        let timeout;
        req.setTimeout = (_ms, fn) => {
          timeout = fn;
        };
        req.destroy = (error) => {
          queueMicrotask(() => req.emit('error', error));
        };
        queueMicrotask(() => {
          const route = routes.get(url.href);
          if (route?.timeout) return timeout();
          if (!route || route.error)
            return req.emit('error', new Error('offline or TLS failed'));
          const res = new PassThrough();
          res.statusCode = route.status ?? 200;
          res.headers = route.headers ?? {};
          res.complete = !route.interrupted;
          callback(res);
          setImmediate(() => {
            if (route.interrupted) {
              res.write(route.data.subarray(0, 5));
              setImmediate(() => res.destroy(new Error('interrupted')));
            } else res.end(route.data);
          });
        });
        return req;
      },
    };
  return originalLoad.call(this, request, parent, isMain);
};
const {
  UpdateDownloadService,
  validateDownloadRelease,
} = require('./update-download.ts');
const {
  readUpdateBytes,
  openUpdateResponse,
  validateUpdateUrl,
} = require('./update-https.ts');
const { initUpdateIpc } = require('./update-ipc.ts');
let root;
const service = (options = {}) =>
  new UpdateDownloadService({
    currentVersion: '1.2.0-rc.1',
    eligible: () => true,
    stagingRoot: root,
    keys,
    ...options,
  });
const setManifest = (m) => {
  const b = trust.manifestBytes(m);
  routes.set(assetUrl(trust.UPDATE_MANIFEST), { data: b });
  routes.set(assetUrl(trust.UPDATE_SIGNATURE), {
    data: sign(null, b, fixtureKey.privateKey),
  });
  const r = release();
  r.assets[1].size = b.length;
  routes.set(`${api}/tags/${tag}`, { data: Buffer.from(JSON.stringify(r)) });
};
test.beforeEach(() => {
  fs.mkdirSync(path.join(__dirname, '../.tmp'), { recursive: true });
  corruptStaging = false;
  root = fs.mkdtempSync(path.join(__dirname, '../.tmp/update-test-'));
  requests = [];
  handlers = new Map();
  tlsFixture = undefined;
  routes = new Map([
    [assetUrl(trust.UPDATE_INSTALLER), { data: artifact }],
    [assetUrl(trust.UPDATE_MANIFEST), { data: bytes }],
    [assetUrl(trust.UPDATE_SIGNATURE), { data: signature }],
    [`${api}/tags/${tag}`, { data: Buffer.from(JSON.stringify(release())) }],
    [`${api}?per_page=100&page=1`, { data: Buffer.from(JSON.stringify([release()])) }],
  ]);
});
test.afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
test.after(() => {
  Module._load = originalLoad;
});

test('real Ed25519 boundary accepts the exact manifest; no production trust root exists', () => {
  assert.deepEqual(trust.verifyUpdateManifest(bytes, signature, tag, keys), manifest);
  assert.deepEqual(trust.UPDATE_PUBLIC_KEYS, {});
  assert.throws(() => trust.verifyUpdateManifest(bytes, signature, tag));
});
test('modified bytes, invalid signatures, duplicate fields, missing and unknown keys fail', () => {
  for (const b of [
    Buffer.from(bytes.toString().replace('1.3.0', '1.4.0')),
    Buffer.from(bytes.toString().replace('{', '{"schema":1,')),
    Buffer.concat([bytes, Buffer.from(' ')]),
  ]) {
    assert.throws(() => trust.verifyUpdateManifest(b, signature, tag, keys));
  }
  assert.throws(() => trust.verifyUpdateManifest(bytes, Buffer.alloc(64), tag, keys));
  assert.throws(() =>
    trust.verifyUpdateManifest(bytes, signature.subarray(1), tag, keys),
  );
  assert.throws(() => trust.verifyUpdateManifest(bytes, signature, tag, {}));
  const other = { ...manifest, keyId: 'unknown' };
  const b = trust.manifestBytes(other);
  assert.throws(() =>
    trust.verifyUpdateManifest(b, sign(null, b, fixtureKey.privateKey), tag, keys),
  );
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() =>
    trust.verifyUpdateManifest(bytes, signature, tag, {
      fixture: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }),
  );
});
test('mismatched signed tag, version, identity, platform, architecture and artifact are refused', () => {
  assert.throws(() => trust.verifyUpdateManifest(bytes, signature, 'v1.4.0', keys));
  for (const change of [
    { version: '1.4.0' },
    { appId: 'other' },
    { arch: 'arm64' },
    { platform: 'linux' },
    { filename: '../evil.exe' },
    { package: 'portable' },
    { schema: 2 },
    { bytes: -1 },
    { bytes: trust.MAX_INSTALLER_BYTES + 1 },
    { sha256: 'x'.repeat(64) },
  ]) {
    const b = Buffer.from(JSON.stringify({ ...manifest, ...change }) + '\n');
    assert.throws(() =>
      trust.verifyUpdateManifest(b, sign(null, b, fixtureKey.privateKey), tag, keys),
    );
  }
});
test('download verifies signature, streamed bytes, persisted bytes and only publishes a ready filename', async () => {
  const s = service();
  assert.equal((await s.download(tag)).state, 'ready');
  const [directory] = fs.readdirSync(root);
  assert.deepEqual(fs.readdirSync(path.join(root, directory)), [trust.UPDATE_INSTALLER]);
  assert.deepEqual(
    fs.readFileSync(path.join(root, directory, trust.UPDATE_INSTALLER)),
    artifact,
  );
  assert.equal(requests.length, 4);
  for (const { options } of requests) {
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.agent.options.rejectUnauthorized, true);
    assert.equal(options.checkServerIdentity, require('node:tls').checkServerIdentity);
    assert.equal(options.headers.Authorization, undefined);
  }
});
for (const [label, configure] of [
  [
    'bad signature',
    () => routes.set(assetUrl(trust.UPDATE_SIGNATURE), { data: Buffer.alloc(64) }),
  ],
  ['hash mismatch', () => setManifest({ ...manifest, sha256: '0'.repeat(64) })],
  [
    'short body',
    () => routes.set(assetUrl(trust.UPDATE_INSTALLER), { data: artifact.subarray(1) }),
  ],
  [
    'oversized body',
    () =>
      routes.set(assetUrl(trust.UPDATE_INSTALLER), {
        data: Buffer.concat([artifact, artifact]),
      }),
  ],
  [
    'wrong content length',
    () =>
      routes.set(assetUrl(trust.UPDATE_INSTALLER), {
        data: artifact,
        headers: { 'content-length': '1' },
      }),
  ],
  [
    'interrupted stream',
    () =>
      routes.set(assetUrl(trust.UPDATE_INSTALLER), { data: artifact, interrupted: true }),
  ],
  ['offline', () => routes.clear()],
  [
    'release size mismatch',
    () => setManifest({ ...manifest, bytes: artifact.length + 1 }),
  ],
])
  test(`${label}: fail closed and remove incomplete staging`, async () => {
    configure();
    assert.equal((await service().download(tag)).state, 'error');
    assert.deepEqual(fs.readdirSync(root), []);
  });
test('missing key or unsupported channel makes no download request and preserves unrelated files', async () => {
  fs.writeFileSync(path.join(root, 'keep.txt'), 'keep');
  for (const options of [{ keys: {} }, { eligible: () => false }])
    assert.equal((await service(options).download(tag)).state, 'error');
  assert.equal(requests.length, 0);
  assert.deepEqual(fs.readdirSync(root), ['keep.txt']);
});
test('bad tag, downgrade, RC on stable, and arbitrary URLs cannot initiate downloads', async () => {
  for (const bad of [
    'https://evil.test',
    '../other',
    'v1.0.0',
    {},
    null,
    'v99.0.0-beta.1',
    'v1.3.0\n',
  ])
    assert.equal((await service().download(bad)).state, 'error');
  assert.equal((await service({ currentVersion: '1.2.0' }).download(tag)).state, 'error');
  assert.equal(requests.length, 0);
});
test('download release validation rejects incomplete, duplicate, mismatched and unofficial assets', () => {
  for (const edit of [
    (r) => {
      r.tag_name = 'v1.4.0';
    },
    (r) => {
      r.prerelease = false;
    },
    (r) => {
      r.draft = true;
    },
    (r) => {
      r.html_url = 'https://evil.test';
    },
    (r) => {
      r.assets.pop();
    },
    (r) => {
      r.assets.push(r.assets[0]);
    },
    (r) => {
      r.assets[0].browser_download_url = 'https://github.com/other/repo/file';
    },
    (r) => {
      r.assets[0].size = '100';
    },
    (r) => {
      r.assets[0].state = 'new';
    },
  ]) {
    const r = release();
    edit(r);
    assert.throws(() => validateDownloadRelease(r, tag));
  }
  for (const r of [null, {}, [], 'bad'])
    assert.throws(() => validateDownloadRelease(r, tag));
});
test('discovery keeps RC/stable ordering across pages and fails on malformed/offline responses', async () => {
  const first = Array.from({ length: 100 }, () => ({
    tag_name: 'v1.2.0',
    draft: false,
    prerelease: false,
  }));
  routes.set(`${api}?per_page=100&page=1`, { data: Buffer.from(JSON.stringify(first)) });
  routes.set(`${api}?per_page=100&page=2`, {
    data: Buffer.from(JSON.stringify([release()])),
  });
  assert.deepEqual(await service().discover(), { tag, canDownload: true });
  assert.equal((await service({ currentVersion: '1.1.0' }).discover()).tag, 'v1.2.0');
  for (const data of [Buffer.from('{}'), Buffer.from('invalid')]) {
    routes.set(`${api}?per_page=100&page=1`, { data });
    await assert.rejects(service().discover());
  }
  routes.clear();
  await assert.rejects(service().discover());
});
test('historical unsigned metadata, missing key and unsupported channels retain manual discovery', async () => {
  assert.deepEqual(await service({ keys: {} }).discover(), { tag, canDownload: false });
  assert.deepEqual(await service({ eligible: () => false }).discover(), {
    tag,
    canDownload: false,
  });
  const r = release();
  r.assets.pop();
  routes.set(`${api}?per_page=100&page=1`, { data: Buffer.from(JSON.stringify([r])) });
  assert.deepEqual(await service().discover(), { tag, canDownload: false });
});
test('strict redirects reject HTTP, credentials, other repositories, hosts, ports and API redirects', async () => {
  for (const location of [
    'http://github.com/hychaw/planstrand/releases/download/v1/file',
    'https://github.com/other/repo/file',
    'https://evil.test/file',
    'https://user:pass@github.com/hychaw/planstrand/releases/download/v1/file',
    'https://release-assets.githubusercontent.com:444/github-production-release-asset/file',
  ]) {
    routes.set(assetUrl(trust.UPDATE_INSTALLER), { status: 302, headers: { location } });
    await assert.rejects(
      openUpdateResponse(
        assetUrl(trust.UPDATE_INSTALLER),
        true,
        AbortSignal.timeout(1000),
      ),
    );
  }
  routes.set(api, { status: 302, headers: { location: api } });
  await assert.rejects(readUpdateBytes(api, false, 100));
  assert.throws(() =>
    validateUpdateUrl('https://api.github.com/repos/other/repo/releases', false),
  );
});
test('allowed CDN redirect keeps strict TLS and redirect loops/timeouts are bounded', async () => {
  const cdn =
    'https://release-assets.githubusercontent.com/github-production-release-asset/123/fixture?token=fixture';
  routes.set(assetUrl(trust.UPDATE_INSTALLER), {
    status: 302,
    headers: { location: cdn },
  });
  routes.set(cdn, { data: artifact });
  assert.deepEqual(
    await readUpdateBytes(assetUrl(trust.UPDATE_INSTALLER), true, 100),
    artifact,
  );
  routes.set(cdn, { status: 302, headers: { location: cdn } });
  await assert.rejects(readUpdateBytes(assetUrl(trust.UPDATE_INSTALLER), true, 100));
  routes.set(cdn, { timeout: true });
  await assert.rejects(readUpdateBytes(cdn, true, 100));
});
test('metadata bounds, compressed bodies, and non-200 responses are rejected', async () => {
  for (const route of [
    { data: Buffer.alloc(101) },
    { status: 404 },
    { data: bytes, headers: { 'content-encoding': 'gzip' } },
  ]) {
    routes.set(api, route);
    await assert.rejects(readUpdateBytes(api, false, 100));
  }
});
test('IPC restricts callers to the trusted main window and sanitizes discovery errors', async () => {
  initUpdateIpc();
  assert.deepEqual([...handlers.keys()].sort(), [
    'UPDATE_DISCOVER',
    'UPDATE_DOWNLOAD',
    'UPDATE_STATUS',
  ]);
  const check = handlers.get('UPDATE_DISCOVER');
  const status = handlers.get('UPDATE_STATUS');
  assert.throws(() => status({ sender: {}, senderFrame: mainFrame }));
  assert.throws(() => status({ sender, senderFrame: { url: mainFrame.url } }));
  assert.deepEqual(status({ sender, senderFrame: mainFrame }), { state: 'idle' });
  routes.clear();
  await assert.rejects(
    check({ sender, senderFrame: mainFrame }),
    /^Error: Update check unavailable$/,
  );
});
test('real in-memory TLS handshake rejects an untrusted certificate even with the global TLS environment opt-out', async () => {
  const tls = require('node:tls');
  const pems = await require('selfsigned').generate(
    [{ name: 'commonName', value: 'api.github.com' }],
    { keySize: 2048 },
  );
  const outbound = new PassThrough();
  const inbound = new PassThrough();
  const server = new tls.TLSSocket(
    Duplex.from({ readable: outbound, writable: inbound }),
    {
      isServer: true,
      secureContext: tls.createSecureContext({ key: pems.private, cert: pems.cert }),
    },
  );
  server.on('error', () => {});
  const client = Duplex.from({ readable: inbound, writable: outbound });
  tlsFixture = { client };
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    await assert.rejects(readUpdateBytes(api, false, 100), {
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    tlsFixture = undefined;
    server.destroy();
    client.destroy();
  }
});

test('persisted staging corruption fails verification and removes the staged file', async () => {
  corruptStaging = true;
  assert.equal((await service().download(tag)).state, 'error');
  assert.deepEqual(fs.readdirSync(root), []);
});
test('concurrent actions do not initiate a second download', async () => {
  const s = service();
  const first = s.download(tag);
  await s.download(tag);
  await first;
  assert.equal(s.status().state, 'ready');
  assert.equal(requests.length, 4);
  assert.equal(fs.readdirSync(root).length, 1);
});

test('main-owned staged recheck authenticates the retained manifest and actual file again', async () => {
  const s = service();
  await s.download(tag);
  assert.deepEqual(await s.revalidateStagedDownload(), {
    state: 'ready',
    tag,
    percent: 100,
  });
  assert.equal(requests.length, 4);
  assert.equal('path' in s.status(), false);
});

for (const mutation of ['changed', 'truncated', 'deleted', 'hardlinked']) {
  test(`staged recheck refuses ${mutation} installer bytes and preserves unrelated staging`, async () => {
    const s = service();
    await s.download(tag);
    const directory = path.join(root, fs.readdirSync(root)[0]);
    const installer = path.join(directory, trust.UPDATE_INSTALLER);
    fs.writeFileSync(path.join(root, 'previous-recovery-point'), 'keep');
    if (mutation === 'changed')
      fs.writeFileSync(installer, Buffer.alloc(artifact.length));
    if (mutation === 'truncated') fs.truncateSync(installer, 1);
    if (mutation === 'deleted') fs.unlinkSync(installer);
    if (mutation === 'hardlinked')
      fs.linkSync(installer, path.join(directory, 'other.exe'));
    assert.equal((await s.revalidateStagedDownload()).state, 'error');
    assert.equal(
      fs.readFileSync(path.join(root, 'previous-recovery-point'), 'utf8'),
      'keep',
    );
    assert.equal((await s.revalidateStagedDownload()).state, 'error');
  });
}

test('staged recheck refuses lost registration and never treats idle or failed transfers as ready', async () => {
  let eligible = true;
  const s = service({ eligible: async () => eligible });
  await s.download(tag);
  eligible = false;
  assert.equal((await s.revalidateStagedDownload()).state, 'error');
  assert.equal((await service().revalidateStagedDownload()).state, 'error');
});

test('asynchronous eligibility rejection prevents network and staging work', async () => {
  assert.equal(
    (await service({ eligible: async () => false }).download(tag)).state,
    'error',
  );
  assert.equal(
    (
      await service({
        eligible: async () => {
          throw new Error('probe unavailable');
        },
      }).download(tag)
    ).state,
    'error',
  );
  assert.equal(requests.length, 0);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('a concurrent staged recheck reports verifying until the eligibility probe completes', async () => {
  let probe = async () => true;
  const s = service({ eligible: () => probe() });
  await s.download(tag);
  let releaseProbe;
  probe = () =>
    new Promise((resolve) => {
      releaseProbe = resolve;
    });
  const first = s.revalidateStagedDownload();
  assert.equal((await s.revalidateStagedDownload()).state, 'verifying');
  assert.equal(s.status().state, 'verifying');
  releaseProbe(true);
  assert.equal((await first).state, 'ready');
});

test('staged recheck does not accept a modified retained signature', async () => {
  const s = service();
  await s.download(tag);
  // Test-only fault injection into main memory, never an IPC capability.
  s._authentication.signature[0] ^= 1;
  assert.equal((await s.revalidateStagedDownload()).state, 'error');
});
test('discovery refuses a truncated list when the finite pagination budget is exhausted', async () => {
  const data = Buffer.from(JSON.stringify(Array.from({ length: 100 }, () => release())));
  for (let page = 1; page <= 20; page++)
    routes.set(`${api}?per_page=100&page=${page}`, { data });
  await assert.rejects(service().discover(), /pagination limit/);
  assert.equal(requests.length, 20);
});
