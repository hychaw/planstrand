import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { clearSessionKeyCache, setArgon2ParamsForTesting } from '@sp/sync-core';
import { SUPER_SYNC_OPERATION_CAPABILITIES } from '@sp/shared-schema';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationLogUploadService } from '../../op-log/sync/operation-log-upload.service';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { SnackService } from '../../core/snack/snack.service';
import {
  OperationSyncCapable,
  SyncOperation,
} from '../../op-log/sync-providers/provider.interface';
import { SyncServerIncompatibleError } from '../../op-log/core/errors/sync-errors';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import { FileBasedSyncTestHarness } from '../../op-log/testing/integration/helpers/file-based-sync-test-harness';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { syncOpToOperation } from '../../op-log/sync/operation-sync.util';
import { CURRENT_SCHEMA_VERSION } from '../../op-log/persistence/schema-migration.service';
import { extractEntityKeysFromState } from '../../op-log/persistence/extract-entity-keys';
import {
  addTaskToAppData,
  createValidAppData,
  createValidTask,
} from '../../op-log/validation/state-validity-test-utils';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import {
  addWorkSession,
  updateWorkSession,
  removeWorkSession,
} from './store/work-session.actions';
import {
  legacyTaskWorkSessionId,
  backfillLegacyTaskWorkSessions,
} from './legacy-task-work-session-backfill';
import {
  initialWorkSessionState,
  workSessionReducer,
} from './store/work-session.reducer';
import { WorkSession } from './work-session.model';
import { AppDataComplete } from '../../op-log/model/model-config';
import { Operation } from '../../op-log/core/operation.types';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import {
  BulkReplayReducerFailure,
  runWithBulkReplayFailureCollector,
} from '../../op-log/apply/bulk-replay-failure-collector';
import { projectLocalCalendarDisplayItems } from '../schedule/calendar-display-item';

const session: WorkSession = {
  id: 'session-1',
  taskId: 'task-1',
  start: 100,
  end: 200,
  timeZone: 'America/Vancouver',
  completedAt: 250,
  created: 50,
  modified: 250,
};
const appData = (): AppDataComplete =>
  addTaskToAppData(
    createValidAppData({
      workSession: { ids: [session.id], entities: { [session.id]: session } },
    }),
    createValidTask('task-1'),
  );

