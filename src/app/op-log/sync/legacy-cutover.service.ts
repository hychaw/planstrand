import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { incrementVectorClock, mergeVectorClocks } from '../../core/util/vector-clock';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { uuidv7 } from '../../util/uuid-v7';
import { HydrationStateService } from '../apply/hydration-state.service';
import { convertOpToAction } from '../apply/operation-converter.util';
import { BackupService } from '../backup/backup.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import {
  ActionType,
  FULL_STATE_OP_TYPES,
  Operation,
  OperationLogEntry,
  OpType,
  extractFullStateFromPayload,
} from '../core/operation.types';
import { LOCK_NAMES } from '../core/operation-log.const';
import { AppDataComplete } from '../model/model-config';
import { extractEntityKeysFromState } from '../persistence/extract-entity-keys';
import { OperationLogHydratorService } from '../persistence/operation-log-hydrator.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SchemaMigrationService } from '../persistence/schema-migration.service';
import { TabSeqFrontierService } from '../persistence/tab-seq-frontier.service';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { ValidateStateService } from '../validation/validate-state.service';
import { LockService } from './lock.service';
import {
  isOpCoveredByLocalClock,
  OperationLogDownloadService,
} from './operation-log-download.service';
import { OperationLogUploadService } from './operation-log-upload.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { processDeferredActions } from './process-deferred-actions-flush.util';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { getRemoteOpBlockReason } from './remote-op-block.util';
import { SyncCapabilityGateService } from './sync-capability-gate.service';
import { SyncImportConflictGateService } from './sync-import-conflict-gate.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';

/** A release migration, never a schema-4 live sync peer or another reset endpoint. */
@Injectable({ providedIn: 'root' })
export class LegacyCutoverService {
  private store = inject(Store);
  private log = inject(OperationLogStoreService);
  private snapshots = inject(StateSnapshotService);
  private schemas = inject(SchemaMigrationService);
  private downloads = inject(OperationLogDownloadService);
  private uploads = inject(OperationLogUploadService);
  private replay = inject(RemoteOpsProcessingService);
  private validation = inject(ValidateStateService);
  private backups = inject(BackupService);
  private locks = inject(LockService);
  private writes = inject(OperationWriteFlushService);
  private hydration = inject(HydrationStateService);
  private hydrator = inject(OperationLogHydratorService);
  private frontier = inject(TabSeqFrontierService);
  private clientIds = inject(CLIENT_ID_PROVIDER);
  private capabilities = inject(SyncCapabilityGateService);
  private importGate = inject(SyncImportConflictGateService);
  private injector = inject(Injector);
  private providers = inject(SyncProviderManager);

