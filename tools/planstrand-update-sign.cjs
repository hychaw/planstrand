// Local/offline only. Uses the same manifest encoder/verifier as the application.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, createPrivateKey, createPublicKey, sign } = require('node:crypto');
require('ts-node').register({
  transpileOnly: true,
  preferTsExts: true,
  project: path.join(__dirname, '../electron/tsconfig.electron.json'),
});
const {
  manifestBytes,
  verifyUpdateManifest,
  UPDATE_APP_ID,
  UPDATE_INSTALLER,
  UPDATE_MANIFEST,
  UPDATE_SIGNATURE,
} = require('../electron/update-trust.ts');

async function hashFile(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function signUpdate(directory, keyId, privateKeyFile) {
  const provenance = JSON.parse(
    fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'),
  );
  const artifact = await hashFile(path.join(directory, UPDATE_INSTALLER));
  const recorded = provenance.assets?.find((a) => a.name === UPDATE_INSTALLER);
  if (
    !recorded ||
    recorded.bytes !== artifact.bytes ||
    recorded.sha256 !== artifact.sha256 ||
    provenance.platform !== 'windows-x64'
  )
    throw new Error('Provenance mismatch');
  const key = createPrivateKey(fs.readFileSync(privateKeyFile));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 key required');
  const bytes = manifestBytes({
    schema: 1,
    keyId,
    appId: UPDATE_APP_ID,
    version: provenance.version,
    tag: provenance.tag,
    platform: 'win32',
    arch: 'x64',
    package: 'nsis',
    filename: UPDATE_INSTALLER,
    ...artifact,
  });
  const signature = sign(null, bytes, key);
  verifyUpdateManifest(bytes, signature, provenance.tag, {
    [keyId]: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(),
  });
  // Never overwrite candidate metadata. Reserve both files before writing either.
  const manifestPath = path.join(directory, UPDATE_MANIFEST);
  const signaturePath = path.join(directory, UPDATE_SIGNATURE);
  const manifestFd = fs.openSync(manifestPath, 'wx', 0o600);
  let signatureFd;
  let failed = false;
  try {
    signatureFd = fs.openSync(signaturePath, 'wx', 0o600);
    fs.writeFileSync(manifestFd, bytes);
    fs.writeFileSync(signatureFd, signature);
    fs.fsyncSync(manifestFd);
    fs.fsyncSync(signatureFd);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    fs.closeSync(manifestFd);
    if (signatureFd !== undefined) fs.closeSync(signatureFd);
    if (failed) {
      if (signatureFd !== undefined) fs.unlinkSync(signaturePath);
      fs.unlinkSync(manifestPath);
    }
  }
}

async function verifyUpdate(directory, publicKeyFile) {
  const provenance = JSON.parse(
    fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'),
  );
  const bytes = fs.readFileSync(path.join(directory, UPDATE_MANIFEST));
  const signature = fs.readFileSync(path.join(directory, UPDATE_SIGNATURE));
  const { keyId } = JSON.parse(bytes.toString('utf8'));
  const m = verifyUpdateManifest(bytes, signature, provenance.tag, {
    [keyId]: fs.readFileSync(publicKeyFile, 'utf8'),
  });
  const actual = await hashFile(path.join(directory, UPDATE_INSTALLER));
  const recorded = provenance.assets?.find((a) => a.name === UPDATE_INSTALLER);
  if (
    provenance.version !== m.version ||
    provenance.platform !== 'windows-x64' ||
    recorded?.bytes !== m.bytes ||
    recorded?.sha256 !== m.sha256 ||
    actual.bytes !== m.bytes ||
    actual.sha256 !== m.sha256
  )
    throw new Error('Artifact mismatch');
}

module.exports = { signUpdate, verifyUpdate };
if (require.main === module) {
  const [command, directory, ...args] = process.argv.slice(2);
  Promise.resolve()
    .then(() => {
      if (command === 'sign' && args.length === 2)
        return signUpdate(directory, args[0], args[1]);
      if (command === 'verify' && args.length === 1)
        return verifyUpdate(directory, args[0]);
      throw new Error(
        'Usage: sign <candidate-dir> <key-id> <private-key-file> | verify <candidate-dir> <public-key-file>',
      );
    })
    .then(() => console.log('Update contract verified.'))
    .catch(() => {
      // No filesystem paths, private key/parser errors, or secret material.
      console.error(
        'Update signing/verification failed; check candidate metadata and key files.',
      );
      process.exitCode = 1;
    });
}