describe('WorkSession persistence and API capability integration', () => {
  let log: OperationLogStoreService;
  let upload: OperationLogUploadService;
  let encryption: OperationEncryptionService;
  let provider: jasmine.SpyObj<OperationSyncCapable>;
  let supported: boolean;
  let missing: boolean;
  let received: SyncOperation[];

  beforeEach(async () => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
    clearSessionKeyCache();
    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        {
          provide: StateSnapshotService,
          useValue: { getStateSnapshotForOperationLog: appData },
        },
        {
          provide: SyncProviderManager,
          useValue: { assertSyncEpochUnchanged: () => undefined },
        },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: { loadClientId: async () => 'client-local' },
        },
        { provide: SnackService, useValue: { open: () => undefined } },
      ],
    });
    log = TestBed.inject(OperationLogStoreService);
    upload = TestBed.inject(OperationLogUploadService);
    encryption = TestBed.inject(OperationEncryptionService);
    await log.init();
    await log._clearAllDataForTesting();
    supported = true;
    missing = false;
    received = [];
    provider = jasmine.createSpyObj<OperationSyncCapable>('API provider', [
      'getServerSyncCapabilities',
      'getLastServerSeq',
      'setLastServerSeq',
      'uploadOps',
      'downloadOps',
      'getEncryptKey',
    ]);
    provider.supportsOperationSync = true;
    provider.providerMode = 'superSyncOps';
    Object.defineProperty(provider, 'requiresServerCapabilities', { value: true });
    Object.defineProperty(provider, 'isEncryptionMandatory', { value: true });
    provider.getLastServerSeq.and.resolveTo(0);
    (provider.getEncryptKey as jasmine.Spy).and.resolveTo('phase-one-test-key');
    (provider.getServerSyncCapabilities as jasmine.Spy).and.callFake(async () =>
      missing
        ? { kind: 'missing' }
        : {
            kind: 'available',
            capabilities: {
              ...SUPER_SYNC_OPERATION_CAPABILITIES,
              supportedEntityTypes: supported
                ? [...SUPER_SYNC_OPERATION_CAPABILITIES.supportedEntityTypes]
                : ['TASK'],
            },
          },
    );
    provider.uploadOps.and.callFake(async (ops) => {
      received.push(...ops);
      return {
        results: ops.map((op) => ({ opId: op.id, accepted: true })),
        latestSeq: received.length,
        newOps: [],
      };
    });
    provider.downloadOps.and.callFake(async () => ({
      ops: received.map((op, i) => ({ op, serverSeq: i + 1, receivedAt: 300 })),
      latestSeq: received.length,
      hasMore: false,
    }));
  });
  afterEach(async () => {
    await log._clearAllDataForTesting();
    setArgon2ParamsForTesting();
    clearSessionKeyCache();
  });

  const persist = async (): Promise<Operation> => {
    const action = addWorkSession({ workSession: session });
    const client = new TestClient('client-local');
    const op = client.createOperation({
      actionType: action.type,
      entityType: action.meta.entityType,
      entityId: session.id,
      opType: action.meta.opType,
      payload: { actionPayload: { workSession: session }, entityChanges: [] },
    });
    await log.append(op, 'local');
    return op;
  };

  it('uploads encrypted WORK_SESSION and lets a second client decrypt and replay it', async () => {
    await persist();
    expect(SUPER_SYNC_OPERATION_CAPABILITIES.supportedEntityTypes).toContain(
      'WORK_SESSION',
    );
    await upload.uploadPendingOps(provider);
    expect(received.length).toBe(1);
    expect(received[0].isPayloadEncrypted).toBeTrue();
    expect(typeof received[0].payload).toBe('string');
    const downloaded = await provider.downloadOps(0);
    const decoded = await encryption.decryptOperation(
      downloaded.ops[0].op,
      'phase-one-test-key',
    );
    const replayed = workSessionReducer(
      initialWorkSessionState,
      convertOpToAction(syncOpToOperation(decoded)),
    );
    expect(replayed.entities[session.id]).toEqual(session);
    expect(await log.getUnsynced()).toEqual([]);
  });

  it('retains an authoritative migrated seed through encrypted upload and replay', async () => {
    const legacySession = {
      ...session,
      id: legacyTaskWorkSessionId(session.taskId, session.start),
    };
    const action = updateWorkSession({
      id: legacySession.id,
      changes: { start: 300, end: 450 },
      modified: 500,
      legacySession,
    });
    const { type, meta, ...actionPayload } = action;
    const op = new TestClient('client-local').createOperation({
      actionType: type,
      entityType: meta.entityType,
      entityId: legacySession.id,
      opType: meta.opType,
      payload: { actionPayload, entityChanges: [] },
    });
    await log.append(op, 'local');
    await upload.uploadPendingOps(provider);
    expect(received.length).toBe(1);
    expect(received[0].isPayloadEncrypted).toBeTrue();
    const downloaded = await provider.downloadOps(0);
    const decoded = await encryption.decryptOperation(
      downloaded.ops[0].op,
      'phase-one-test-key',
    );
    const replayOp = syncOpToOperation(decoded);
    expect(replayOp.payload).toEqual(op.payload);
    const replayed = bulkOperationsMetaReducer(workSessionReducer)(
      initialWorkSessionState,
      bulkApplyOperations({ operations: [replayOp], localClientId: 'receiver' }),
    );
    expect(replayed.entities[legacySession.id]).toEqual({
      ...legacySession,
      start: 300,
      end: 450,
      modified: 500,
    });
    expect(await log.getUnsynced()).toEqual([]);
  });

  it('keeps a reducer-rejected future remote operation durable without downgrading its payload', async () => {
    const future = { ...session, source: 'future-contract' };
    const action = addWorkSession({ workSession: future });
    const op = new TestClient('remote-client').createOperation({
      actionType: action.type,
      entityType: 'WORK_SESSION',
      entityId: session.id,
      opType: action.meta.opType,
      payload: { actionPayload: { workSession: future }, entityChanges: [] },
    });
    await log.append(op, 'remote', { pendingApply: true });
    const failures: BulkReplayReducerFailure[] = [];
    const reducer = bulkOperationsMetaReducer(workSessionReducer);
    const result = runWithBulkReplayFailureCollector(
      (failure) => failures.push(failure),
      () =>
        reducer(
          initialWorkSessionState,
          bulkApplyOperations({ operations: [op], localClientId: 'client-local' }),
        ),
    );
    expect(result).toBe(initialWorkSessionState);
    expect(failures.length).toBe(1);
    expect(failures[0].op).toBe(op);
    expect(failures[0].error.message).toBe('Invalid WorkSession');
    await log.markReducersCommittedAndMergeClocks(
      [],
      [],
      failures.map((failure) => failure.op.id),
    );
    const stored = await log.getOpById(op.id);
    expect(stored!.reducerRejectedAt).toBeDefined();
    expect(stored!.op.payload).toEqual(op.payload);
    expect(future.source).toBe('future-contract');
  });

  it('keeps local operations durable and pending on incompatible or missing-capability servers', async () => {
    const op = await persist();
    const local = workSessionReducer(initialWorkSessionState, convertOpToAction(op));
    expect(local.entities[session.id]).toEqual(session);
    for (const noAdvertisement of [false, true]) {
      supported = false;
      missing = noAdvertisement;
      await expectAsync(upload.uploadPendingOps(provider)).toBeRejectedWithError(
        SyncServerIncompatibleError,
      );
      expect(received).toEqual([]);
      expect((await log.getUnsynced()).map((entry) => entry.op.id)).toEqual([op.id]);
    }
  });

  it('uploads the same pending operation after a manual refresh observes a server upgrade', async () => {
    const op = await persist();
    supported = false;
    await expectAsync(upload.uploadPendingOps(provider)).toBeRejectedWithError(
      SyncServerIncompatibleError,
    );
    supported = true;
    await upload.uploadPendingOps(provider, { forceCapabilityRefresh: true });
    expect(provider.getServerSyncCapabilities).toHaveBeenCalledWith({
      forceRefresh: true,
    });
    expect(received.map((item) => item.id)).toEqual([op.id]);
    expect(await log.getUnsynced()).toEqual([]);
  });

  it('survives durable replay, snapshot restart and recovery-point storage', async () => {
    await persist();
    const entries = await log.getOpsAfterSeq(0);
    const replayed = workSessionReducer(
      initialWorkSessionState,
      convertOpToAction(entries[0].op),
    );
    const data = appData();
    data.workSession = replayed;
    await log.saveStateCache({
      state: data,
      lastAppliedOpSeq: entries[0].seq,
      vectorClock: entries[0].op.vectorClock,
      compactedAt: 300,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      snapshotEntityKeys: extractEntityKeysFromState(data),
    });
    const cached = await log.loadStateCache();
    const loaded = workSessionReducer(
      initialWorkSessionState,
      loadAllData({ appDataComplete: cached!.state as ReturnType<typeof appData> }),
    );
    expect(loaded).toEqual(replayed);
    expect(cached!.snapshotEntityKeys).toContain('WORK_SESSION:session-1');
    const recovery = await log.saveImportBackup(data, {
      reason: 'LOCAL_IMPORT',
      taskCount: 1,
    });
    const restored = await log.loadImportBackupById(recovery.backupId);
    expect((restored!.state as ReturnType<typeof appData>).workSession).toEqual(replayed);
  });

  it('persists and replays timezone updates through the existing operation envelope', async () => {
    const created = await persist();
    const action = updateWorkSession({
      id: session.id,
      changes: { timeZone: 'Asia/Singapore', start: 300, end: 400 },
      modified: 300,
    });
    const op = new TestClient('client-local').createOperation({
      actionType: action.type,
      entityType: action.meta.entityType,
      entityId: session.id,
      opType: action.meta.opType,
      payload: {
        actionPayload: {
          id: action.id,
          changes: action.changes,
          modified: action.modified,
        },
        entityChanges: [],
      },
    });
    await log.append(JSON.parse(JSON.stringify(op)), 'local');
    const stored = await log.getOpById(op.id);
    const initial = workSessionReducer(
      initialWorkSessionState,
      convertOpToAction(created),
    );
    const replayed = workSessionReducer(initial, convertOpToAction(stored!.op));
    expect(replayed.entities[session.id]).toEqual({
      ...session,
      timeZone: 'Asia/Singapore',
      start: 300,
      end: 400,
      modified: 300,
    });
  });

  it('persists one legacy removal and retains suppression across remote replay and snapshot restart', async () => {
    const data = appData();
    data.task.entities[session.taskId] = {
      ...data.task.entities[session.taskId]!,
      dueWithTime: session.start,
      timeEstimate: 100,
    };
    const id = legacyTaskWorkSessionId(session.taskId, session.start);
    data.workSession = { ids: [id], entities: { [id]: { ...session, id } } };
    const action = removeWorkSession({ id });
    const op = new TestClient('client-local').createOperation({
      actionType: action.type,
      entityType: action.meta.entityType,
      entityId: id,
      opType: action.meta.opType,
      payload: { actionPayload: { id }, entityChanges: [] },
    });
    await log.append(op, 'local');
    await upload.uploadPendingOps(provider);
    expect(received.length).toBe(1);
    const decoded = await encryption.decryptOperation(received[0], 'phase-one-test-key');
    const remote = convertOpToAction(syncOpToOperation(decoded));
    expect(remote.meta.isRemote).toBeTrue();
    data.workSession = workSessionReducer(data.workSession, remote);
    expect(data.workSession.ids).toEqual([]);
    expect(data.workSession.dismissedLegacySessionIds).toEqual([id]);
    expect(workSessionReducer(data.workSession, remote)).toBe(data.workSession);
    expect(await log.getUnsynced()).toEqual([]);
    const entries = await log.getOpsAfterSeq(0);
    expect(entries.length).toBe(1);
    await log.saveStateCache({
      state: data,
      lastAppliedOpSeq: entries[0].seq,
      vectorClock: op.vectorClock,
      compactedAt: 300,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      snapshotEntityKeys: extractEntityKeysFromState(data),
    });
    const cached = await log.loadStateCache();
    const hydrated = workSessionReducer(
      undefined,
      loadAllData({
        appDataComplete: cached!.state as AppDataComplete,
      }),
    );
    expect(hydrated.dismissedLegacySessionIds).toEqual([id]);
    expect(backfillLegacyTaskWorkSessions(data.task, hydrated, 'Asia/Singapore')).toBe(
      hydrated,
    );
    expect(data.task.entities[session.taskId]?.dueWithTime).toBe(session.start);
  });

  it('keeps an edited migrated block authoritative across both restart and explicit dismissal without losing other sessions', async () => {
    const data = appData();
    const task = {
      ...data.task.entities[session.taskId]!,
      dueWithTime: session.start,
      timeEstimate: 100,
    };
    data.task.entities[task.id] = task;
    const taskBefore = JSON.stringify(data.task);
    // The existing unrelated session must neither suppress nor prevent migration.
    data.workSession = backfillLegacyTaskWorkSessions(
      data.task,
      data.workSession,
      'America/Vancouver',
    );
    const id = legacyTaskWorkSessionId(task.id, task.dueWithTime);
    const display = (): ReturnType<typeof projectLocalCalendarDisplayItems> =>
      projectLocalCalendarDisplayItems(
        Object.values(data.workSession.entities).filter((s): s is WorkSession => !!s),
        data.task.entities,
        [task],
        data.workSession.dismissedLegacySessionIds,
      );
    expect(
      display()
        .map((item) => item.sourceId)
        .sort(),
    ).toEqual([id, session.id].sort());
    const client = new TestClient('client-local');
    const edit = updateWorkSession({
      id,
      changes: { start: 300, end: 450 },
      modified: 300,
    });
    const editOp = client.createOperation({
      actionType: edit.type,
      entityType: edit.meta.entityType,
      entityId: id,
      opType: edit.meta.opType,
      payload: {
        actionPayload: { id, changes: edit.changes, modified: edit.modified },
        entityChanges: [],
      },
    });
    await log.append(JSON.parse(JSON.stringify(editOp)), 'local');
    data.workSession = workSessionReducer(data.workSession, convertOpToAction(editOp));
    const restart = async (): Promise<void> => {
      const entries = await log.getOpsAfterSeq(0);
      await log.saveStateCache({
        state: data,
        lastAppliedOpSeq: entries[entries.length - 1].seq,
        vectorClock: entries[entries.length - 1].op.vectorClock,
        compactedAt: 500,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        snapshotEntityKeys: extractEntityKeysFromState(data),
      });
      const cached = await log.loadStateCache();
      data.workSession = workSessionReducer(
        undefined,
        loadAllData({ appDataComplete: cached!.state as AppDataComplete }),
      );
      const hydrated = data.workSession;
      expect(backfillLegacyTaskWorkSessions(data.task, hydrated, 'Asia/Tokyo')).toBe(
        hydrated,
      );
      expect(JSON.stringify(data.task)).toBe(taskBefore);
      expect(data.workSession.entities[session.id]).toEqual(session);
      expect(display().some((item) => item.sourceType === 'legacyTask')).toBeFalse();
    };
    await restart();
    expect(display().find((item) => item.sourceId === id)).toEqual(
      jasmine.objectContaining({ start: 300, end: 450, timeZone: 'America/Vancouver' }),
    );
    const remove = removeWorkSession({ id });
    const removeOp = client.createOperation({
      actionType: remove.type,
      entityType: remove.meta.entityType,
      entityId: id,
      opType: remove.meta.opType,
      payload: { actionPayload: { id }, entityChanges: [] },
    });
    await log.append(JSON.parse(JSON.stringify(removeOp)), 'local');
    data.workSession = workSessionReducer(data.workSession, convertOpToAction(removeOp));
    await restart();
    expect(data.workSession.dismissedLegacySessionIds).toEqual([id]);
    expect(display().map((item) => item.sourceId)).toEqual([session.id]);
    expect((await log.getOpsAfterSeq(0)).length).toBe(2); // Edit + removal; no backfill op.
  });
});

describe('WorkSession file-provider integration', () => {
  it('round-trips through the file adapter without an HTTP capability handshake', async () => {
    const harness = FileBasedSyncTestHarness.create({});
    try {
      harness.setMockState(appData());
      const first = harness.createClient('client-first');
      const second = harness.createClient('client-second');
      const op = first.createOp('WORK_SESSION', session.id, 'CRT', addWorkSession.type, {
        actionPayload: { workSession: session },
        entityChanges: [],
      });
      await first.uploadOps([op]);
      const downloaded = await second.downloadOps(0);
      expect(first.adapter.providerMode).toBe('fileSnapshotOps');
      expect(first.adapter.requiresServerCapabilities).not.toBeTrue();
      expect(
        (downloaded.snapshotState as ReturnType<typeof appData>).workSession,
      ).toEqual(appData().workSession);
      const replayed = workSessionReducer(
        initialWorkSessionState,
        convertOpToAction(syncOpToOperation(downloaded.ops[0].op)),
      );
      expect(replayed.entities[session.id]).toEqual(session);
    } finally {
      harness.reset();
    }
  });
});