  /** Returns true only after a replacement was accepted with a new server seq. */
  async tryCutover(
    provider: OperationSyncCapable,
    fenceEpoch?: number,
  ): Promise<boolean> {
    if (provider.providerMode !== 'superSyncOps') return false;
    const source = await this.log.loadStateCache();
    const prepared =
      source && (source.schemaVersion ?? 1) < 5
        ? (await this.log.getOpsAfterSeq(0))
            .filter((entry) => this.isCheckpoint(entry.op))
            .pop()
        : undefined;
    if (prepared?.rejectedAt !== undefined) {
      throw Object.assign(
        new Error(
          'Download the latest full-state replacement before retrying; legacy checkpoint requires reconciliation',
        ),
        { errorCode: 'INTERNAL_ERROR' },
      );
    }
    const pending =
      source && (source.schemaVersion ?? 1) < 5
        ? (await this.log.getUnsynced()).find((entry) => this.isCheckpoint(entry.op))
        : undefined;
    // A local schema stamp cannot establish server cutover. Read the surviving
    // protocol base; this is metadata and does not decrypt/migrate the snapshot.
    const probe = pending ? undefined : await provider.downloadOps(0, undefined, 1);
    const remoteLegacy = probe?.ops.some((entry) => (entry.op.schemaVersion ?? 1) < 5);
    if (!pending && !remoteLegacy && (!source || (source.schemaVersion ?? 1) >= 5)) {
      return false;
    }
    if (!pending && probe && probe.latestSeq > 0 && !remoteLegacy) {
      // Another migration client already established canonical server state.
      // Let ordinary full-state conflict handling protect local legacy work.
      return false;
    }

    const floor = await provider.getServerSyncCapabilities?.({ forceRefresh: true });
    if (floor?.kind !== 'available' || floor.capabilities.minSchemaVersion < 5) {
      throw new Error(
        'Legacy cutover requires schema-5 upload enforcement on every serving server first',
      );
    }

    return this.locks.request(LOCK_NAMES.UPLOAD, async () => {
      await this.writes.flushPendingWrites();
      const release = this.hydration.acquireApplyingRemoteOpsHold();
      try {
        this.providers.assertSyncEpochUnchanged(fenceEpoch, 'legacy cutover');
        const checkpoint =
          pending ?? (await this.prepareCheckpoint(provider, fenceEpoch));
        const payload = checkpoint.op.payload as {
          appDataComplete: unknown;
          baseServerSeq?: number;
        };
        if (!Number.isSafeInteger(payload.baseServerSeq) || payload.baseServerSeq! < 0) {
          throw new Error(
            'Legacy checkpoint has no bound source cursor; reconciliation required',
          );
        }
        if (
          (await this.log.getOpsAfterSeq(checkpoint.seq)).some(
            (entry) =>
              entry.seq > checkpoint.seq &&
              entry.source === 'local' &&
              entry.op.schemaVersion < 5 &&
              entry.rejectedAt === undefined,
          )
        ) {
          throw new Error(
            'Local legacy edits followed checkpoint preparation; reconciliation required',
          );
        }
        await this.validate(extractFullStateFromPayload(checkpoint.op.payload));
        await this.capabilities.assertUploadCompatible(provider, [checkpoint.op]);
        const key = await provider.getEncryptKey?.();
        if (provider.isEncryptionMandatory && !key) {
          throw new Error('Legacy cutover requires the configured encryption key');
        }
        // Same immutable operation identity after a rejection, lost response or
        // restart. Server deduplication resolves an ambiguous transport failure.
        const response = await this.uploads._uploadFullStateOpAsSnapshot(
          provider,
          checkpoint,
          key,
          true,
          payload.baseServerSeq,
        );
        if (
          !response.accepted &&
          response.error === 'Download the latest full-state replacement before retrying'
        ) {
          // Existing rejection metadata retains the checkpoint but prevents an
          // automatic destructive retry, including after a local restart.
          await this.log.markRejected([checkpoint.op.id]);
          throw Object.assign(
            new Error(
              `${response.error}; legacy source and recovery retained for reconciliation`,
            ),
            { errorCode: response.errorCode },
          );
        }
        if (
          !response.accepted ||
          !Number.isSafeInteger(response.serverSeq) ||
          response.serverSeq! <= payload.baseServerSeq!
        ) {
          throw new Error(
            `Legacy clean-slate replacement not confirmed: ${response.error ?? 'missing authoritative server sequence'}`,
          );
        }
        this.providers.assertSyncEpochUnchanged(fenceEpoch, 'legacy cutover response');
        await provider.setLastServerSeq(response.serverSeq!);
        await this.writes.flushThenRunExclusive(async () => {
          this.providers.assertSyncEpochUnchanged(
            fenceEpoch,
            'legacy cutover confirmation',
          );
          const entries = await this.log.getOpsAfterSeq(0);
          // Acknowledgement is durable BEFORE the cache install. Startup can
          // recover that gap from the confirmed checkpoint; pending cannot pass.
          await this.log.markSynced(
            entries
              .filter((entry) => entry.seq <= checkpoint.seq)
              .map((entry) => entry.seq),
          );
          await this.log.saveStateCache({
            state: extractFullStateFromPayload(checkpoint.op.payload),
            lastAppliedOpSeq: checkpoint.seq,
            vectorClock: checkpoint.op.vectorClock,
            compactedAt: Date.now(),
            schemaVersion: 5,
            snapshotEntityKeys: extractEntityKeysFromState(
              extractFullStateFromPayload(checkpoint.op.payload) as AppDataComplete,
            ),
          });
          await this.log.setVectorClock(checkpoint.op.vectorClock);
        });
        // Replays any later authored schema-5 local actions, without reprojecting
        // the old Planner/due fields in the confirmed checkpoint.
        await this.hydrator.hydrateStore();
        return true;
      } finally {
        release();
        await processDeferredActions(this.injector, false);
      }
    });
  }

