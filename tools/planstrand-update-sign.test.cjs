const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync, createHash } = require('node:crypto');
const { signUpdate, verifyUpdate } = require('./planstrand-update-sign.cjs');
const { verifyUpdateManifest } = require('../electron/update-trust.ts');
let root;
let keyFile;
let publicFile;
const artifact = Buffer.from('Harmless signing-tool test fixture');
test.beforeEach(() => {
  fs.mkdirSync(path.join(__dirname, '../.tmp'), { recursive: true });
  root = fs.mkdtempSync(path.join(__dirname, '../.tmp/sign-test-'));
  const keys = generateKeyPairSync('ed25519');
  keyFile = path.join(root, 'fixture-private.pem');
  publicFile = path.join(root, 'fixture-public.pem');
  fs.writeFileSync(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(publicFile, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(path.join(root, 'Planstrand-Setup.exe'), artifact);
  fs.writeFileSync(
    path.join(root, 'release-manifest.json'),
    JSON.stringify({
      version: '1.3.0-rc.1',
      tag: 'v1.3.0-rc.1',
      platform: 'windows-x64',
      assets: [
        {
          name: 'Planstrand-Setup.exe',
          bytes: artifact.length,
          sha256: createHash('sha256').update(artifact).digest('hex'),
        },
      ],
    }),
  );
});
test.afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
test('local signing tool produces metadata accepted by the real application verifier', async () => {
  await signUpdate(root, 'fixture', keyFile);
  await verifyUpdate(root, publicFile);
  const bytes = fs.readFileSync(path.join(root, 'planstrand-update.json'));
  const sig = fs.readFileSync(path.join(root, 'planstrand-update.sig'));
  assert.equal(
    verifyUpdateManifest(bytes, sig, 'v1.3.0-rc.1', {
      fixture: fs.readFileSync(publicFile, 'utf8'),
    }).bytes,
    artifact.length,
  );
  await assert.rejects(signUpdate(root, 'fixture', keyFile), { code: 'EEXIST' });
  assert.deepEqual(fs.readFileSync(path.join(root, 'planstrand-update.json')), bytes);
  assert.deepEqual(fs.readFileSync(path.join(root, 'planstrand-update.sig')), sig);
});
test('signing refuses installer bytes that differ from the existing release provenance', async () => {
  fs.appendFileSync(path.join(root, 'Planstrand-Setup.exe'), 'changed');
  await assert.rejects(signUpdate(root, 'fixture', keyFile), /Provenance mismatch/);
  assert.equal(fs.existsSync(path.join(root, 'planstrand-update.json')), false);
});
test('existing detached signature is preserved and reserved manifest is removed on failure', async () => {
  fs.writeFileSync(path.join(root, 'planstrand-update.sig'), 'existing');
  await assert.rejects(signUpdate(root, 'fixture', keyFile), { code: 'EEXIST' });
  assert.equal(fs.existsSync(path.join(root, 'planstrand-update.json')), false);
  assert.equal(
    fs.readFileSync(path.join(root, 'planstrand-update.sig'), 'utf8'),
    'existing',
  );
});
test('verification refuses modified artifacts or a different public key', async () => {
  await signUpdate(root, 'fixture', keyFile);
  const other = generateKeyPairSync('ed25519');
  const otherFile = path.join(root, 'other-public.pem');
  fs.writeFileSync(otherFile, other.publicKey.export({ type: 'spki', format: 'pem' }));
  await assert.rejects(verifyUpdate(root, otherFile), /Invalid update signature/);
  fs.appendFileSync(path.join(root, 'Planstrand-Setup.exe'), 'changed');
  await assert.rejects(verifyUpdate(root, publicFile), /Artifact mismatch/);
});

test('verification binds the authenticated tag to the candidate provenance', async () => {
  await signUpdate(root, 'fixture', keyFile);
  const file = path.join(root, 'release-manifest.json');
  const provenance = JSON.parse(fs.readFileSync(file, 'utf8'));
  provenance.tag = 'v1.4.0-rc.1';
  fs.writeFileSync(file, JSON.stringify(provenance));
  await assert.rejects(verifyUpdate(root, publicFile), /identity mismatch/);
});
