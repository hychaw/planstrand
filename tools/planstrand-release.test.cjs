const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  validateIdentity,
  requireNewRelease,
  verifyArtifacts,
  verifyPackage,
} = require('./planstrand-release.cjs');
const valid = {
  version: '1.1.0-rc.1',
  tag: 'v1.1.0-rc.1',
  revision: '1'.repeat(40),
  requestedRef: '1'.repeat(40),
  tagRevision: '1'.repeat(40),
};

test('packaged licenses must preserve both copyrights and the complete notices', async (t) => {
  const asar = require('@electron/asar');
  const root = path.join(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planstrand-licenses-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const archive = path.join(directory, 'win-unpacked/resources/app.asar');
  const base = '.tmp/angular-dist/browser/';
  const write = (file, content) => {
    const target = path.join(source, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const read = (file) => fs.readFileSync(path.join(root, file));
  write(
    'package.json',
    JSON.stringify({
      name: 'planstrand',
      productName: 'Planstrand',
      version: valid.version,
    }),
  );
  write('LICENSE', read('LICENSE'));
  write(
    'LICENSES/SUPER_PRODUCTIVITY_MIT.txt',
    read('LICENSES/SUPER_PRODUCTIVITY_MIT.txt'),
  );
  write(base + 'assets/planstrand-license/LICENSE', read('LICENSE'));
  write(
    base + 'assets/upstream-license.txt',
    read('LICENSES/SUPER_PRODUCTIVITY_MIT.txt'),
  );
  write(base + 'assets/fonts/inter/LICENSE', read('src/assets/fonts/inter/LICENSE'));
  write(base + '3rdpartylicenses.txt', 'Copyright dependency notice fixture');
  write(base + 'main.js', JSON.stringify(valid.revision));
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  const pack = async () => {
    asar.uncacheAll();
    await asar.createPackage(source, archive);
  };
  await pack();
  assert.doesNotThrow(() => verifyPackage(directory, valid));
  for (const file of [
    'LICENSE',
    'LICENSES/SUPER_PRODUCTIVITY_MIT.txt',
    base + 'assets/planstrand-license/LICENSE',
    base + 'assets/upstream-license.txt',
  ]) {
    const original = fs.readFileSync(path.join(source, file));
    write(file, original.toString().split('Permission')[0]);
    await pack();
    assert.throws(
      () => verifyPackage(directory, valid),
      undefined,
      `Must reject truncated ${file}`,
    );
    fs.unlinkSync(path.join(source, file));
    await pack();
    assert.throws(
      () => verifyPackage(directory, valid),
      undefined,
      `Must reject missing ${file}`,
    );
    write(file, original);
  }
  await pack();
  assert.doesNotThrow(() => verifyPackage(directory, valid));
});
test('valid RC identity derives versioned artifacts and notes', () => {
  assert.deepEqual(validateIdentity(valid), {
    version: valid.version,
    tag: valid.tag,
    revision: valid.revision,
    artifactName: 'Planstrand-v1.1.0-rc.1-windows-x64',
    notes: 'docs/releases/v1.1.0-rc.1.md',
  });
});
test('rejects V1, stable versions, mismatched tags, moving refs and wrong tag targets', () => {
  for (const override of [
    { tag: 'v1.0.0-rc.1' },
    { version: '1.1.0' },
    { tag: 'v1.1.0-rc.2' },
    { requestedRef: 'development' },
    { revision: '2'.repeat(40) },
    { tagRevision: '2'.repeat(40) },
    { version: '1.1.0-rc.0' },
    { tag: 'v1.1.0-rc.1\nnotes=unexpected' },
  ])
    assert.throws(() => validateIdentity({ ...valid, ...override }));
});
test('existing release and lookup failures fail closed; only a confirmed 404 allows creation', async () => {
  const previous = {
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
  };
  process.env.GITHUB_REPOSITORY = 'hychaw/planstrand';
  process.env.GH_TOKEN = 'test-token';
  try {
    for (const status of [200, 401, 403, 429, 500])
      await assert.rejects(requireNewRelease(valid.tag, async () => ({ status })));
    await assert.rejects(
      requireNewRelease(valid.tag, async () => {
        throw new Error('offline');
      }),
    );
    await requireNewRelease(valid.tag, async (url) => {
      assert.equal(
        url,
        'https://api.github.com/repos/hychaw/planstrand/releases/tags/v1.1.0-rc.1',
      );
      return { status: 404 };
    });
  } finally {
    for (const [key, value] of [
      ['GITHUB_REPOSITORY', previous.repository],
      ['GH_TOKEN', previous.token],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test('downloaded artifacts reject changed bytes, provenance, product version and packaging configuration', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planstrand-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const identity = validateIdentity(valid);
  const names = ['Planstrand-Setup.exe', 'Planstrand-Portable.exe'];
  const manifest = {
    ...identity,
    packagingConfiguration: Object.fromEntries(
      [
        'electron-builder.yaml',
        'tools/planstrand-product-build.cjs',
        'build/planstrand-installer.nsh',
      ].map((file) => [
        file,
        hash(
          fs
            .readFileSync(path.join(__dirname, '..', file), 'utf8')
            .replaceAll('\r\n', '\n'),
        ),
      ]),
    ),
    assets: names.map((name) => {
      const content = Buffer.from(name);
      fs.writeFileSync(path.join(directory, name), content);
      return { name, bytes: content.length, sha256: hash(content) };
    }),
  };
  const writeManifest = () =>
    fs.writeFileSync(
      path.join(directory, 'release-manifest.json'),
      JSON.stringify(manifest),
    );
  writeManifest();
  fs.writeFileSync(path.join(directory, 'SOURCE_SHA.txt'), identity.revision + '\n');
  fs.writeFileSync(
    path.join(directory, 'SHA256SUMS.txt'),
    manifest.assets.map((asset) => `${asset.sha256}  ${asset.name}\n`).join(''),
  );
  assert.doesNotThrow(() => verifyArtifacts(directory, identity));
  fs.writeFileSync(path.join(directory, names[0]), 'tampered');
  assert.throws(() => verifyArtifacts(directory, identity), /size mismatch/);
  fs.writeFileSync(path.join(directory, names[0]), names[0]);
  fs.writeFileSync(path.join(directory, names[0]), names[0].replace('Setup', 'Other'));
  assert.throws(() => verifyArtifacts(directory, identity), /checksum mismatch/);
  fs.writeFileSync(path.join(directory, names[0]), names[0]);
  fs.writeFileSync(path.join(directory, 'SOURCE_SHA.txt'), '2'.repeat(40));
  assert.throws(() => verifyArtifacts(directory, identity));
  fs.writeFileSync(path.join(directory, 'SOURCE_SHA.txt'), identity.revision);
  manifest.version = '19.1.0';
  writeManifest();
  assert.throws(() => verifyArtifacts(directory, identity), /version mismatch/);
  manifest.version = identity.version;
  manifest.packagingConfiguration['electron-builder.yaml'] = 'unexpected';
  writeManifest();
  assert.throws(() => verifyArtifacts(directory, identity));
});
