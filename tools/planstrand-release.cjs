const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = ['Planstrand-Setup.exe', 'Planstrand-Portable.exe'];
const CONFIG_FILES = [
  'electron-builder.yaml',
  'tools/planstrand-product-build.cjs',
  'build/planstrand-installer.nsh',
];
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const read = (file) => fs.readFileSync(path.join(ROOT, file));
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function validateIdentity({ version, tag, revision, requestedRef, tagRevision }) {
  assert.match(version, /^\d+\.\d+\.\d+-rc\.[1-9]\d*$/, 'RC product version required');
  assert.notEqual(tag, 'v1.0.0-rc.1', 'The existing V1 release is protected');
  assert.equal(tag, `v${version}`, 'Tag must match planstrand-product.json');
  assert.match(
    requestedRef,
    /^[a-f0-9]{40}$/,
    'An exact reviewed commit SHA is required',
  );
  assert.equal(revision, requestedRef, 'Checkout differs from the reviewed commit');
  assert.equal(
    tagRevision,
    revision,
    'Existing release tag must target the reviewed commit',
  );
  return {
    version,
    tag,
    revision,
    artifactName: `Planstrand-${tag}-windows-x64`,
    notes: `docs/releases/${tag}.md`,
  };
}

function checkoutIdentity(requireTag = false) {
  const { version } = JSON.parse(read('planstrand-product.json'));
  const revision = git('rev-parse', 'HEAD');
  const tag = process.env.RELEASE_TAG;
  const identity = validateIdentity({
    version,
    tag,
    revision,
    requestedRef: process.env.RELEASE_REF,
    // Local packaging must work before approval to create a tag. The release
    // workflow always calls verify-ref, which requires that tag to exist.
    tagRevision: requireTag
      ? git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
      : revision,
  });
  assert.ok(fs.existsSync(path.join(ROOT, identity.notes)), 'Release notes missing');
  return identity;
}

async function requireNewRelease(tag, fetchRelease = fetch) {
  assert.equal(process.env.GITHUB_REPOSITORY, 'hychaw/planstrand');
  assert.ok(process.env.GH_TOKEN, 'Read token required to check existing releases');
  const response = await fetchRelease(
    `https://api.github.com/repos/hychaw/planstrand/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  assert.equal(
    response.status,
    404,
    'Release already exists or lookup failed; refusing publication',
  );
}

function packagingConfiguration() {
  return Object.fromEntries(
    CONFIG_FILES.map((file) => [
      file,
      sha256(read(file).toString('utf8').replaceAll('\r\n', '\n')),
    ]),
  );
}

function verifyPackage(directory, identity) {
  const asar = require('@electron/asar');
  const archive = path.join(directory, 'win-unpacked/resources/app.asar');
  const extract = (file) => asar.extractFile(archive, path.normalize(file));
  const pkg = JSON.parse(extract('package.json').toString());
  assert.equal(pkg.name, 'planstrand');
  assert.equal(pkg.productName, 'Planstrand');
  assert.equal(pkg.version, identity.version);
  assert.deepEqual(extract('LICENSE'), read('LICENSE'));
  const base = '.tmp/angular-dist/browser/';
  assert.match(
    extract(base + 'assets/upstream-license.txt').toString(),
    /2018 Johannes Millan/,
  );
  assert.match(extract(base + '3rdpartylicenses.txt').toString(), /Copyright/);
  assert.match(
    extract(base + 'assets/fonts/inter/LICENSE').toString(),
    /SIL OPEN FONT LICENSE/,
  );
  const scripts = asar
    .listPackage(archive)
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.startsWith('/' + base) && file.endsWith('.js'));
  assert.ok(
    scripts.some((file) =>
      extract(file.slice(1)).includes(Buffer.from(identity.revision)),
    ),
    'Packaged frontend revision does not match the release commit',
  );
}

function recordArtifacts(directory, identity) {
  verifyPackage(directory, identity);
  const manifest = {
    ...identity,
    platform: 'windows-x64',
    signed: false,
    packagingConfiguration: packagingConfiguration(),
    assets: ASSETS.map((name) => {
      const file = path.join(directory, name);
      return {
        name,
        bytes: fs.statSync(file).size,
        sha256: sha256(fs.readFileSync(file)),
      };
    }),
  };
  fs.writeFileSync(
    path.join(directory, 'release-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(directory, 'SOURCE_SHA.txt'), identity.revision + '\n');
  fs.writeFileSync(
    path.join(directory, 'SHA256SUMS.txt'),
    manifest.assets.map((asset) => `${asset.sha256}  ${asset.name}\n`).join(''),
  );
  return manifest;
}

function verifyArtifacts(directory, identity) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'),
  );
  for (const key of ['version', 'tag', 'revision', 'artifactName', 'notes'])
    assert.equal(manifest[key], identity[key], `Artifact ${key} mismatch`);
  assert.deepEqual(manifest.packagingConfiguration, packagingConfiguration());
  assert.deepEqual(
    manifest.assets.map((asset) => asset.name),
    ASSETS,
  );
  for (const asset of manifest.assets) {
    const file = fs.readFileSync(path.join(directory, asset.name));
    assert.equal(file.length, asset.bytes, `${asset.name} size mismatch`);
    assert.equal(sha256(file), asset.sha256, `${asset.name} checksum mismatch`);
  }
  assert.equal(
    fs.readFileSync(path.join(directory, 'SOURCE_SHA.txt'), 'utf8').trim(),
    identity.revision,
  );
  assert.equal(
    fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8'),
    manifest.assets.map((asset) => `${asset.sha256}  ${asset.name}\n`).join(''),
  );
  return manifest;
}

async function main() {
  const command = process.argv[2];
  assert.ok(
    ['verify-ref', 'record-artifacts', 'verify-artifacts'].includes(command),
    'Unknown command',
  );
  const identity = checkoutIdentity(command === 'verify-ref');
  if (command === 'verify-ref') {
    await requireNewRelease(identity.tag);
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(identity)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(''),
      );
  } else {
    const directory = path.resolve(process.argv[3]);
    if (command === 'record-artifacts') recordArtifacts(directory, identity);
    verifyArtifacts(directory, identity);
  }
  console.log(
    `Verified Planstrand ${identity.version} at ${identity.revision}: ${command}`,
  );
}

module.exports = {
  validateIdentity,
  requireNewRelease,
  verifyArtifacts,
  recordArtifacts,
};
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
