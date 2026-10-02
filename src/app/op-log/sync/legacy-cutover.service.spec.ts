import { TestBed } from '@angular/core/testing';
import { ActionReducer, Store } from '@ngrx/store';
import {
  ENTITY_TYPES,
  SUPER_SYNC_OP_TYPES,
  isPlanningState,
  PLANNING_V1,
} from '@sp/shared-schema';
import { LegacyCutoverService } from './legacy-cutover.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SchemaMigrationService } from '../persistence/schema-migration.service';
import { OperationLogDownloadService } from './operation-log-download.service';
import { OperationLogUploadService } from './operation-log-upload.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { BackupService } from '../backup/backup.service';
import { LockService } from './lock.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { OperationLogHydratorService } from '../persistence/operation-log-hydrator.service';
import { TabSeqFrontierService } from '../persistence/tab-seq-frontier.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { SyncImportConflictGateService } from './sync-import-conflict-gate.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { OperationLogEffects } from '../capture/operation-log.effects';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
  extractFullStateFromPayload,
} from '../core/operation.types';
import { AppDataComplete, withDefaultModelSlices } from '../model/model-config';
import { AppStateSnapshot } from '../backup/state-snapshot.service';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { RootState } from '../../root-store/root-state';
import { createStateWithExistingTasks } from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import { taskReducer } from '../../features/tasks/store/task.reducer';
import { plannerReducer } from '../../features/planner/store/planner.reducer';
import { planningReducer } from '../../features/planning/store/planning.reducer';
import { removePlacement } from '../../features/planning/store/planning.actions';
import { taskSharedSchedulingMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer';
import { bulkOperationsMetaReducer } from '../apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../apply/bulk-hydration.action';
import { convertOpToAction } from '../apply/operation-converter.util';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { VectorClockService } from './vector-clock.service';

describe('bounded legacy cutover', () => {
  let service: LegacyCutoverService;
  let schemas: SchemaMigrationService;
  let live: AppDataComplete;
  let cache: {
    state: unknown;
    lastAppliedOpSeq: number;
    vectorClock: Record<string, number>;
    compactedAt: number;
    schemaVersion: number;
  };
  let rows: OperationLogEntry[];
  let download: jasmine.SpyObj<OperationLogDownloadService>;
  let upload: jasmine.SpyObj<OperationLogUploadService>;
  let replay: jasmine.SpyObj<RemoteOpsProcessingService>;
  let validation: jasmine.SpyObj<ValidateStateService>;
  let backup: jasmine.SpyObj<BackupService>;
  let remote: Operation[];
  let provider: OperationSyncCapable;
  let headSchema: number;

  const legacyOp = (id: string, day: string, taskIds: string[]): Operation => ({
    id,
    clientId: 'remote-client',
    vectorClock: { ['remote-client']: 2 },
    timestamp: 1000,
    schemaVersion: 4,
    actionType: ActionType.PLANNER_UPSERT_DAY,
    opType: OpType.Update,
    entityType: 'PLANNER',
    entityId: day,
    payload: { actionPayload: { day, taskIds }, entityChanges: [] },
  });

  beforeEach(() => {
    const root = createStateWithExistingTasks(['X', 'Y']);
    live = withDefaultModelSlices({
      task: root.tasks,
      project: root.projects,
      tag: root.tag,
      planner: { ...root.planner, days: { ['2026-10-08']: ['X'] } },
    });
    cache = {
      state: structuredClone(live),
      schemaVersion: 4,
      lastAppliedOpSeq: 0,
      vectorClock: { ['remote-client']: 1, ['local-client']: 1 },
      compactedAt: 1000,
    };
    rows = [];
    remote = [
      legacyOp('remove-old-day', '2026-10-08', []),
      legacyOp('new-day', '2026-10-09', ['X']),
    ];
    headSchema = 4;
    download = jasmine.createSpyObj('download', [
      'downloadRemoteOps',
      'hasUnseenRemoteOps',
    ]);
    download.hasUnseenRemoteOps.and.returnValue(false);
    download.downloadRemoteOps.and.callFake(async (_provider, opts) => {
      remote.forEach((op, i) => opts?.sourceServerSeqByOpId?.set(op.id, i + 1));
      return {
        success: true,
        providerMode: 'superSyncOps',
        newOps: remote,
        failedFileCount: 0,
        latestServerSeq: remote.length,
        allOpClocks: remote.map((op) => op.vectorClock),
      };
    });
    upload = jasmine.createSpyObj('upload', ['_uploadFullStateOpAsSnapshot']);
    upload._uploadFullStateOpAsSnapshot.and.resolveTo({
      accepted: false,
      error: 'pre-commit transport failure',
    });
    replay = jasmine.createSpyObj('replay', ['processRemoteOps']);
    replay.processRemoteOps.and.callFake(async (ops) => {
      const feature: ActionReducer<RootState> = (state, action) => ({
        ...state!,
        tasks: taskReducer(state!.tasks, action),
        planner: plannerReducer(state!.planner, action),
        planning: planningReducer(state!.planning, action),
      });
      const reducer = bulkOperationsMetaReducer(taskSharedSchedulingMetaReducer(feature));
      const before = {
        ...root,
        tasks: live.task,
        projects: live.project,
        tag: live.tag,
        planner: live.planner,
        planning: live.planning,
      } as RootState;
      const after = reducer(before, bulkApplyOperations({ operations: ops }));
      live = {
        ...live,
        task: after.tasks,
        planner: after.planner,
        tag: after.tag,
        planning: after.planning,
      };
      for (const op of ops)
        rows.push({
          op,
          seq: rows.length + 1,
          source: 'remote',
          appliedAt: 1000,
          syncedAt: 1000,
          applicationStatus: 'applied',
        });
      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp: false,
      };
    });
    validation = jasmine.createSpyObj('validation', ['validateState']);
    validation.validateState.and.resolveTo({ isValid: true, typiaErrors: [] });
    backup = jasmine.createSpyObj('backup', ['captureImportBackup']);
    backup.captureImportBackup.and.resolveTo({ backupId: 'recovery', savedAt: 1000 });
    const log = {
      loadStateCache: async () => cache,
      getUnsynced: async () =>
        rows.filter(
          (entry) =>
            entry.source === 'local' && !entry.syncedAt && entry.rejectedAt === undefined,
        ),
      getVectorClock: async () => cache.vectorClock,
      getAppliedOpIds: async () => new Set(rows.map((entry) => entry.op.id)),
      getOpsAfterSeq: async () => rows,
      getLastSeq: async () => rows.length,
      getPendingRemoteOps: async () => [],
      clearVectorClockCache: () => undefined,
      resetCompactionCounter: async () => undefined,
      deleteOpsWhere: async (predicate: (entry: OperationLogEntry) => boolean) => {
        rows = rows.filter((entry) => !predicate(entry));
      },
      saveStateCache: async (value: typeof cache) => {
        cache = value;
      },
      hasSyncedOps: async () => true,
      markSynced: async (seqs: number[]) => {
        rows.forEach((entry) => {
          if (seqs.includes(entry.seq)) entry.syncedAt = 1000;
        });
      },
      markRejected: async (ids: string[]) => {
        rows.forEach((entry) => {
          if (ids.includes(entry.op.id)) entry.rejectedAt = 1000;
        });
      },
      setVectorClock: async (clock: Record<string, number>) => {
        cache.vectorClock = clock;
      },
      pruneClockForStorage: async (clock: Record<string, number>) => clock,
      append: jasmine.createSpy('append').and.callFake(async (op: Operation) => {
        const seq = rows.length + 1;
        rows.push({ op, seq, source: 'local', appliedAt: 1000 });
        return seq;
      }),
    };
    provider = {
      providerMode: 'superSyncOps',
      requiresServerCapabilities: true,
      downloadOps: async () => ({
        ops: [{ op: { schemaVersion: headSchema } }],
        latestSeq: 2,
      }),
      getLastServerSeq: async () => 0,
      setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      getServerSyncCapabilities: async () => ({
        kind: 'available',
        capabilities: {
          contractVersion: 1,
          minSchemaVersion: 5,
          maxSchemaVersion: 5,
          supportedEntityTypes: [...ENTITY_TYPES],
          supportedOpTypes: [...SUPER_SYNC_OP_TYPES],
        },
      }),
    } as unknown as OperationSyncCapable;
    const exclusive = async <T>(run: () => Promise<T>): Promise<T> => run();
    TestBed.configureTestingModule({
      providers: [
        LegacyCutoverService,
        OperationLogCompactionService,
        SchemaMigrationService,
        {
          provide: OperationCaptureService,
          useValue: {
            hasUnrecoveredPersistFailure: () => false,
            getPendingCount: () => 0,
          },
        },
        {
          provide: VectorClockService,
          useValue: { getCurrentVectorClock: async () => cache.vectorClock },
        },
        {
          provide: Store,
          useValue: {
            dispatch: (action: ReturnType<typeof loadAllData>) => {
              live = action.appDataComplete as AppDataComplete;
            },
          },
        },
        { provide: OperationLogStoreService, useValue: log },
        {
          provide: StateSnapshotService,
          useValue: {
            getStateSnapshotForOperationLogAsync: async () => live as AppStateSnapshot,
            getStateSnapshotForOperationLog: () => live as AppStateSnapshot,
          },
        },
        { provide: OperationLogDownloadService, useValue: download },
        { provide: OperationLogUploadService, useValue: upload },
        { provide: RemoteOpsProcessingService, useValue: replay },
        { provide: ValidateStateService, useValue: validation },
        { provide: BackupService, useValue: backup },
        {
          provide: LockService,
          useValue: { request: async <T>(_key: string, run: () => Promise<T>) => run() },
        },
        {
          provide: OperationWriteFlushService,
          useValue: {
            flushPendingWrites: async () => undefined,
            flushThenRunExclusive: exclusive,
          },
        },
        {
          provide: HydrationStateService,
          useValue: {
            acquireApplyingRemoteOpsHold: () => () => undefined,
            isHydrationFallbackActive: () => false,
            isHydrationInProgress: () => false,
          },
        },
        {
          provide: OperationLogHydratorService,
          useValue: {
            hydrateStore: async () => {
              live = JSON.parse(JSON.stringify(cache.state)) as AppDataComplete;
            },
          },
        },
        {
          provide: TabSeqFrontierService,
          useValue: { isSaveSafeAt: () => true, hasKnownForeignWrites: () => false },
        },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: { loadClientId: async () => 'local-client' },
        },
        { provide: SyncImportConflictGateService, useValue: {} },
        {
          provide: SyncProviderManager,
          useValue: { assertSyncEpochUnchanged: () => undefined },
        },
        {
          provide: OperationLogEffects,
          useValue: { processDeferredActions: async () => undefined },
        },
      ],
    });
    service = TestBed.inject(LegacyCutoverService);
    schemas = TestBed.inject(SchemaMigrationService);
  });

  it('materializes the real legacy reducer tail before one projection and keeps the source schema 4', async () => {
    const project = spyOn(schemas, 'projectMaterializedLegacyState').and.callThrough();
    await expectAsync(service.tryCutover(provider)).toBeRejectedWithError(
      /pre-commit transport failure/,
    );
    expect(project).toHaveBeenCalledTimes(1);
    expect(replay.processRemoteOps).toHaveBeenCalledBefore(project);
    expect(backup.captureImportBackup).toHaveBeenCalledBefore(
      TestBed.inject(OperationLogStoreService).append as jasmine.Spy,
    );
    const checkpoint = rows.at(-1)!.op;
    const state = extractFullStateFromPayload(checkpoint.payload) as AppDataComplete;
    expect(state.planning!.entities['X']!.placement!.target.key).toBe('2026-10-09');
    expect(state.planning!.entities['X']!.revision.counter).toBe(0);
    expect(state.planning!.entities['X']!.revision.clientId).toBe('planstrand-migration');
    expect(cache.schemaVersion).toBe(4);
    expect(upload._uploadFullStateOpAsSnapshot).toHaveBeenCalledWith(
      provider,
      jasmine.any(Object),
      undefined,
      true,
      2,
    );
    expect(live.planning!.ids).toEqual([]);
  });

  it('includes current unsynced local legacy state in the frozen projection', async () => {
    live = {
      ...live,
      task: {
        ...live.task,
        entities: {
          ...live.task.entities,
          Y: { ...live.task.entities['Y']!, dueDay: '2026-10-12' },
        },
      },
    };
    rows.push({
      op: {
        ...legacyOp('local-edit', 'unused', []),
        clientId: 'local-client',
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityType: 'TASK',
        entityId: 'Y',
        payload: {
          actionPayload: { task: { id: 'Y', changes: { dueDay: '2026-10-12' } } },
          entityChanges: [],
        },
      },
      seq: 1,
      source: 'local',
      appliedAt: 1000,
    });
    await expectAsync(service.tryCutover(provider)).toBeRejectedWithError(
      /pre-commit transport failure/,
    );
    expect(
      (extractFullStateFromPayload(rows.at(-1)!.op.payload) as AppDataComplete).planning!
        .entities['Y']!.placement!.target.key,
    ).toBe('2026-10-12');
    expect(rows.some((entry) => entry.op.id === 'local-edit')).toBe(true);
  });

  for (const failure of [
    'download',
    'replay',
    'projection',
    'validation',
    'recovery',
  ] as const) {
    it(`${failure} failure retains the source and prevents any checkpoint upload`, async () => {
      if (failure === 'download')
        download.downloadRemoteOps.and.resolveTo({
          success: false,
          newOps: [],
          failedFileCount: 1,
          latestServerSeq: 0,
        });
      if (failure === 'replay')
        replay.processRemoteOps.and.rejectWith(new Error('replay failed'));
      if (failure === 'projection')
        spyOn(schemas, 'projectMaterializedLegacyState').and.throwError(
          'projection failed',
        );
      if (failure === 'validation')
        validation.validateState.and.resolveTo({ isValid: false, typiaErrors: [] });
      if (failure === 'recovery')
        backup.captureImportBackup.and.rejectWith(new Error('recovery failed'));
      await expectAsync(service.tryCutover(provider)).toBeRejected();
      expect(cache.schemaVersion).toBe(4);
      expect(rows.filter((entry) => entry.op.opType === OpType.SyncImport)).toEqual([]);
      expect(upload._uploadFullStateOpAsSnapshot).not.toHaveBeenCalled();
      expect(schemas.isMaterializingLegacyState).toBe(false);
    });
  }

  it('retries the immutable pending checkpoint without another projection or migration identity', async () => {
    const project = spyOn(schemas, 'projectMaterializedLegacyState').and.callThrough();
    await expectAsync(service.tryCutover(provider)).toBeRejected();
    const frozen = JSON.stringify(rows.at(-1)!.op);
    await expectAsync(service.tryCutover(provider)).toBeRejected();
    expect(project).toHaveBeenCalledTimes(1);
    expect(rows.filter((entry) => entry.op.opType === OpType.SyncImport).length).toBe(1);
    expect(JSON.stringify(rows.at(-1)!.op)).toBe(frozen);
    expect(cache.schemaVersion).toBe(4);
  });

  it('does not treat a compaction schema stamp as confirmed cutover', async () => {
    cache.schemaVersion = 5;
    await expectAsync(service.tryCutover(provider)).toBeRejectedWithError(
      /pre-commit transport failure/,
    );
    expect(download.downloadRemoteOps).toHaveBeenCalled();
    expect(cache.schemaVersion).toBe(4);
  });

  it('aborts a truncated complete-history pass before projection or checkpoint creation', async () => {
    download.hasUnseenRemoteOps.and.returnValue(true);
    const project = spyOn(schemas, 'projectMaterializedLegacyState').and.callThrough();
    await expectAsync(service.tryCutover(provider)).toBeRejectedWithError(
      /did not complete/,
    );
    expect(project).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it('does not treat uninterpretable retained operations as terminally migrated history', async () => {
    remote = [{ ...remote[0], actionType: '[Unknown] Future action' as ActionType }];
    await expectAsync(service.tryCutover(provider)).toBeRejectedWithError(
      /Unsupported legacy history operation/,
    );
    expect(rows).toEqual([]);
    expect(backup.captureImportBackup).not.toHaveBeenCalled();
  });

  it('leaves canonical schema-5 steady state alone', async () => {
    headSchema = 5;
    cache.schemaVersion = 5;
    const before = JSON.stringify(live);
    expect(await service.tryCutover(provider)).toBe(false);
    expect(download.downloadRemoteOps).not.toHaveBeenCalled();
    expect(JSON.stringify(live)).toBe(before);
  });

  it('binds retry to the prepared cursor even when the mutable provider cursor advances', async () => {
    await expectAsync(service.tryCutover(provider)).toBeRejected();
    const checkpoint = rows.at(-1)!.op;
    const frozen = JSON.stringify(checkpoint);
    provider.getLastServerSeq = jasmine.createSpy('latestCursor').and.resolveTo(99);
    upload._uploadFullStateOpAsSnapshot.and.resolveTo({ accepted: true, serverSeq: 100 });
    expect(await service.tryCutover(provider)).toBe(true);
    expect(provider.getLastServerSeq).not.toHaveBeenCalled();
    expect(upload._uploadFullStateOpAsSnapshot.calls.mostRecent().args[4]).toBe(2);
    expect(JSON.stringify(checkpoint)).toBe(frozen);
    expect(cache.schemaVersion).toBe(5);
    expect(provider.setLastServerSeq).toHaveBeenCalledWith(100);
    expect(rows.at(-1)!.syncedAt).toBeDefined();
  });

  it('retains a truly stale checkpoint for reconciliation without another automatic attempt', async () => {
    upload._uploadFullStateOpAsSnapshot.and.resolveTo({
      accepted: false,
      error: 'Download the latest full-state replacement before retrying',
      errorCode: 'INTERNAL_ERROR',
    });
    await expectAsync(service.tryCutover(provider)).toBeRejectedWithError(
      /reconciliation/,
    );
    expect(cache.schemaVersion).toBe(4);
    expect(rows.at(-1)!.rejectedAt).toBeDefined();
    expect(rows.at(-1)!.syncedAt).toBeUndefined();
    expect(provider.setLastServerSeq).not.toHaveBeenCalled();
    // Existing durable rejection metadata survives service recreation/restart.
    await expectAsync(service.tryCutover(provider)).toBeRejectedWithError(
      /reconciliation/,
    );
    expect(upload._uploadFullStateOpAsSnapshot).toHaveBeenCalledTimes(1);
    expect(backup.captureImportBackup).toHaveBeenCalledTimes(1);
  });

  it('retries a committed response loss with the same opId and prepared cursor', async () => {
    const committed = new Map<string, number>();
    let wipes = 0;
    upload._uploadFullStateOpAsSnapshot.and.callFake(
      async (_provider, entry, _key, _clean, base) => {
        expect(base).toBe(2);
        const prior = committed.get(entry.op.id);
        if (prior !== undefined) return { accepted: true, serverSeq: prior };
        wipes++;
        committed.set(entry.op.id, 3);
        return { accepted: false, error: 'response lost after commit' };
      },
    );
    await expectAsync(service.tryCutover(provider)).toBeRejectedWithError(
      /response lost/,
    );
    expect(cache.schemaVersion).toBe(4);
    const identity = rows.at(-1)!.op.id;
    headSchema = 5;
    expect(await service.tryCutover(provider)).toBe(true);
    expect(wipes).toBe(1);
    expect(rows.filter((entry) => entry.op.opType === OpType.SyncImport).length).toBe(1);
    expect(rows.at(-1)!.op.id).toBe(identity);
    expect(provider.setLastServerSeq).toHaveBeenCalledWith(3);
  });

  it('requires accepted confirmation with an authoritative sequence before local installation', async () => {
    upload._uploadFullStateOpAsSnapshot.and.resolveTo({ accepted: true });
    await expectAsync(service.tryCutover(provider)).toBeRejectedWithError(
      /missing authoritative server sequence/,
    );
    expect(cache.schemaVersion).toBe(4);
    expect(rows.at(-1)!.syncedAt).toBeUndefined();
    expect(provider.setLastServerSeq).not.toHaveBeenCalled();
  });

  it('requires the confirmed replacement sequence to exceed its prepared source cursor', async () => {
    upload._uploadFullStateOpAsSnapshot.and.resolveTo({ accepted: true, serverSeq: 2 });
    await expectAsync(service.tryCutover(provider)).toBeRejected();
    expect(cache.schemaVersion).toBe(4);
    expect(provider.setLastServerSeq).not.toHaveBeenCalled();
    expect(rows.at(-1)!.syncedAt).toBeUndefined();
  });

  it('keeps counter-1 unplanned X through confirmed cutover, reload, sync, compaction and reload', async () => {
    const project = spyOn(schemas, 'projectMaterializedLegacyState').and.callThrough();
    upload._uploadFullStateOpAsSnapshot.and.resolveTo({ accepted: true, serverSeq: 3 });
    expect(await service.tryCutover(provider)).toBe(true);
    expect(live.planning!.entities['X']!.revision.counter).toBe(0);
    const tombstone = {
      id: 'X',
      placement: null,
      revision: { counter: 1, clientId: 'local-client', opId: 'authored-unplan' },
    };
    live = {
      ...live,
      planning: planningReducer(live.planning, removePlacement({ record: tombstone })),
    };
    const unplan: Operation = {
      ...legacyOp('authored-unplan', '', []),
      schemaVersion: 5,
      clientId: 'local-client',
      opType: PLANNING_V1,
      actionType: ActionType.PLANNING_REMOVE,
      entityType: 'PLANNING',
      entityId: 'X',
      payload: { actionPayload: { record: tombstone }, entityChanges: [] },
    };
    rows.push({ op: unplan, seq: rows.length + 1, source: 'local', appliedAt: 1000 });
    cache.state = JSON.parse(JSON.stringify(live));
    headSchema = 5;
    // Reload the serialized authoritative state using the existing hydrate seam.
    await TestBed.inject(OperationLogHydratorService).hydrateStore();
    expect(await service.tryCutover(provider)).toBe(false);
    expect(live.planning!.entities['X']).toEqual(tombstone);
    expect(live.planner.days['2026-10-09']).toContain('X');
    // An ordinary schema-5 peer echoes the original operation; no replacement
    // or legacy projection is needed, and acknowledgement permits compaction.
    await replay.processRemoteOps([unplan]);
    rows.forEach((entry) => {
      entry.syncedAt = 1000;
    });
    expect(live.planning!.entities['X']).toEqual(tombstone);
    expect(await TestBed.inject(OperationLogCompactionService).compact()).toBe(true);
    expect(rows).toEqual([]);
    expect(cache.schemaVersion).toBe(5);
    await TestBed.inject(OperationLogHydratorService).hydrateStore();
    expect(await service.tryCutover(provider)).toBe(false);
    expect(live.planning!.entities['X']).toEqual(tombstone);
    expect(live.planner.days['2026-10-09']).toContain('X');
    expect(project).toHaveBeenCalledTimes(1);
    expect(isPlanningState(live.planning)).toBe(true);
  });

  it('fails ambiguous undated Today history instead of using timestamps or the replay day', async () => {
    const op: Operation = {
      ...legacyOp('undated-today', '', []),
      actionType: ActionType.TASK_SHARED_PLAN_FOR_TODAY,
      entityType: 'TASK',
      entityId: 'X',
      payload: {
        actionPayload: { taskIds: ['X'], parentTaskMap: {} },
        entityChanges: [],
      },
    };
    await expectAsync(
      schemas.materializeLegacy(async () => convertOpToAction(op)),
    ).toBeRejectedWithError(/recoverable date/);
    expect(schemas.isMaterializingLegacyState).toBe(false);
    expect(isPlanningState(live.planning)).toBe(true);
  });
});
