import { getFullStateRequiredEntityTypes } from '@sp/shared-schema';
import { FileSyncProvider } from '../provider.interface';
import { SyncProviderId } from '../provider.const';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { EncryptAndCompressHandlerService } from '../../encryption/encrypt-and-compress-handler.service';
import { extractSyncFileStateFromPrefix } from '../../util/sync-file-prefix';
import {
  RemoteFileNotFoundAPIError,
  JsonParseError,
  InvalidDataSPError,
  DecryptError,
  DecompressError,
} from '../../core/errors/sync-errors';
import {
  assertPlanstrandFileEnvelope,
  LEGACY_SP_FILE_NAMESPACE as L,
  PLANSTRAND_FILE_NAMESPACE as P,
  PLANSTRAND_FILE_VERSION,
  PlanstrandFileIncompatibleError,
  planstrandPath,
  logicalSnapshotPath,
  requiredFileOpTypes,
} from './planstrand-file-protocol';

type Provider = FileSyncProvider<SyncProviderId>;
export interface PlanstrandTransportOptions {
  supportedOpTypes: ReadonlySet<string>;
  requiredOpTypes: readonly string[];
  assertTargetCurrent: () => void;
  /** Password rotation reads with the old config/key, writes with the new one. */
  readCfg?: EncryptAndCompressCfg;
  readKey?: string;
}

export const filePresent = async (provider: Provider, path: string): Promise<boolean> => {
  try {
    await provider.downloadFile(path);
    return true;
  } catch (e) {
    if (e instanceof InvalidDataSPError) return true;
    if (e instanceof RemoteFileNotFoundAPIError) return false;
    throw e;
  }
};

export const discoverPlanstrandNamespace = async (
  provider: Provider,
): Promise<'planstrand' | 'legacy' | 'empty'> => {
  // Presence, not successful decoding, owns the namespace. Never fall back to
  // legacy because a Planstrand commit point is damaged or incompatible.
  for (const path of [
    P.opsFile,
    P.syncFile,
    P.stateFile,
    P.backupFile,
    P.opsBackupFile,
    P.stateBackupFile,
    P.migrationLockFile,
    P.legacyMetaFile,
  ]) {
    if (await filePresent(provider, path)) return 'planstrand';
  }
  for (const path of [
    L.opsFile,
    L.syncFile,
    L.legacyMetaFile,
    L.backupFile,
    L.opsBackupFile,
    L.stateFile,
    L.stateBackupFile,
    L.migrationLockFile,
  ]) {
    if (await filePresent(provider, path)) return 'legacy';
  }
  return 'empty';
};

/**
 * The existing layout engine operates on v2/v3-shaped in-memory projections.
 * This boundary exclusively addresses Planstrand paths and serializes v4.
 * Revisions always remain those of the physical file, never of the projection.
 */