  private async prepareCheckpoint(
    provider: OperationSyncCapable,
    fenceEpoch?: number,
  ): Promise<OperationLogEntry> {
    const sequences = new Map<string, number>();
    const complete = await this.downloads.downloadRemoteOps(provider, {
      forceFromSeq0: true,
      includeOwnAndAppliedOps: true,
      sourceServerSeqByOpId: sequences,
    });
    if (
      !complete.success ||
      complete.latestServerSeq === undefined ||
      !Number.isSafeInteger(complete.latestServerSeq) ||
      complete.latestServerSeq < 0 ||
      complete.decryptErrorAfterKeptPrefix ||
      this.downloads.hasUnseenRemoteOps()
    ) {
      throw new Error('Legacy history download did not complete; cutover aborted');
    }
    // Captured from the completed download, not the mutable provider cursor.
    const baseServerSeq = complete.latestServerSeq;
    for (const op of complete.newOps) {
      if (getRemoteOpBlockReason(op, 4)) {
        throw new Error(`Unsupported legacy history operation ${op.id}; cutover aborted`);
      }
    }
    const cursor = await provider.getLastServerSeq();
    const clock = (await this.log.getVectorClock()) ?? {};
    const applied = await this.log.getAppliedOpIds();
    const missing = complete.newOps.filter((op) => {
      const seq = sequences.get(op.id);
      if (seq === undefined)
        throw new Error('Legacy history is missing sequence lineage');
      return (
        !applied.has(op.id) && !(seq <= cursor && isOpCoveredByLocalClock(op, clock))
      );
    });
    // Preserve a raw source anchor even for a fresh migration client or a cache
    // previously stamped by generic compaction. No Planning projection here.
    await this.writes.flushThenRunExclusive(async () => {
      this.providers.assertSyncEpochUnchanged(fenceEpoch, 'legacy source preservation');
      const state = await this.snapshots.getStateSnapshotForOperationLogAsync();
      const seq = await this.log.getLastSeq();
      if (!this.frontier.isSaveSafeAt(seq))
        throw new Error('Local legacy state contains unapplied concurrent-tab writes');
      await this.log.saveStateCache({
        state,
        lastAppliedOpSeq: seq,
        vectorClock: (await this.log.getVectorClock()) ?? {},
        compactedAt: Date.now(),
        schemaVersion: 4,
        snapshotEntityKeys: extractEntityKeysFromState(state),
      });
    });
    await this.schemas.materializeLegacy(async () => {
      // Preflight the entire prefix before applying any of it. Conversion and
      // legacy migrations use the same reducers/pipeline as ordinary hydration.
      const interpretedIds = new Set<string>();
      for (const op of complete.newOps) {
        const migrated = this.schemas.migrateOperation(op);
        for (const replayOp of migrated
          ? Array.isArray(migrated)
            ? migrated
            : [migrated]
          : []) {
          convertOpToAction(replayOp);
          interpretedIds.add(replayOp.id);
        }
      }
      const assertCompleteReplay = async (): Promise<void> => {
        for (const entry of await this.log.getOpsAfterSeq(0)) {
          if (
            interpretedIds.has(entry.op.id) &&
            (entry.reducerRejectedAt !== undefined ||
              (entry.applicationStatus !== undefined &&
                entry.applicationStatus !== 'applied'))
          ) {
            throw new Error(
              `Legacy operation ${entry.op.id} did not materialize completely`,
            );
          }
        }
      };
      await assertCompleteReplay();
      const fullState = missing.some((op) => FULL_STATE_OP_TYPES.has(op.opType));
      const apply = (): ReturnType<RemoteOpsProcessingService['processRemoteOps']> =>
        this.replay.processRemoteOps(missing, {
          fenceEpoch,
          callerHoldsOperationLogLock: fullState,
          beforeFullStateApply: async (ops) =>
            !(
              await this.importGate.checkIncomingFullStateConflict(ops, {
                isNeverSynced: !(await this.log.hasSyncedOps()),
                flushPendingWrites: false,
              })
            ).hasMeaningfulPending,
        });
      const result = fullState
        ? await this.writes.flushThenRunExclusive(apply)
        : await apply();
      if (result.blockedByIncompatibleOp || result.fullStateApplyBlockedByLocalConflict) {
        throw new Error(
          'Legacy materialization blocked; local source and pending work retained',
        );
      }
      await assertCompleteReplay();
    });
    return this.writes.flushThenRunExclusive(async () => {
      this.providers.assertSyncEpochUnchanged(fenceEpoch, 'legacy projection');
      const raw = await this.snapshots.getStateSnapshotForOperationLogAsync();
      const entries = await this.log.getOpsAfterSeq(0);
      const lastSeq = await this.log.getLastSeq();
      if (!this.frontier.isSaveSafeAt(lastSeq))
        throw new Error('Legacy materialization does not cover the local frontier');
      const projected = this.schemas.projectMaterializedLegacyState(
        raw as unknown as Record<string, unknown>,
      );
      await this.validate(projected);
      // The normal recovery ring captures the validated projection. Its raw
      // legacy evidence survives as well; the durable raw replay anchor stays.
      this.store.dispatch({
        ...loadAllData({ appDataComplete: projected as AppDataComplete }),
        meta: { isRemote: true },
      });
      try {
        await this.backups.captureImportBackup('REMOTE_IMPORT');
      } finally {
        this.store.dispatch({
          ...loadAllData({ appDataComplete: raw as AppDataComplete }),
          meta: { isRemote: true },
        });
      }
      const clientId = await this.clientIds.loadClientId();
      if (!clientId) throw new Error('Legacy cutover has no local client identity');
      let merged = (await this.log.getVectorClock()) ?? {};
      for (const opClock of complete.allOpClocks ?? [])
        merged = mergeVectorClocks(merged, opClock);
      for (const entry of entries)
        merged = mergeVectorClocks(merged, entry.op.vectorClock);
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        payload: { appDataComplete: projected, baseServerSeq },
        vectorClock: await this.log.pruneClockForStorage(
          incrementVectorClock(merged, clientId),
        ),
        timestamp: Date.now(),
        schemaVersion: 5,
        syncImportReason: 'SERVER_MIGRATION',
      };
      this.providers.assertSyncEpochUnchanged(fenceEpoch, 'legacy checkpoint append');
      const seq = await this.log.append(op, 'local');
      return { op, seq, source: 'local', appliedAt: Date.now() };
    });
  }

  private isCheckpoint(op: Operation): boolean {
    return (
      op.schemaVersion === 5 &&
      op.opType === OpType.SyncImport &&
      (op.syncImportReason === 'SERVER_MIGRATION' ||
        op.syncImportReason === 'FORCE_UPLOAD')
    );
  }

  private async validate(state: unknown): Promise<void> {
    if (
      !(await this.validation.validateState(state as Record<string, unknown>)).isValid
    ) {
      throw new Error('Projected legacy cutover state failed schema-5 validation');
    }
  }
}
