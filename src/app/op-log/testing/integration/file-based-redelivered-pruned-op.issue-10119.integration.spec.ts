import { EncryptAndCompressHandlerService } from '../../encryption/encrypt-and-compress-handler.service';
import { KNOWN_OP_TYPES } from '../../sync/remote-op-block.util';
import { setArgon2ParamsForTesting, clearSessionKeyCache } from '@sp/sync-core';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { OperationLogSyncService } from '../../sync/operation-log-sync.service';
import { OperationLogUploadService } from '../../sync/operation-log-upload.service';
import { OperationLogDownloadService } from '../../sync/operation-log-download.service';
import { OperationEncryptionService } from '../../sync/operation-encryption.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { COMPACTION_RETENTION_MS } from '../../core/operation-log.const';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { ValidateStateService } from '../../validation/validate-state.service';
import { RepairOperationService } from '../../validation/repair-operation.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import {
  OperationSyncCapable,
  SyncOperation,
} from '../../sync-providers/provider.interface';
import { SyncProviderId } from '../../sync-providers/provider.const';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { FileBasedSyncAdapterService } from '../../sync-providers/file-based/file-based-sync-adapter.service';
import { ActionType, Operation, OpType, VectorClock } from '../../core/operation.types';
import { UserInputWaitStateService } from '../../../imex/sync/user-input-wait-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockFileProvider } from './helpers/mock-file-provider.helper';
import { LockService } from '../../sync/lock.service';
import { SchemaMigrationService } from '../../persistence/schema-migration.service';
import { SuperSyncStatusService } from '../../sync/super-sync-status.service';
import { ServerMigrationService } from '../../sync/server-migration.service';
import { OperationWriteFlushService } from '../../sync/operation-write-flush.service';
import { RemoteOpsProcessingService } from '../../sync/remote-ops-processing.service';
import { RejectedOpsHandlerService } from '../../sync/rejected-ops-handler.service';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { SyncImportFilterService } from '../../sync/sync-import-filter.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
import { createValidAppData } from '../../validation/state-validity-test-utils';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { selectSyncConfig } from '../../../features/config/store/global-config.reducer';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { UploadRevToMatchMismatchAPIError } from '../../core/errors/sync-errors';

/**
 * #10119: file-based providers (Dropbox/WebDAV/local file) return the WHOLE
 * `recentOps` buffer (up to MAX_RECENT_OPS) on every download whose file
 * changed, minus this client's own ops. Compaction deletes synced ops older
 * than 7 days locally, so their ids leave the applied-op-id set.
 *
 * Scenario: another device (Android) created a task; this device (Linux)
 * archived it; >7 days later compaction prunes both ops locally, while the
 * remote buffer still holds Android's create op. On the next download the old
 * create op must NOT be treated as new — the archived task is no longer in
 * the snapshot entity keys, so conflict detection's "no local state" fast path
 * would re-create it as an active task.
 *
 * Both devices talk to one shared in-memory file through REAL
 * FileBasedSyncAdapterService instances (real `sync-data.json` / split-file
 * format, real per-op `sv` tagging, real cursor), and Linux runs the REAL
 * download, conflict-detection, op-store (IndexedDB) and compaction path.
 */

const OTHER = 'android-client';
const ARCHIVED_TASK_ID = 'rpt_cfg_2026-08-18';
const FILE_CFG: EncryptAndCompressCfg = { isEncrypt: false, isCompress: false };

const clearAdapterLocalStorage = (): void => {
  Object.keys(localStorage)
    .filter((key) => key.startsWith('FILE_SYNC_VERSION_'))
    .forEach((key) => localStorage.removeItem(key));
};

