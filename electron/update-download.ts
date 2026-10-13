import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { newestPlanstrandRelease } from './shared-with-frontend/planstrand-release';
import {
  UpdateDiscovery,
  UpdateDownloadStatus,
} from './shared-with-frontend/update.model';
import {
  MAX_INSTALLER_BYTES,
  UPDATE_INSTALLER,
  UPDATE_MANIFEST,
  UPDATE_PUBLIC_KEYS,
  UPDATE_SIGNATURE,
  verifyUpdateManifest,
} from './update-trust';
import { openUpdateResponse, readUpdateBytes } from './update-https';

const API = 'https://api.github.com/repos/hychaw/planstrand/releases';
const assetUrl = (tag: string, name: string): string =>
  `https://github.com/hychaw/planstrand/releases/download/${tag}/${name}`;

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

/** A GitHub response is discovery data, never a publisher trust root. */
export const validateDownloadRelease = (value: unknown, tag: string): Release => {
  const r = value as Record<string, unknown> | null;
  if (
    !r ||
    r.tag_name !== tag ||
    r.draft !== false ||
    r.prerelease !== tag.includes('-rc.') ||
    r.html_url !== `https://github.com/hychaw/planstrand/releases/tag/${tag}` ||
    !Array.isArray(r.assets) ||
    r.assets.length > 100
  )
    throw new Error('Invalid release');
  for (const name of [UPDATE_INSTALLER, UPDATE_MANIFEST, UPDATE_SIGNATURE]) {
    const matches = r.assets.filter((a) => a?.name === name);
    const a = matches[0];
    const max =
      name === UPDATE_INSTALLER
        ? MAX_INSTALLER_BYTES
        : name === UPDATE_MANIFEST
          ? 4096
          : 64;
    if (
      matches.length !== 1 ||
      a.state !== 'uploaded' ||
      !Number.isSafeInteger(a.size) ||
      a.size <= 0 ||
      a.size > max ||
      (name === UPDATE_SIGNATURE && a.size !== 64) ||
      a.browser_download_url !== assetUrl(tag, name)
    )
      throw new Error('Invalid release assets');
  }
  return r as unknown as Release;
};

export interface UpdateDownloadOptions {
  currentVersion: string;
  eligible: () => boolean | Promise<boolean>;
  stagingRoot: string;
  keys?: Readonly<Record<string, string>>;
}

export class UpdateDownloadService {
  private _status: UpdateDownloadStatus = { state: 'idle' };
  private _busy = false;
  // Internal only: no arbitrary paths/URLs or signing keys accepted over IPC.
  private _stagedPath?: string;
  private _authentication?: { bytes: Buffer; signature: Buffer; tag: string };
  private readonly _keys: Readonly<Record<string, string>>;

  constructor(private readonly _options: UpdateDownloadOptions) {
    this._keys = Object.freeze({ ...(_options.keys ?? UPDATE_PUBLIC_KEYS) });
  }

  status(): UpdateDownloadStatus {
    return { ...this._status };
  }

  async discover(): Promise<UpdateDiscovery> {
    const releases: unknown[] = [];
    // Finite pagination and per-response byte/time limits; never choose from a
    // truncated list. Preserve Phase 1's version ordering and channel policy.
    for (let page = 1; page <= 20; page++) {
      const batch: unknown = JSON.parse(
        (
          await readUpdateBytes(
            `${API}?per_page=100&page=${page}`,
            false,
            2 * 1024 * 1024,
          )
        ).toString('utf8'),
      );
      if (!Array.isArray(batch) || batch.length > 100)
        throw new Error('Invalid release list');
      releases.push(...batch);
      if (batch.length === 100) continue;
      const tag = newestPlanstrandRelease(releases, this._options.currentVersion);
      let canDownload = false;
      if (tag && Object.keys(this._keys).length && (await this._options.eligible())) {
        try {
          validateDownloadRelease(
            releases.find((r) => (r as Release)?.tag_name === tag),
            tag,
          );
          canDownload = true;
        } catch {
          /* Unsigned historical releases retain manual-page fallback. */
        }
      }
      return { tag, canDownload };
    }
    throw new Error('Release pagination limit exceeded');
  }