export class PlanstrandFileTransport {
  readonly provider: Provider;
  private _handler = new EncryptAndCompressHandlerService();
  private _requirements: string[];
  constructor(
    private _raw: Provider,
    private _cfg: EncryptAndCompressCfg,
    private _key: string | undefined,
    private _options: PlanstrandTransportOptions,
  ) {
    this._requirements = requiredFileOpTypes([], _options.requiredOpTypes);
    this.provider = new Proxy(_raw, {
      get: (target, prop) => {
        if (prop === 'downloadFile') return (path: string) => this._download(path);
        if (prop === 'getFileRev')
          return (path: string, rev: string | null) =>
            target.getFileRev(planstrandPath(path), rev);
        if (prop === 'uploadFile')
          return (path: string, body: string, rev: string | null, force?: boolean) =>
            this._upload(path, body, rev, force);
        if (prop === 'removeFile')
          return async (path: string) => {
            this._options.assertTargetCurrent();
            return target.removeFile(planstrandPath(path));
          };
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  requireOperations(
    ops: readonly {
      opType: string;
      entityType?: string;
      requiredEntityTypes?: string[];
    }[],
  ): void {
    const entities = ops.flatMap((op) => [
      ...(op.entityType === 'FOLDER' ? ['FOLDER'] : []),
      ...(op.requiredEntityTypes ?? []),
    ]);
    this._requirements = requiredFileOpTypes(
      this._requirements,
      entities.map((type) => `ENTITY:${type}`),
      ops,
    );
  }

  private async _decode(body: string): Promise<Record<string, unknown>> {
    let data: unknown;
    try {
      data = await this._handler.decompressAndDecryptData<unknown>(
        this._cfg,
        this._key,
        body,
      );
    } catch (e) {
      if (!this._options.readCfg) throw e;
      data = await this._handler.decompressAndDecryptData<unknown>(
        this._options.readCfg,
        this._options.readKey,
        body,
      );
    }
    assertPlanstrandFileEnvelope(data, this._options.supportedOpTypes);
    if (extractSyncFileStateFromPrefix(body).modelVersion !== data.version)
      throw new PlanstrandFileIncompatibleError();
    this._requirements = requiredFileOpTypes(
      this._requirements,
      data.compatibility.requiredOpTypes,
    );
    return data;
  }

  private async _download(path: string): Promise<{ dataStr: string; rev: string }> {
    const response = await this._raw.downloadFile(planstrandPath(path));
    const physical = await this._decode(response.dataStr);
    if (physical.recoveryStatus === 'uncommitted')
      throw new PlanstrandFileIncompatibleError();
    const data = { ...physical };
    delete data.product;
    delete data.compatibility;
    data.version = path.startsWith('sync-data.') && data.format !== 'split' ? 2 : 3;
    const ref = data.snapshotRef as { file?: unknown } | undefined;
    if (ref?.file !== undefined)
      data.snapshotRef = { ...ref, file: logicalSnapshotPath(ref.file) };
    return {
      rev: response.rev,
      dataStr: await this._handler.compressAndEncryptData(
        this._cfg,
        this._key,
        data,
        data.version as number,
      ),
    };
  }

  /** Learn authoritative requirements even for cold full-state replacements. */
  async readRequirements(): Promise<void> {
    for (const [path, backup] of [
      [P.opsFile, P.opsBackupFile],
      [P.syncFile, P.backupFile],
    ]) {
      try {
        await this._decode((await this._raw.downloadFile(path)).dataStr);
      } catch (e) {
        if (e instanceof RemoteFileNotFoundAPIError) continue;
        if (
          !(
            e instanceof JsonParseError ||
            e instanceof InvalidDataSPError ||
            e instanceof DecryptError ||
            e instanceof DecompressError
          )
        )
          throw e;
        // The manifest-neutralization write before each commit makes this
        // recovery copy a durable floor even when the primary is undecodable.
        await this._decode((await this._raw.downloadFile(backup)).dataStr);
      }
    }
    // A create-only import reserves a non-hydratable backup fence before its
    // first primary commit. It also defeats a delayed baseline backup creator.
    for (const path of [P.opsBackupFile, P.backupFile]) {
      try {
        await this._decode((await this._raw.downloadFile(path)).dataStr);
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) throw e;
      }
    }
  }

  private async _upload(
    path: string,
    body: string,
    rev: string | null,
    force = false,
  ): Promise<{ rev: string }> {
    // Before every write, re-read the commit point. A stale cached projection
    // cannot erase a concurrent semantic requirement, including in force paths.
    await this.readRequirements();
    const data = await this._handler.decompressAndDecryptData<Record<string, unknown>>(
      this._cfg,
      this._key,
      body,
    );
    this._requirements = requiredFileOpTypes(
      this._requirements,
      getFullStateRequiredEntityTypes(data.state).map((type) => `ENTITY:${type}`),
    );
    const ref = data.snapshotRef as { file?: string } | undefined;
    if (ref?.file) data.snapshotRef = { ...ref, file: planstrandPath(ref.file) };
    data.product = 'planstrand';
    data.version = PLANSTRAND_FILE_VERSION;
    data.compatibility = { requiredOpTypes: [...this._requirements] };
    const physicalPath = planstrandPath(path);
    if ([L.syncFile, L.opsFile].includes(path)) {
      // A non-fatal engine backup failure must not leave a weaker recovery
      // envelope beside a newly committed semantic requirement. Upgrade the
      // existing backup's manifest only, never a losing candidate's state.
      const backupPath = path === L.syncFile ? P.backupFile : P.opsBackupFile;
      try {
        const backup = await this._raw.downloadFile(backupPath);
        const backupData = await this._decode(backup.dataStr);
        backupData.compatibility = { requiredOpTypes: [...this._requirements] };
        const upgradedBackup = await this._handler.compressAndEncryptData(
          this._cfg,
          this._key,
          backupData,
          PLANSTRAND_FILE_VERSION,
        );
        this._options.assertTargetCurrent();
        await this._raw.uploadFile(backupPath, upgradedBackup, backup.rev, false);
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) throw e;
        // Reserve a missing recovery path before the primary can commit. An
        // older delayed backup create must lose CAS, even on the first write.
        const fence = await this._handler.compressAndEncryptData(
          this._cfg,
          this._key,
          {
            product: 'planstrand',
            version: PLANSTRAND_FILE_VERSION,
            compatibility: { requiredOpTypes: [...this._requirements] },
            recoveryStatus: 'uncommitted',
          },
          PLANSTRAND_FILE_VERSION,
        );
        this._options.assertTargetCurrent();
        await this._raw.uploadFile(backupPath, fence, null, false);
      }
      data.compatibility = { requiredOpTypes: [...this._requirements] };
    }
    const encoded = await this._handler.compressAndEncryptData(
      this._cfg,
      this._key,
      data,
      PLANSTRAND_FILE_VERSION,
    );
    if (force && [L.backupFile, L.opsBackupFile, L.stateBackupFile].includes(path)) {
      let backupRev: string | null = null;
      try {
        const existing = await this._raw.downloadFile(physicalPath);
        await this._decode(existing.dataStr);
        backupRev = existing.rev;
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) throw e;
      }
      data.compatibility = { requiredOpTypes: [...this._requirements] };
      const replacement = await this._handler.compressAndEncryptData(
        this._cfg,
        this._key,
        data,
        PLANSTRAND_FILE_VERSION,
      );
      this._options.assertTargetCurrent();
      return this._raw.uploadFile(physicalPath, replacement, backupRev, false);
    }
    // Even explicit replacement uses CAS against the readable winning file.
    // Preparing immutable snapshots and backups retains engine write semantics.
    if (force && [L.syncFile, L.opsFile].includes(path)) {
      try {
        const current = await this._raw.downloadFile(physicalPath);
        await this._decode(current.dataStr);
        // If the read added requirements, rebuild the outgoing manifest.
        data.compatibility = { requiredOpTypes: [...this._requirements] };
        const replacement = await this._handler.compressAndEncryptData(
          this._cfg,
          this._key,
          data,
          PLANSTRAND_FILE_VERSION,
        );
        this._options.assertTargetCurrent();
        return this._raw.uploadFile(physicalPath, replacement, current.rev, false);
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) throw e;
      }
      this._options.assertTargetCurrent();
      return this._raw.uploadFile(physicalPath, encoded, null, false);
    }
    this._options.assertTargetCurrent();
    return this._raw.uploadFile(physicalPath, encoded, rev, force);
  }
}
