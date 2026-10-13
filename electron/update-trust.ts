import { createPublicKey, verify } from 'node:crypto';
import { compareReleaseVersions } from './shared-with-frontend/planstrand-release';

export const UPDATE_APP_ID = 'io.github.hychaw.planstrand';
export const UPDATE_MANIFEST = 'planstrand-update.json';
export const UPDATE_SIGNATURE = 'planstrand-update.sig';
export const UPDATE_INSTALLER = 'Planstrand-Setup.exe';
export const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

// Deliberately empty. Embed a reviewed, owner-authorized Ed25519 SPKI PEM here
// before production downloads can be enabled. Never load keys from the network,
// renderer, or runtime environment. Private keys never belong in this application.
export const UPDATE_PUBLIC_KEYS: Readonly<Record<string, string>> = Object.freeze({});

export interface UpdateManifest {
  schema: 1;
  keyId: string;
  appId: string;
  version: string;
  tag: string;
  platform: 'win32';
  arch: 'x64';
  package: 'nsis';
  filename: string;
  bytes: number;
  sha256: string;
}

/** Exact UTF-8 JSON fields/order, no BOM/whitespace except one final LF.
 * This also rejects duplicate/unknown fields and ambiguous JSON.
 * Detached signature: raw 64-byte Ed25519 signature over exactly these bytes.
 */
export const manifestBytes = (m: UpdateManifest): Buffer => {
  if (
    m.schema !== 1 ||
    typeof m.keyId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(m.keyId) ||
    m.appId !== UPDATE_APP_ID ||
    typeof m.version !== 'string' ||
    m.tag !== `v${m.version}` ||
    m.platform !== 'win32' ||
    m.arch !== 'x64' ||
    m.package !== 'nsis' ||
    m.filename !== UPDATE_INSTALLER ||
    !Number.isSafeInteger(m.bytes) ||
    m.bytes <= 0 ||
    m.bytes > MAX_INSTALLER_BYTES ||
    typeof m.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(m.sha256)
  )
    throw new Error('Invalid update manifest');
  compareReleaseVersions(m.tag, m.tag);
  return Buffer.from(
    JSON.stringify({
      schema: m.schema,
      keyId: m.keyId,
      appId: m.appId,
      version: m.version,
      tag: m.tag,
      platform: m.platform,
      arch: m.arch,
      package: m.package,
      filename: m.filename,
      bytes: m.bytes,
      sha256: m.sha256,
    }) + '\n',
    'utf8',
  );
};

export const verifyUpdateManifest = (
  bytes: Buffer,
  signature: Buffer,
  tag: string,
  keys: Readonly<Record<string, string>> = UPDATE_PUBLIC_KEYS,
): UpdateManifest => {
  if (bytes.length > 4096 || signature.length !== 64)
    throw new Error('Invalid update signature');
  const m = JSON.parse(bytes.toString('utf8')) as UpdateManifest;
  if (!m || !bytes.equals(manifestBytes(m)) || m.tag !== tag)
    throw new Error('Update identity mismatch');
  if (!Object.prototype.hasOwnProperty.call(keys, m.keyId))
    throw new Error('Unknown update signing key');
  const key = createPublicKey(keys[m.keyId]);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, bytes, key, signature)) {
    throw new Error('Invalid update signature');
  }
  return m;
};