  /** Explicit UI action only. Re-resolve from the fixed official endpoint and
   * authenticate before opening the installer URL or creating staging files.
   */
  async download(tag: unknown): Promise<UpdateDownloadStatus> {
    if (this._busy) return this.status();
    this._busy = true;
    let directory: string | undefined;
    try {
      if (
        !Object.keys(this._keys).length ||
        !(await this._options.eligible()) ||
        typeof tag !== 'string' ||
        tag.length > 80 ||
        !tag.startsWith('v') ||
        newestPlanstrandRelease(
          [{ tag_name: tag, draft: false, prerelease: tag.includes('-rc.') }],
          this._options.currentVersion,
        ) !== tag
      ) {
        throw new Error('Update download unavailable');
      }
      this._status = { state: 'verifying', tag };
      const release = validateDownloadRelease(
        JSON.parse(
          (await readUpdateBytes(`${API}/tags/${tag}`, false, 256 * 1024)).toString(
            'utf8',
          ),
        ),
        tag,
      );
      const bytes = await readUpdateBytes(assetUrl(tag, UPDATE_MANIFEST), true, 4096);
      const signature = await readUpdateBytes(assetUrl(tag, UPDATE_SIGNATURE), true, 64);
      const manifest = verifyUpdateManifest(bytes, signature, tag, this._keys);
      if (
        release.assets.find((a) => a.name === UPDATE_INSTALLER)?.size !==
          manifest.bytes ||
        release.assets.find((a) => a.name === UPDATE_MANIFEST)?.size !== bytes.length
      )
        throw new Error('Release size mismatch');
      await mkdir(this._options.stagingRoot, { recursive: true, mode: 0o700 });
      directory = await mkdtemp(join(this._options.stagingRoot, 'update-'));
      const partial = join(directory, 'installer.part');
      const destination = join(directory, UPDATE_INSTALLER);
      const file = await open(partial, 'wx', 0o600);
      this._status = { state: 'downloading', tag, percent: 0 };
      const hash = createHash('sha256');
      let received = 0;
      try {
        const res = await openUpdateResponse(
          assetUrl(tag, UPDATE_INSTALLER),
          true,
          AbortSignal.timeout(10 * 60 * 1000),
        );
        try {
          const length = res.headers['content-length'];
          if (length !== undefined && length !== String(manifest.bytes))
            throw new Error('Invalid artifact size');
          for await (const chunk of res) {
            received += chunk.length;
            if (received > manifest.bytes) throw new Error('Artifact too large');
            hash.update(chunk);
            await file.writeFile(chunk);
            this._status = {
              state: 'downloading',
              tag,
              percent: Math.floor((received / manifest.bytes) * 100),
            };
          }
          if (
            !res.complete ||
            received !== manifest.bytes ||
            hash.digest('hex') !== manifest.sha256
          )
            throw new Error('Artifact verification failed');
          this._status = { state: 'verifying', tag };
          await file.sync();
        } finally {
          res.destroy();
        }
      } finally {
        await file.close();
      }
      // Verify persisted bytes before publishing a ready filename.
      const persisted = createHash('sha256');
      let persistedSize = 0;
      for await (const chunk of createReadStream(partial)) {
        persistedSize += chunk.length;
        if (persistedSize > manifest.bytes) throw new Error('Staging size mismatch');
        persisted.update(chunk);
      }
      if (persistedSize !== manifest.bytes || persisted.digest('hex') !== manifest.sha256)
        throw new Error('Staging verification failed');
      await rename(partial, destination);
      this._stagedPath = destination;
      this._authentication = {
        bytes: Buffer.from(bytes),
        signature: Buffer.from(signature),
        tag,
      };
      this._status = { state: 'ready', tag, percent: 100 };
    } catch {
      if (directory) {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch {
          /* A locked orphan is never ready or executable. */
        }
      }
      // Fixed state only: no paths, CDN tokens, raw network errors or profile data.
      this._stagedPath = undefined;
      this._authentication = undefined;
      this._status = {
        state: 'error',
        tag: typeof tag === 'string' && /^v[\d.rc-]{1,79}$/.test(tag) ? tag : undefined,
      };
    } finally {
      this._busy = false;
    }
    return this.status();
  }

  /** Main-only recheck of a process-owned download. This is NOT an execution
   * grant: Windows native deny-write/delete handles must span verification and
   * CreateProcess in the future external helper. No path leaves this service.
   * A later helper must repeat authentication under that handle protection.
   */
  async revalidateStagedDownload(): Promise<UpdateDownloadStatus> {
    if (this._busy) return this.status();
    this._busy = true;
    try {
      const authentication = this._authentication;
      const stagedPath = this._stagedPath;
      if (this._status.state !== 'ready' || !stagedPath || !authentication)
        throw new Error('Update unavailable');
      this._status = { state: 'verifying', tag: authentication.tag };
      if (
        !(await this._options.eligible()) ||
        newestPlanstrandRelease(
          [
            {
              tag_name: authentication.tag,
              draft: false,
              prerelease: authentication.tag.includes('-rc.'),
            },
          ],
          this._options.currentVersion,
        ) !== authentication.tag
      )
        throw new Error('Update unavailable');
      const manifest = verifyUpdateManifest(
        authentication.bytes,
        authentication.signature,
        authentication.tag,
        this._keys,
      );
      const root = resolve(this._options.stagingRoot);
      const directory = dirname(stagedPath);
      if (
        basename(stagedPath) !== UPDATE_INSTALLER ||
        dirname(directory) !== root ||
        !/^update-[a-zA-Z0-9]+$/.test(basename(directory)) ||
        (await realpath(root)) !== root ||
        (await realpath(directory)) !== directory ||
        (await lstat(stagedPath)).isSymbolicLink()
      )
        throw new Error('Update unavailable');
      const file = await open(stagedPath, 'r');
      try {
        const before = await file.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size !== manifest.bytes)
          throw new Error('Update unavailable');
        const hash = createHash('sha256');
        let size = 0;
        for await (const chunk of file.createReadStream({ autoClose: false })) {
          size += chunk.length;
          if (size > manifest.bytes) throw new Error('Update unavailable');
          hash.update(chunk);
        }
        const after = await file.stat();
        if (
          size !== manifest.bytes ||
          hash.digest('hex') !== manifest.sha256 ||
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs
        )
          throw new Error('Update unavailable');
      } finally {
        await file.close();
      }
      this._status = { state: 'ready', tag: authentication.tag, percent: 100 };
    } catch {
      this._stagedPath = undefined;
      this._authentication = undefined;
      this._status = { state: 'error', tag: this._status.tag };
    } finally {
      this._busy = false;
    }
    return this.status();
  }
}
