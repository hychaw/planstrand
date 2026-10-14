const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const https = require('node:https');
const tls = require('node:tls');
const { Duplex } = require('node:stream');
const ts = require('typescript');

require('ts-node').register({
  transpileOnly: true,
  preferTsExts: true,
  project: path.join(__dirname, 'tsconfig.electron.json'),
});

const root = path.resolve(__dirname, '..');
const productionSources = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(file);
    return entry.name.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(entry.name)
      ? [file]
      : [];
  });

// Static policy checks, not a Chromium handshake. Scan the Electron and renderer
// transport sources so moving the old override to another module also fails.
test('production Electron and renderer transports have no global TLS override', () => {
  const violations = [];
  const files = ['electron', 'src/app', 'packages/sync-providers/src'].flatMap(
    (directory) => productionSources(path.join(root, directory)),
  );
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      const token =
        ts.isStringLiteralLike(node) || ts.isIdentifier(node) ? node.text : '';
      if (
        /^(certificate-error|setCertificateVerifyProc|NODE_TLS_REJECT_UNAUTHORIZED)$/.test(
          token,
        ) ||
        /^(?:--)?(?:ignore-certificate-errors(?:-spki-list)?|allow-insecure-localhost|disable-web-security)$/.test(
          token,
        ) ||
        (ts.isPropertyAssignment(node) &&
          node.name.getText(source) === 'rejectUnauthorized' &&
          node.initializer.kind === ts.SyntaxKind.FalseKeyword &&
          file !== path.join(root, 'electron/proxy-agent.ts'))
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${path.relative(root, file)}:${line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(
    violations,
    [],
    'Keep default certificate rejection; no global hooks or bypass flags.',
  );
});

test('authenticated SuperSync retains the renderer fetch transport', () => {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(
    read('src/app/op-log/sync-providers/platform/app-web-fetch.ts'),
    /\?\? fetch;/,
  );
  assert.match(
    read('src/app/op-log/sync-providers/super-sync/super-sync.ts'),
    /webFetch: APP_WEB_FETCH/,
  );
  const provider = read('packages/sync-providers/src/super-sync/super-sync.ts');
  assert.match(
    provider,
    /headers\.set\('Authorization', `Bearer \$\{sanitizedToken\}`\)/,
  );
  assert.match(provider, /const fetchFn = this\._deps\.webFetch\(\)/);
});

const originalLoad = Module._load;
let createProxyAwareAgent;
try {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron-log/main') return { log: () => {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ createProxyAwareAgent } = require(path.join(__dirname, 'proxy-agent.ts')));
} finally {
  Module._load = originalLoad;
}

let fixture;
const proxyVariables = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
];
const previousProxyEnv = Object.fromEntries(
  proxyVariables.map((key) => [key, process.env[key]]),
);
test.before(async () => {
  for (const key of proxyVariables) delete process.env[key];
  fixture = await require('selfsigned').generate(
    [{ name: 'commonName', value: 'valid.test' }],
    {
      keySize: 2048,
      extensions: [
        { name: 'subjectAltName', altNames: [{ type: 2, value: 'valid.test' }] },
      ],
    },
  );
});
test.after(() => {
  for (const key of proxyVariables) {
    if (previousProxyEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousProxyEnv[key];
  }
});

// Real Node TLS handshakes over in-memory streams: no listening port, HTTP
// request, credentials, profile, or disk certificate. These exercise the existing
// Node agent policy; Electron's unchanged default is guarded statically above.
const handshake = async (agent, { trusted = false, hostname = 'valid.test' } = {}) => {
  // Separate endpoints avoid Duplex.from's abort propagation replacing the
  // original certificate error when TLS destroys a rejected connection.
  const serverSocket = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      socket.push(Buffer.from(chunk));
      callback();
    },
  });
  const socket = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      serverSocket.push(Buffer.from(chunk));
      callback();
    },
  });
  const server = new tls.TLSSocket(serverSocket, {
    isServer: true,
    secureContext: tls.createSecureContext({
      key: fixture.private,
      cert: fixture.cert,
    }),
  });
  server.on('error', () => {});
  const client = (agent ?? https.globalAgent).createConnection({
    socket,
    servername: hostname,
    ...(trusted ? { ca: fixture.cert } : {}),
    ...(agent ? agent.options : {}),
  });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('TLS fixture timeout')), 5000);
      client.once('error', reject);
      client.once('secureConnect', () => resolve(client.authorized));
    });
  } finally {
    clearTimeout(timer);
    client.destroy();
    socket.destroy();
    server.destroy();
  }
};

test('default Node integration rejects an untrusted certificate', async () => {
  const agent = createProxyAwareAgent('https://valid.test');
  assert.equal(agent, undefined);
  await assert.rejects(handshake(agent), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
});

test('valid trusted certificate and matching hostname retain normal HTTPS authorization', async () => {
  assert.equal(
    await handshake(createProxyAwareAgent('https://valid.test'), { trusted: true }),
    true,
  );
});

test('trusting a certificate does not disable hostname verification', async () => {
  await assert.rejects(
    handshake(createProxyAwareAgent('https://wrong.test'), {
      trusted: true,
      hostname: 'wrong.test',
    }),
    { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
  );
});

test('explicit Node self-signed opt-in does not change another connection or the global agent', async () => {
  const globalOptions = { ...https.globalAgent.options };
  const agent = createProxyAwareAgent('https://valid.test', true);
  try {
    assert.equal(agent.options.rejectUnauthorized, false);
    assert.equal(await handshake(agent), false);
    assert.deepEqual({ ...https.globalAgent.options }, globalOptions);
    await assert.rejects(handshake(createProxyAwareAgent('https://valid.test')), {
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
  } finally {
    agent.destroy();
  }
});
