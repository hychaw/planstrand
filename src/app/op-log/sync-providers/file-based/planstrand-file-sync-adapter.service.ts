import { inject, Injectable } from '@angular/core';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { stripLocalOnlySyncSettingsFromAppData } from '../../../features/config/local-only-sync-settings.util';
import { FileBasedSyncAdapterService } from './file-based-sync-adapter.service';
import {
  FileSyncProvider,
  OperationSyncCapable,
  FileSnapshotOpDownloadResponse,
} from '../provider.interface';
import { SyncProviderId } from '../provider.const';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import {
  FileSyncTargetChangedError,
  RemoteFileNotFoundAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../core/errors/sync-errors';
import { EncryptAndCompressHandlerService } from '../../encryption/encrypt-and-compress-handler.service';
import { readLegacyImportSource } from './planstrand-legacy-import';
import {
  discoverPlanstrandNamespace,
  filePresent,
  PlanstrandFileTransport,
  PlanstrandTransportOptions,
} from './planstrand-file-transport';
import {
  LegacyFileImportRequiredError,
  PlanstrandFileIncompatibleError,
  PLANSTRAND_FILE_NAMESPACE as P,
  PLANSTRAND_REQUIRED_FILE_OP_TYPES,
  KNOWN_FILE_SEMANTICS,
  PLANSTRAND_FILE_VERSION,
  assertPlanstrandFileEnvelope,
  requiredFileOpTypes,
} from './planstrand-file-protocol';
import { VectorClock } from '../../core/operation.types';

type Provider = FileSyncProvider<SyncProviderId>;
export interface PlanstrandLegacyImportHooks {
  /** Must persist the local pre-import recovery point before materialization. */
  captureRecoveryPoint: () => Promise<void>;
  /** Return current host state after validation/migration/replay, including split tails. */
  materialize: (
    source: FileSnapshotOpDownloadResponse,
    sourceSchemaVersion: number,
  ) => Promise<unknown>;
}

/** Production file entry point. The delegated engine never sees a raw target. */
@Injectable({ providedIn: 'root' })
export class PlanstrandFileSyncAdapterService {
  private _engine = inject(FileBasedSyncAdapterService);
  private _generation = 0;
  private _initialized = false;

  invalidateAllTargets(): void {
    this._generation++;
    this._engine.invalidateAllTargets();
  }

  createAdapter(
    provider: Provider,
    cfg: EncryptAndCompressCfg,
    key: string | undefined,
    options: Partial<Omit<PlanstrandTransportOptions, 'assertTargetCurrent'>> = {},
  ): OperationSyncCapable<'fileSnapshotOps'> {
    if (!this._initialized) {
      // Legacy local cursors/revisions do not describe the new namespace.
      if (localStorage.getItem('PLANSTRAND_FILE_METADATA_V1') !== '1') {
        this._engine.invalidateAllTargets();
        localStorage.setItem('PLANSTRAND_FILE_METADATA_V1', '1');
      }
      this._initialized = true;
    }
    const generation = this._generation;
    const assertTargetCurrent = (): void => {
      if (generation !== this._generation)
        throw new FileSyncTargetChangedError(generation, this._generation);
    };
    const transport = new PlanstrandFileTransport(provider, cfg, key, {
      supportedOpTypes: options.supportedOpTypes ?? KNOWN_FILE_SEMANTICS,
      requiredOpTypes: requiredFileOpTypes(
        options.requiredOpTypes ?? [],
        PLANSTRAND_REQUIRED_FILE_OP_TYPES,
      ),
      readCfg: options.readCfg,
      readKey: options.readKey,
      assertTargetCurrent,
    });
    const engine = this._engine.createAdapter(transport.provider, cfg, key);
    return new Proxy(engine, {
      get: (target, prop) => {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]): Promise<unknown> => {
          assertTargetCurrent();
          if (
            ['uploadOps', 'uploadSnapshot', 'downloadOps', 'deleteAllData'].includes(
              String(prop),
            )
          ) {
            const namespace = await discoverPlanstrandNamespace(provider);
            if (namespace === 'legacy') throw new LegacyFileImportRequiredError();
            if (
              namespace === 'planstrand' &&
              !(await filePresent(provider, P.opsFile)) &&
              !(await filePresent(provider, P.syncFile))
            )
              throw new PlanstrandFileIncompatibleError();
            assertTargetCurrent();
          }
          if (prop === 'uploadOps')
            transport.requireOperations(args[0] as { opType: string }[]);
          if (prop === 'uploadSnapshot')
            transport.requireOperations([
              {
                opType: (args[8] as string | undefined) ?? 'SYNC_IMPORT',
                requiredEntityTypes: args[12] as string[] | undefined,
                requiredCapabilities: args[13] as string[] | undefined,
              },
            ]);
          if (prop === 'deleteAllData') await transport.readRequirements();
          return value.apply(target, args);
        };
      },
    });
  }

  /** Explicit choice B: reserve a new namespace without touching legacy data. */
  async startFresh(
    provider: Provider,
    cfg: EncryptAndCompressCfg,
    key: string | undefined,
    state: unknown,
    clientId: string,
    vectorClock: VectorClock,
  ): Promise<void> {
    await this._createNamespace(provider, cfg, key, state, clientId, vectorClock);
  }

  /** Explicit choice A. Existing Planstrand commits are never imported over. */
  async importLegacy(
    provider: Provider,
    cfg: EncryptAndCompressCfg,
    key: string | undefined,
    clientId: string,
    hooks: PlanstrandLegacyImportHooks,
  ): Promise<void> {
    const generation = this._generation;
    if ((await discoverPlanstrandNamespace(provider)) === 'planstrand') {
      if (
        (await filePresent(provider, P.opsFile)) ||
        (await filePresent(provider, P.syncFile))
      )
        return;
      // A reservation alone is not a successful import. Keep it fenced for
      // explicit recovery instead of claiming completion or installing state.
      throw new PlanstrandFileIncompatibleError();
    }
    const source = await readLegacyImportSource(provider, cfg, key);
    await hooks.captureRecoveryPoint();
    const state = await hooks.materialize(source.response, source.schemaVersion);
    await source.verifyRevision();
    if (generation !== this._generation)
      throw new FileSyncTargetChangedError(generation, this._generation);
    await this._createNamespace(
      provider,
      cfg,
      key,
      state,
      clientId,
      source.response.snapshotVectorClock ?? {},
    );
  }

  private async _createNamespace(
    provider: Provider,
    cfg: EncryptAndCompressCfg,
    key: string | undefined,
    state: unknown,
    clientId: string,
    vectorClock: VectorClock,
  ): Promise<void> {
    const generation = this._generation;
    if ((await discoverPlanstrandNamespace(provider)) === 'planstrand')
      throw new UploadRevToMatchMismatchAPIError();
    const handler = new EncryptAndCompressHandlerService();
    // Hydration carries archives alongside app state; the file wire keeps them
    // at envelope level, just like the normal snapshot writer.
    let applicationState = state;
    let archives: { archiveYoung?: unknown; archiveOld?: unknown } = {};
    if (state && typeof state === 'object') {
      const { archiveYoung, archiveOld, ...canonicalState } = state as Record<
        string,
        unknown
      >;
      applicationState = canonicalState;
      archives = {
        ...(archiveYoung !== undefined ? { archiveYoung } : {}),
        ...(archiveOld !== undefined ? { archiveOld } : {}),
      };
    }
    const data = {
      product: 'planstrand' as const,
      version: PLANSTRAND_FILE_VERSION,
      compatibility: {
        requiredOpTypes: requiredFileOpTypes([], PLANSTRAND_REQUIRED_FILE_OP_TYPES),
      },
      syncVersion: 1,
      // Both entry points supply current host state; source schema only governs
      // legacy validation/materialization and must never label the new snapshot.
      schemaVersion: CURRENT_SCHEMA_VERSION,
      vectorClock,
      snapshotBaseClock: vectorClock,
      lastModified: Date.now(),
      clientId,
      state: stripLocalOnlySyncSettingsFromAppData(applicationState),
      ...archives,
      recentOps: [],
    };
    const encoded = await handler.compressAndEncryptData(
      cfg,
      key,
      data,
      PLANSTRAND_FILE_VERSION,
    );
    // Reserve the recovery filename without publishing uncommitted import
    // state. A delayed older Planstrand backup create now loses CAS, while a
    // crash or losing primary race leaves only a non-hydratable fence.
    const fence = await handler.compressAndEncryptData(
      cfg,
      key,
      {
        product: data.product,
        version: data.version,
        compatibility: data.compatibility,
        recoveryStatus: 'uncommitted',
      },
      PLANSTRAND_FILE_VERSION,
    );
    if (generation !== this._generation)
      throw new FileSyncTargetChangedError(generation, this._generation);
    const reservation = await provider.uploadFile(P.backupFile, fence, null, false);
    if (generation !== this._generation)
      throw new FileSyncTargetChangedError(generation, this._generation);
    // Create-only single-file commit. A competing Planstrand creator cannot be
    // overwritten. Legacy is never mutated, even on failure or retry.
    await provider.uploadFile(P.syncFile, encoded, null, false);
    const verified = await provider.downloadFile(P.syncFile);
    const decoded = await handler.decompressAndDecryptData<unknown>(
      cfg,
      key,
      verified.dataStr,
    );
    assertPlanstrandFileEnvelope(decoded, KNOWN_FILE_SEMANTICS);
    if (verified.dataStr !== encoded) throw new UploadRevToMatchMismatchAPIError();
    // Recovery state only after commit; a losing importer cannot install its
    // candidate snapshot in an authoritative backup.
    if (generation !== this._generation)
      throw new FileSyncTargetChangedError(generation, this._generation);
    try {
      await provider.uploadFile(P.backupFile, encoded, reservation.rev, false);
    } catch (e) {
      if (
        !(e instanceof UploadRevToMatchMismatchAPIError) &&
        !(e instanceof RemoteFileNotFoundAPIError)
      )
        throw e;
    }
    this._engine.invalidateAllTargets();
  }
}
