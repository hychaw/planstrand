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
import { addWorkSession } from './store/work-session.actions';
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

const session: WorkSession = {
  id: 'session-1',
  taskId: 'task-1',
  start: 100,
  end: 200,
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

  it('keeps a reducer-rejected future remote operation durable without downgrading its payload', async () => {
    const future = { ...session, timeZone: 'UTC' };
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
    expect(future.timeZone).toBe('UTC');
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