for (const isUseSplitSyncFiles of [false, true]) {
  describe(`#10119 file-based re-delivery of pruned ops (integration, split=${isUseSplitSyncFiles})`, () => {
    let syncService: OperationLogSyncService;
    let compactionService: OperationLogCompactionService;
    let opLogStore: OperationLogStoreService;
    let remote: MockFileProvider;
    let linux: OperationSyncCapable;
    let android: OperationSyncCapable;
    let applierSpy: jasmine.SpyObj<OperationApplierService>;
    let stateSnapshotSpy: jasmine.SpyObj<StateSnapshotService>;
    let ownClientId: string;
    let newAdapter: () => OperationSyncCapable;

    const taskOp = (
      id: string,
      clientId: string,
      actionType: ActionType,
      opType: OpType,
      entityId: string,
      payload: unknown,
      vectorClock: VectorClock,
    ): Operation => ({
      id,
      clientId,
      actionType,
      opType,
      entityType: 'TASK',
      entityId,
      payload,
      vectorClock,
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    const otherAddTask = (id: string, taskId: string, clock: VectorClock): Operation =>
      taskOp(
        id,
        OTHER,
        ActionType.TASK_SHARED_ADD,
        OpType.Create,
        taskId,
        {
          actionPayload: {
            task: { id: taskId, title: 'méditation', dueDay: '2026-08-18' },
            workContextId: 'INBOX_PROJECT',
            workContextType: 'PROJECT',
            isAddToBacklog: false,
            isAddToBottom: false,
          },
          entityChanges: [],
        },
        clock,
      );

    /** Another device writes ops to the shared file (its own sync cycle). */
    const androidUploads = async (...ops: Operation[]): Promise<void> => {
      const downloaded = await android.downloadOps(0, OTHER);
      await android.setLastServerSeq(downloaded.latestSeq);
      const uploaded = await android.uploadOps(ops as SyncOperation[], OTHER);
      await android.setLastServerSeq(uploaded.latestSeq);
    };

    /**
     * This device uploads ops the way OperationLogUploadService does for a
     * file-based provider: the adapter merges into the CURRENT remote file and
     * the returned latestSeq becomes the cursor.
     */
    const linuxUploads = async (...ops: Operation[]): Promise<void> => {
      const response = await linux.uploadOps(ops as SyncOperation[], ownClientId);
      await linux.setLastServerSeq(response.latestSeq);
    };

    const appliedOpIdsPassedToApplier = (): string[] =>
      applierSpy.applyOperations.calls
        .allArgs()
        .flatMap(([ops]) => (ops as Operation[]).map((op) => op.id));

    beforeEach(async () => {
      clearAdapterLocalStorage();
      if (!(window.confirm as jasmine.Spy).and) {
        spyOn(window, 'confirm').and.returnValue(true);
      } else {
        (window.confirm as jasmine.Spy).and.returnValue(true);
      }

      applierSpy = jasmine.createSpyObj('OperationApplierService', ['applyOperations']);
      applierSpy.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });

      const waitServiceSpy = jasmine.createSpyObj('UserInputWaitStateService', [
        'startWaiting',
      ]);
      waitServiceSpy.startWaiting.and.returnValue(() => {});
      const dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
      dialogSpy.open.and.returnValue({ afterClosed: () => of(true) });
      const superSyncStatusSpy = jasmine.createSpyObj('SuperSyncStatusService', [
        'markRemoteChecked',
        'updatePendingOpsStatus',
        'clearScope',
      ]);
      const serverMigrationSpy = jasmine.createSpyObj('ServerMigrationService', [
        'checkAndHandleMigration',
        'handleServerMigration',
      ]);
      serverMigrationSpy.checkAndHandleMigration.and.resolveTo();
      serverMigrationSpy.handleServerMigration.and.resolveTo();
      const writeFlushSpy = jasmine.createSpyObj('OperationWriteFlushService', [
        'flushPendingWrites',
        'flushThenRunExclusive',
      ]);
      writeFlushSpy.flushPendingWrites.and.resolveTo();
      writeFlushSpy.flushThenRunExclusive.and.callFake(
        async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      );
      const rejectedOpsHandlerSpy = jasmine.createSpyObj('RejectedOpsHandlerService', [
        'handleRejectedOps',
      ]);
      rejectedOpsHandlerSpy.handleRejectedOps.and.resolveTo(0);
      const syncHydrationSpy = jasmine.createSpyObj('SyncHydrationService', [
        'hydrateFromRemoteSync',
      ]);
      syncHydrationSpy.hydrateFromRemoteSync.and.resolveTo();
      stateSnapshotSpy = jasmine.createSpyObj('StateSnapshotService', [
        'getStateSnapshot',
        'getStateSnapshotAsync',
        'getStateSnapshotForOperationLog',
      ]);
      stateSnapshotSpy.getStateSnapshotAsync.and.callFake(async () =>
        createValidAppData(),
      );
      stateSnapshotSpy.getStateSnapshot.and.returnValue(
        undefined as unknown as ReturnType<StateSnapshotService['getStateSnapshot']>,
      );
      // The compaction snapshot does NOT contain the archived task — exactly the
      // live store of a device that archived it.
      stateSnapshotSpy.getStateSnapshotForOperationLog.and.callFake(() =>
        createValidAppData(),
      );
      const validateSpy = jasmine.createSpyObj('ValidateStateService', [
        'validateAndRepairCurrentState',
      ]);
      validateSpy.validateAndRepairCurrentState.and.resolveTo(true);
      const archiveDbSpy = jasmine.createSpyObj('ArchiveDbAdapter', [
        'loadArchiveYoung',
        'loadArchiveOld',
      ]);
      archiveDbSpy.loadArchiveYoung.and.resolveTo(null);
      archiveDbSpy.loadArchiveOld.and.resolveTo(null);

      TestBed.configureTestingModule({
        providers: [
          OperationLogSyncService,
          OperationLogUploadService,
          OperationLogDownloadService,
          OperationLogCompactionService,
          OperationEncryptionService,
          OperationLogStoreService,
          LockService,
          VectorClockService,
          SchemaMigrationService,
          RemoteOpsProcessingService,
          SyncImportFilterService,
          // REAL conflict detection (the gate the stale op would slip through).
          ConflictResolutionService,
          provideMockStore({
            selectors: [
              { selector: selectSyncConfig, value: DEFAULT_GLOBAL_CONFIG.sync },
            ],
          }),
          { provide: OperationApplierService, useValue: applierSpy },
          { provide: SuperSyncStatusService, useValue: superSyncStatusSpy },
          { provide: ServerMigrationService, useValue: serverMigrationSpy },
          { provide: OperationWriteFlushService, useValue: writeFlushSpy },
          { provide: RejectedOpsHandlerService, useValue: rejectedOpsHandlerSpy },
          { provide: SyncHydrationService, useValue: syncHydrationSpy },
          { provide: StateSnapshotService, useValue: stateSnapshotSpy },
          { provide: ValidateStateService, useValue: validateSpy },
          { provide: ArchiveDbAdapter, useValue: archiveDbSpy },
          {
            provide: GlobalConfigService,
            useValue: { sync: () => ({ isUseSplitSyncFiles }) },
          },
          {
            provide: RepairOperationService,
            useValue: jasmine.createSpyObj('RepairOperationService', [
              'createRepairOperation',
            ]),
          },
          {
            provide: SnackService,
            useValue: jasmine.createSpyObj('SnackService', [
              'open',
              'hasPendingPersistentAction',
            ]),
          },
          { provide: MatDialog, useValue: dialogSpy },
          { provide: UserInputWaitStateService, useValue: waitServiceSpy },
          {
            provide: TranslateService,
            useValue: jasmine.createSpyObj('TranslateService', ['instant']),
          },
          {
            provide: OperationLogEffects,
            useValue: { processDeferredActions: () => Promise.resolve() },
          },
        ],
      });

      syncService = TestBed.inject(OperationLogSyncService);
      compactionService = TestBed.inject(OperationLogCompactionService);
      opLogStore = TestBed.inject(OperationLogStoreService);

      // One adapter service per device, as in production; one shared remote.
      remote = new MockFileProvider(SyncProviderId.WebDAV);
      const injector = TestBed.inject(EnvironmentInjector);
      newAdapter = (): OperationSyncCapable =>
        runInInjectionContext(
          injector,
          () => new FileBasedSyncAdapterService(),
        ).createAdapter(remote, FILE_CFG, undefined);
      linux = newAdapter();
      android = newAdapter();

      await opLogStore.init();
      await opLogStore._clearAllDataForTesting();
      resetTestUuidCounter();
      clearDeferredActions();
      ownClientId = await TestBed.inject(CLIENT_ID_PROVIDER).getOrGenerateClientId();
    });

    afterEach(() => {
      clearAdapterLocalStorage();
    });

    /** Linux created the sync file earlier, so it carries a real cursor. */
    const seedRemoteFromLinux = async (): Promise<void> => {
      await linuxUploads(
        taskOp(
          'linux-seed',
          ownClientId,
          ActionType.TASK_SHARED_ADD,
          OpType.Create,
          'linux-seed-task',
          { actionPayload: {}, entityChanges: [] },
          { [ownClientId]: 1 },
        ),
      );
    };

    for (const compactField of ['a', 'o'] as const) {
      it(`blocks missing compact ${compactField} before snapshot hydration and preserves it against writes`, async () => {
        const malformed = otherAddTask('missing-vocabulary', 'malformed-task', {
          [OTHER]: 1,
        });
        const later = otherAddTask('after-malformed', 'later-task', { [OTHER]: 2 });
        await androidUploads(malformed, later);
        const file = isUseSplitSyncFiles ? 'sync-ops.json' : 'sync-data.json';
        const handler = new EncryptAndCompressHandlerService();
        const { data, modelVersion } = await handler.decompressAndDecrypt<{
          recentOps: { id: string; a?: unknown; o?: unknown }[];
        }>({
          dataStr: (await remote.downloadFile(file)).dataStr,
          isEncryptExpected: false,
        });
        const retained = data.recentOps.find((op) => op.id === malformed.id);
        expect(retained).toBeDefined();
        delete retained![compactField];
        const malformedFile = await handler.compressAndEncryptData(
          FILE_CFG,
          undefined,
          data,
          modelVersion,
        );
        remote.setFileContent(file, malformedFile);
        const rev = await remote.getFileRev(file, null);
        const cursor = await linux.getLastServerSeq();
        const persistedBefore = Object.keys(localStorage)
          .filter((key) => key.startsWith('FILE_SYNC_VERSION_'))
          .map((key) => [key, localStorage.getItem(key)]);
        expect((await syncService.downloadRemoteOps(linux)).kind).toBe(
          'blocked_incompatible',
        );
        expect(
          TestBed.inject(SyncHydrationService).hydrateFromRemoteSync,
        ).not.toHaveBeenCalled();
        expect(await opLogStore.hasOp(malformed.id)).toBeFalse();
        expect(await opLogStore.hasOp(later.id)).toBeFalse();
        expect(appliedOpIdsPassedToApplier()).toEqual([]);
        expect(await linux.getLastServerSeq()).toBe(cursor);
        expect(
          Object.keys(localStorage)
            .filter((key) => key.startsWith('FILE_SYNC_VERSION_'))
            .map((key) => [key, localStorage.getItem(key)]),
        ).toEqual(persistedBefore);
        const local = otherAddTask('local-after-malformed', 'local-task', {
          [ownClientId]: 1,
        });
        for (const receiver of [linux, newAdapter()]) {
          await expectAsync(
            receiver.uploadOps([local], ownClientId),
          ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);
          expect(await remote.getFileRev(file, null)).toEqual(rev);
          expect((await remote.downloadFile(file)).dataStr).toBe(malformedFile);
        }
      });
    }

    it('blocks future vocabulary even inside a snapshot and preserves the remote revision', async () => {
      const future = {
        ...otherAddTask('future', 'future-task', { [OTHER]: 1 }),
        opType: 'FUTURE_FENCED_V1' as OpType,
      };
      const later = otherAddTask('later', 'later-task', { [OTHER]: 2 });
      await androidUploads(future, later);
      const cursor = await linux.getLastServerSeq();
      const file = isUseSplitSyncFiles ? 'sync-ops.json' : 'sync-data.json';
      const rev = await remote.getFileRev(file, null);
      const outcome = await syncService.downloadRemoteOps(linux);
      expect(outcome.kind).toBe('blocked_incompatible');
      expect(await linux.getLastServerSeq()).toBe(cursor);
      expect(await opLogStore.hasOp(future.id)).toBeFalse();
      expect(await opLogStore.hasOp(later.id)).toBeFalse();
      expect(appliedOpIdsPassedToApplier()).not.toContain(later.id);
      const local = otherAddTask('pending-local', 'local-task', { [ownClientId]: 1 });
      await expectAsync(linux.uploadOps([local], ownClientId)).toBeRejectedWithError(
        UploadRevToMatchMismatchAPIError,
      );
      expect(await remote.getFileRev(file, null)).toEqual(rev);
      // A restarted adapter has no pending revision cache; it must still refuse.
      await expectAsync(
        newAdapter().uploadOps([local], ownClientId),
      ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);
      expect(await remote.getFileRev(file, null)).toEqual(rev);
      // Test-only upgraded vocabulary. The production enum gains no new family.
      // Reducer application remains the harness boundary; the real receive/store/
      // revision/write pipeline must continue with the SAME retained operation.
      const upgradedVocabulary = KNOWN_OP_TYPES as Set<string>;
      upgradedVocabulary.add('FUTURE_FENCED_V1');
      try {
        const upgraded = newAdapter();
        expect((await syncService.downloadRemoteOps(upgraded)).kind).toBe(
          'ops_processed',
        );
        expect(await opLogStore.hasOp(future.id)).toBeTrue();
        expect(await opLogStore.hasOp(later.id)).toBeTrue();
        expect(await upgraded.getLastServerSeq()).toBeGreaterThan(cursor);
        await upgraded.uploadOps([local], ownClientId);
        const retry = await upgraded.downloadOps(0);
        expect(retry.ops.map(({ op }) => op.id)).toContain(future.id);
        expect(retry.ops.find(({ op }) => op.id === future.id)?.op.opType).toBe(
          future.opType,
        );
        expect(retry.ops.map(({ op }) => op.id)).toContain(later.id);
      } finally {
        upgradedVocabulary.delete('FUTURE_FENCED_V1');
      }
    });

    if (!isUseSplitSyncFiles) {
      it('keeps a future type durable until a forced server capability refresh', async () => {
        const pending = {
          ...otherAddTask('future-pending', 'future-task', { [ownClientId]: 1 }),
          clientId: ownClientId,
          opType: 'FUTURE_FENCED_V1' as OpType,
        };
        await opLogStore.append(pending, 'local');
        const getCapabilities = jasmine
          .createSpy('getServerSyncCapabilities')
          .and.callFake(async (options?: { forceRefresh?: boolean }) => ({
            kind: 'available',
            capabilities: {
              contractVersion: 1,
              supportedEntityTypes: ['TASK'],
              minSchemaVersion: 1,
              maxSchemaVersion: CURRENT_SCHEMA_VERSION,
              supportedOpTypes: options?.forceRefresh ? ['FUTURE_FENCED_V1'] : ['UPD'],
            },
          }));
        const upload = jasmine.createSpy('uploadOps').and.resolveTo({
          results: [{ opId: pending.id, accepted: true, serverSeq: 1 }],
          latestSeq: 1,
        });
        let cursor = 0;
        const api = {
          providerMode: 'superSyncOps',
          supportsOperationSync: true,
          requiresServerCapabilities: true,
          getServerSyncCapabilities: getCapabilities,
          getLastServerSeq: async () => cursor,
          setLastServerSeq: async (seq: number) => {
            cursor = seq;
          },
          getEncryptKey: async () => undefined,
          uploadOps: upload,
        } as unknown as OperationSyncCapable;
        expect((await syncService.uploadPendingOps(api)).kind).toBe(
          'blocked_server_incompatible',
        );
        expect(upload).not.toHaveBeenCalled();
        expect(cursor).toBe(0);
        expect((await opLogStore.getUnsynced()).map(({ op }) => op.id)).toContain(
          pending.id,
        );
        expect((await opLogStore.getOpById(pending.id))?.op).toEqual(pending);
        await syncService.uploadPendingOps(api, { forceCapabilityRefresh: true });
        expect(getCapabilities).toHaveBeenCalledWith({ forceRefresh: true });
        expect(upload).toHaveBeenCalledTimes(1);
        expect(upload.calls.mostRecent().args[0][0].id).toBe(pending.id);
        expect((await opLogStore.getUnsynced()).map(({ op }) => op.id)).not.toContain(
          pending.id,
        );
      });
      for (const field of ['opType', 'actionType'] as const) {
        for (const encrypted of [false, true]) {
          it(`blocks ${field} on paginated API download (encrypted=${encrypted})`, async () => {
            setArgon2ParamsForTesting({ memorySize: 256, iterations: 1, parallelism: 1 });
            try {
              const prefix = otherAddTask('api-prefix', 'api-prefix-task', {
                [OTHER]: 1,
              });
              const blocked = {
                ...otherAddTask('api-blocked', 'api-blocked-task', { [OTHER]: 2 }),
                [field]: 'FUTURE_FENCED_V1',
              } as Operation;
              const later = otherAddTask('api-later', 'api-later-task', { [OTHER]: 3 });
              let ops: SyncOperation[] = [prefix, blocked, later];
              if (encrypted)
                ops = await TestBed.inject(OperationEncryptionService).encryptOperations(
                  ops,
                  'test-password',
                );
              let cursor = 0;
              const download = jasmine
                .createSpy('downloadOps')
                .and.callFake(async (since: number) => ({
                  ops:
                    since === 0
                      ? [
                          { op: ops[0], serverSeq: 1, receivedAt: Date.now() },
                          { op: ops[1], serverSeq: 2, receivedAt: Date.now() },
                        ]
                      : [{ op: ops[2], serverSeq: 3, receivedAt: Date.now() }],
                  latestSeq: 3,
                  hasMore: since === 0,
                }));
              const api = {
                providerMode: 'superSyncOps',
                supportsOperationSync: true,
                getLastServerSeq: async () => cursor,
                setLastServerSeq: async (seq: number) => {
                  cursor = seq;
                },
                getEncryptKey: async () => (encrypted ? 'test-password' : undefined),
                downloadOps: download,
              } as unknown as OperationSyncCapable;
              expect((await syncService.downloadRemoteOps(api)).kind).toBe(
                'blocked_incompatible',
              );
              expect(cursor).toBe(0);
              expect(await opLogStore.hasOp(prefix.id)).toBeTrue();
              expect(await opLogStore.hasOp(blocked.id)).toBeFalse();
              expect(await opLogStore.hasOp(later.id)).toBeFalse();
              expect(appliedOpIdsPassedToApplier()).toEqual([prefix.id]);
              expect(download).toHaveBeenCalledTimes(2);
            } finally {
              clearSessionKeyCache();
              setArgon2ParamsForTesting();
            }
          });

          it(`blocks ${field} in API piggyback and leaves acknowledgements pending (encrypted=${encrypted})`, async () => {
            setArgon2ParamsForTesting({ memorySize: 256, iterations: 1, parallelism: 1 });
            try {
              const local = taskOp(
                'local-pending',
                ownClientId,
                ActionType.TASK_SHARED_ADD,
                OpType.Create,
                'local-task',
                { actionPayload: {}, entityChanges: [] },
                { [ownClientId]: 1 },
              );
              await opLogStore.append(local, 'local');
              const prefix = otherAddTask('piggy-prefix', 'piggy-prefix-task', {
                [OTHER]: 1,
              });
              const blocked = {
                ...otherAddTask('piggy-blocked', 'piggy-blocked-task', { [OTHER]: 2 }),
                [field]: 'FUTURE_FENCED_V1',
              } as Operation;
              const later = otherAddTask('piggy-later', 'piggy-later-task', {
                [OTHER]: 3,
              });
              let ops: SyncOperation[] = [prefix, blocked, later];
              if (encrypted)
                ops = await TestBed.inject(OperationEncryptionService).encryptOperations(
                  ops,
                  'test-password',
                );
              let cursor = 0;
              const upload = jasmine.createSpy('uploadOps').and.resolveTo({
                results: [{ opId: local.id, accepted: true, serverSeq: 4 }],
                latestSeq: 5,
                hasMorePiggyback: true,
                newOps: ops.map((op, index) => ({
                  op,
                  serverSeq: index + 1,
                  receivedAt: Date.now(),
                })),
              });
              const api = {
                providerMode: 'superSyncOps',
                supportsOperationSync: true,
                getLastServerSeq: async () => cursor,
                setLastServerSeq: async (seq: number) => {
                  cursor = seq;
                },
                getEncryptKey: async () => (encrypted ? 'test-password' : undefined),
                uploadOps: upload,
              } as unknown as OperationSyncCapable;
              expect((await syncService.uploadPendingOps(api)).kind).toBe(
                'blocked_incompatible',
              );
              expect(cursor).toBe(0);
              expect(await opLogStore.hasOp(prefix.id)).toBeTrue();
              expect(await opLogStore.hasOp(blocked.id)).toBeFalse();
              expect(await opLogStore.hasOp(later.id)).toBeFalse();
              expect((await opLogStore.getUnsynced()).map(({ op }) => op.id)).toContain(
                local.id,
              );
              expect(appliedOpIdsPassedToApplier()).toEqual([prefix.id]);
            } finally {
              clearSessionKeyCache();
              setArgon2ParamsForTesting();
            }
          });
        }
      }
    }

    const runArchivedTaskScenario = async (): Promise<void> => {
      const oneHourMs = 60 * 60 * 1000;
      const nowSpy = spyOn(Date, 'now').and.returnValue(
        new Date().getTime() - COMPACTION_RETENTION_MS - oneHourMs,
      );
      // Installed client: carries a state cache from an earlier compaction.
      expect(await compactionService.compact()).toBeTrue();
      await seedRemoteFromLinux();

      // 1. Android creates the repeat instance; Linux downloads + applies it.
      await androidUploads(
        otherAddTask('android-add-old', ARCHIVED_TASK_ID, { [OTHER]: 1 }),
      );
      expect((await syncService.downloadRemoteOps(linux)).kind).toBe('ops_processed');
      expect(appliedOpIdsPassedToApplier()).toContain('android-add-old');
      expect(await opLogStore.hasOp('android-add-old')).toBeTrue();

      // 2. Linux archives it and uploads the archive op (synced).
      const archiveOp = taskOp(
        'linux-archive',
        ownClientId,
        ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        OpType.Update,
        ARCHIVED_TASK_ID,
        { actionPayload: { tasks: [{ id: ARCHIVED_TASK_ID }] }, entityChanges: [] },
        { [OTHER]: 1, [ownClientId]: 2 },
      );
      const archiveSeq = await opLogStore.appendWithVectorClockOverwrite(
        archiveOp,
        'local',
      );
      await linuxUploads(archiveOp);
      await opLogStore.markSynced([archiveSeq]);
      nowSpy.and.callThrough();

      // 3. Normal traffic continues; a recent op keeps the client "synced".
      await androidUploads(
        otherAddTask('android-add-recent', 'other-task', {
          [OTHER]: 2,
          [ownClientId]: 2,
        }),
      );
      expect((await syncService.downloadRemoteOps(linux)).kind).toBe('ops_processed');

      // 4. Real compaction with the production 7-day retention.
      expect(await compactionService.compact()).toBeTrue();
      expect(await opLogStore.hasOp('android-add-old')).toBeFalse();
      expect(await opLogStore.hasOp('linux-archive')).toBeFalse();
      // Local clock still covers the pruned create op.
      expect((await opLogStore.getVectorClock())?.[OTHER]).toBe(2);

      // 5. Any later change on Android rewrites the file; the whole buffer
      // (still containing the old create op) is downloaded again.
      await androidUploads(
        otherAddTask('android-add-new', 'new-task', { [OTHER]: 3, [ownClientId]: 2 }),
      );
      applierSpy.applyOperations.calls.reset();
      await syncService.downloadRemoteOps(linux);
    };

    it('does not re-apply another device’s old create op for a task this device archived, after compaction pruned it', async () => {
      await runArchivedTaskScenario();

      // The genuinely new op must apply; the old create for the archived task must not.
      expect(appliedOpIdsPassedToApplier()).toContain('android-add-new');
      expect(appliedOpIdsPassedToApplier()).not.toContain('android-add-old');
      expect(appliedOpIdsPassedToApplier()).not.toContain('android-add-recent');
    });

    it('control: the same re-delivered op is skipped when the task is still active', async () => {
      stateSnapshotSpy.getStateSnapshotForOperationLog.and.callFake(() => {
        const data = createValidAppData();
        return {
          ...data,
          task: {
            ...data.task,
            ids: [ARCHIVED_TASK_ID],
            entities: { [ARCHIVED_TASK_ID]: { id: ARCHIVED_TASK_ID } },
          },
        } as unknown as ReturnType<
          StateSnapshotService['getStateSnapshotForOperationLog']
        >;
      });
      await runArchivedTaskScenario();

      expect(appliedOpIdsPassedToApplier()).toContain('android-add-new');
      expect(appliedOpIdsPassedToApplier()).not.toContain('android-add-old');
    });

    it('retries an upload against unseen remote data before advancing the cursor', async () => {
      await seedRemoteFromLinux();
      await androidUploads(otherAddTask('android-unseen', 'unseen-task', { [OTHER]: 1 }));

      const localEdit = taskOp(
        'linux-edit',
        ownClientId,
        ActionType.TASK_SHARED_UPDATE,
        OpType.Update,
        'linux-seed-task',
        { actionPayload: {}, entityChanges: [] },
        { [ownClientId]: 2 },
      );
      await expectAsync(linuxUploads(localEdit)).toBeRejectedWithError(
        UploadRevToMatchMismatchAPIError,
      );
      expect(await linux.getLastServerSeq()).toBe(1);
      await syncService.downloadRemoteOps(linux);
      await linuxUploads(localEdit);
      expect(await linux.getLastServerSeq()).toBe(3);

      await androidUploads(
        otherAddTask('android-after', 'after-task', { [OTHER]: 2, [ownClientId]: 2 }),
      );
      await syncService.downloadRemoteOps(linux);

      expect(appliedOpIdsPassedToApplier()).toContain('android-unseen');
      expect(appliedOpIdsPassedToApplier()).toContain('android-after');
    });

    // #10239 (operation-log-architecture.md B.2): an author whose own
    // counter regressed (USE_REMOTE onto a stale USE_LOCAL snapshot) re-uses a
    // counter this device already covers. If an own upload also merged that op
    // past the cursor, cursor + clock both say "delivered".
    const DESKTOP = 'desktop-client';

    /** Android authors counters 1 and 2; Linux applies both (clock covers A:2). */
    const linuxAppliesAndroidCounters1And2 = async (): Promise<void> => {
      await seedRemoteFromLinux();
      await androidUploads(
        otherAddTask('android-1', 'task-1', { [OTHER]: 1 }),
        otherAddTask('android-2', 'task-2', { [OTHER]: 2 }),
      );
      await syncService.downloadRemoteOps(linux);
      expect(appliedOpIdsPassedToApplier()).toContain('android-2');
      expect((await opLogStore.getVectorClock())?.[OTHER]).toBe(2);
    };

    const regressAndroidCounterViaUseLocalUseRemote = async (): Promise<void> => {
      // Desktop only knew A:1 and picks USE_LOCAL: snapshot replaces the file.
      const desktop = newAdapter();
      await desktop.downloadOps(0, DESKTOP);
      await desktop.uploadSnapshot(
        createValidAppData(),
        DESKTOP,
        'recovery',
        { [OTHER]: 1, [DESKTOP]: 1 },
        CURRENT_SCHEMA_VERSION,
        false,
        'desktop-import',
      );
      // Android picks USE_REMOTE: its clock resets to the snapshot's, so its
      // next op re-uses counter 2 — a genuinely new op.
      await android.downloadOps(0, OTHER);
      await androidUploads(
        otherAddTask('android-after-reset', 'task-after-reset', {
          [OTHER]: 2,
          [DESKTOP]: 1,
        }),
      );
    };

    /** Reject the unseen baseline; the next download must still deliver its ops. */
    const expectLinuxStillGetsRegressedOpAfterUpload = async (
      localCounter = 2,
    ): Promise<void> => {
      const path = isUseSplitSyncFiles ? 'sync-ops.json' : 'sync-data.json';
      const before = remote.getFileContent(path);
      const cursor = await linux.getLastServerSeq();
      await expectAsync(
        linuxUploads(
          taskOp(
            'linux-edit',
            ownClientId,
            ActionType.TASK_SHARED_UPDATE,
            OpType.Update,
            'linux-seed-task',
            { actionPayload: {}, entityChanges: [] },
            { [OTHER]: 2, [ownClientId]: localCounter },
          ),
        ),
      ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);
      expect(await linux.getLastServerSeq()).toBe(cursor);
      expect(remote.getFileContent(path)).toEqual(before);

      // No later Android write is needed to get past the rev pre-check: the
      // rejected upload must not mark the unseen rev as already downloaded.
      const downloaded = await TestBed.inject(
        OperationLogDownloadService,
      ).downloadRemoteOps(linux);
      expect(downloaded.success).toBeTrue();
      expect(downloaded.newOps.map((op) => op.id)).toContain('android-after-reset');
    };

    it('keeps a same-version replacement pending after USE_LOCAL/USE_REMOTE', async () => {
      await linuxAppliesAndroidCounters1And2();
      await regressAndroidCounterViaUseLocalUseRemote();

      // Linux uploads without downloading first: the cursor passes that op.
      // Needs a cold in-cycle cache (a warm one fails the rev check). In
      // production: the Dropbox/OneDrive rev pre-check (no cache fill), a
      // same-cycle re-upload after the cache was cleared (only when a local op
      // was created mid-cycle), or a >30s cycle. Expiring the cache stands in
      // for all three.
      const realNow = Date.now();
      spyOn(Date, 'now').and.returnValue(realNow + 60_000);
      await expectLinuxStillGetsRegressedOpAfterUpload();
    });

    // The same gap inside ONE normal sync cycle, no expired cache: on
    // Dropbox/OneDrive an unchanged rev short-circuits the download without
    // filling the in-cycle cache, so the upload right after re-reads the file
    // and merges whatever landed in between.
    it('keeps the unseen rev pending within one Dropbox sync cycle', async () => {
      remote = new MockFileProvider(SyncProviderId.Dropbox);
      linux = newAdapter();
      android = newAdapter();
      await linuxAppliesAndroidCounters1And2();

      // Next sync cycle (minutes later): the previous cycle's cache is gone.
      const realNow = Date.now();
      spyOn(Date, 'now').and.returnValue(realNow + 60_000);
      remote.clearHistory();
      expect((await syncService.downloadRemoteOps(linux)).kind).toBe('no_new_ops');
      expect(remote.getCallsTo('getFileRev').length).toBe(1);
      expect(remote.getCallsTo('downloadFile').length).toBe(0);

      // Within the same cycle (time frozen), before Linux's upload step.
      await regressAndroidCounterViaUseLocalUseRemote();
      await expectLinuxStillGetsRegressedOpAfterUpload();
    });

    it('rejects a second upload against unseen data after the first cleared its cache', async () => {
      await linuxAppliesAndroidCounters1And2();
      await linuxUploads(
        taskOp(
          'linux-first-edit',
          ownClientId,
          ActionType.TASK_SHARED_UPDATE,
          OpType.Update,
          'linux-seed-task',
          { actionPayload: {}, entityChanges: [] },
          { [OTHER]: 2, [ownClientId]: 2 },
        ),
      );
      await regressAndroidCounterViaUseLocalUseRemote();
      await expectLinuxStillGetsRegressedOpAfterUpload(3);
    });
  });
}
