import { TestBed } from '@angular/core/testing';
import { Action, provideStore, Store } from '@ngrx/store';
import { GlobalConfigService } from '../config/global-config.service';
import { taskReducer } from '../tasks/store/task.reducer';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { RootState } from '../../root-store/root-state';
import { workSessionIntegrityMetaReducer } from '../../root-store/meta/work-session-integrity.meta-reducer';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { OperationApplierService } from '../../op-log/apply/operation-applier.service';
import { ArchiveOperationHandler } from '../../op-log/apply/archive-operation-handler.service';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { OperationLogEffects } from '../../op-log/capture/operation-log.effects';
import { PersistentAction } from '../../op-log/core/persistent-action.interface';
import { Operation } from '../../op-log/core/operation.types';
import { AppDataComplete } from '../../op-log/model/model-config';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationLogHydratorService } from '../../op-log/persistence/operation-log-hydrator.service';
import { OperationLogSnapshotService } from '../../op-log/persistence/operation-log-snapshot.service';
import { OperationLogMigrationService } from '../../op-log/persistence/operation-log-migration.service';
import { OperationLogRecoveryService } from '../../op-log/persistence/operation-log-recovery.service';
import { OperationLogCompactionService } from '../../op-log/persistence/operation-log-compaction.service';
import { ArchiveMigrationService } from '../../op-log/persistence/archive-migration.service';
import { SyncHydrationService } from '../../op-log/persistence/sync-hydration.service';
import { CURRENT_SCHEMA_VERSION } from '../../op-log/persistence/schema-migration.service';
import { TabSeqFrontierService } from '../../op-log/persistence/tab-seq-frontier.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { ValidateStateService } from '../../op-log/validation/validate-state.service';
import { validateFull } from '../../op-log/validation/validation-fn';
import { SnackService } from '../../core/snack/snack.service';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import {
  addTaskToAppData,
  appDataToRootState,
  createValidAppData,
  createValidTask,
} from '../../op-log/validation/state-validity-test-utils';
import { WorkSessionService } from './work-session.service';
import { selectWorkSessionFeatureState } from './store/work-session.selectors';
import { workSessionReducer } from './store/work-session.reducer';
import { WorkSession, WorkSessionState } from './work-session.model';
import {
  backfillLegacyTaskWorkSessions,
  legacyTaskWorkSessionId,
} from './legacy-task-work-session-backfill';

describe('migrated WorkSession replay before receiver materialization', () => {
  const task = { ...createValidTask('task-1'), dueWithTime: 100, timeEstimate: 100 };
  const id = legacyTaskWorkSessionId(task.id, 100);
  let store: Store<RootState>;
  let log: OperationLogStoreService;
  let base: AppDataComplete;
  let writes: jasmine.Spy;
  let service: WorkSessionService;
  let receiverZone: jasmine.Spy;
  const sender = new TestClient('sender');
  const snapshot = (): AppDataComplete => ({
    ...base,
    task: store.selectSignal(selectTaskFeatureState)(),
    workSession: store.selectSignal(selectWorkSessionFeatureState)(),
  });
  const sessions = (): WorkSessionState =>
    store.selectSignal(selectWorkSessionFeatureState)();

  beforeEach(async () => {
    base = addTaskToAppData(createValidAppData(), task);
    base.globalConfig = {
      ...base.globalConfig,
      localization: { ...base.globalConfig.localization, timeZone: 'Asia/Tokyo' },
    };
    receiverZone = jasmine
      .createSpy('receiverZone')
      .and.returnValue({ timeZone: 'Asia/Tokyo' });
    const rootReducer = (state = appDataToRootState(base), action: Action): RootState => {
      if (action.type === loadAllData.type) {
        const { appDataComplete } = action as ReturnType<typeof loadAllData>;
        return {
          ...state,
          ...appDataToRootState(appDataComplete as AppDataComplete),
          workSession: workSessionReducer(state.workSession, action),
        };
      }
      return {
        ...state,
        tasks: taskReducer(state.tasks, action),
        workSession: workSessionReducer(state.workSession, action),
      };
    };
    TestBed.configureTestingModule({
      providers: [
        provideStore<RootState>(undefined, {
          metaReducers: [
            bulkOperationsMetaReducer,
            workSessionIntegrityMetaReducer,
            () => rootReducer,
          ],
        }),
        { provide: GlobalConfigService, useValue: { localization: receiverZone } },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: { loadClientId: async () => 'receiver' },
        },
        {
          provide: StateSnapshotService,
          useValue: {
            getStateSnapshotForOperationLog: snapshot,
            getStateSnapshot: snapshot,
          },
        },
        {
          provide: OperationLogEffects,
          useValue: { processDeferredActions: async () => undefined },
        },
        {
          provide: ArchiveOperationHandler,
          useValue: { handleOperation: async () => undefined },
        },
        {
          provide: OperationLogMigrationService,
          useValue: { checkAndMigrate: async () => undefined },
        },
        {
          provide: ArchiveMigrationService,
          useValue: { migrateArchivesIfNeeded: async () => undefined },
        },
        {
          provide: OperationLogRecoveryService,
          useValue: {
            recoverPendingRemoteOps: () => log.getPendingRemoteOps(),
            cleanupCorruptOps: async () => undefined,
            attemptRecovery: jasmine.createSpy('unexpected recovery'),
          },
        },
        {
          provide: OperationLogCompactionService,
          useValue: { compactIfBloated: async () => undefined },
        },
        { provide: SyncHydrationService, useValue: {} },
        {
          provide: SnackService,
          useValue: { open: jasmine.createSpy('unexpected snack') },
        },
        {
          provide: ValidateStateService,
          useValue: {
            validateState: async (data: AppDataComplete) => {
              const result = validateFull(data);
              return {
                isValid: result.isValid,
                typiaErrors: [],
                crossModelError: result.crossModelError,
              };
            },
          },
        },
      ],
    });
    store = TestBed.inject(Store);
    writes = spyOn(store, 'dispatch').and.callThrough();
    service = TestBed.inject(WorkSessionService);
    log = TestBed.inject(OperationLogStoreService);
    await log.init();
    await log._clearAllDataForTesting();
    expect(validateFull(base).isValid).toBeTrue();
  });
  afterEach(async () => {
    await log._clearAllDataForTesting();
  });

  const senderOps = (
    intents: ('update' | 'complete' | 'uncomplete' | 'remove')[],
  ): Operation[] => {
    const materialized = backfillLegacyTaskWorkSessions(
      base.task,
      base.workSession,
      'America/Vancouver',
    );
    store.dispatch(
      loadAllData({ appDataComplete: { ...base, workSession: materialized } }),
    );
    const ops: Operation[] = [];
    for (const intent of intents) {
      writes.calls.reset();
      const success =
        intent === 'update'
          ? service.update(id, { start: 300, end: 450 })
          : intent === 'complete'
            ? service.complete(id, 250)
            : intent === 'uncomplete'
              ? service.uncomplete(id)
              : service.remove(id);
      expect(success).toBeTrue();
      expect(writes).toHaveBeenCalledTimes(1);
      const action = writes.calls.mostRecent().args[0] as PersistentAction;
      const { type: actionType, meta, ...actionPayload } = action;
      ops.push(
        JSON.parse(
          JSON.stringify(
            sender.createOperation({
              actionType,
              entityType: meta.entityType,
              entityId: id,
              opType: meta.opType,
              payload: {
                actionPayload,
                entityChanges: TestBed.inject(
                  OperationCaptureService,
                ).extractEntityChanges(action),
              },
            }),
          ),
        ),
      );
    }
    return ops;
  };
  const receive = async (
    ops: Operation[],
    hydration: boolean,
    dismissed = false,
  ): Promise<void> => {
    const data = {
      ...base,
      workSession: {
        ...base.workSession,
        ...(dismissed ? { dismissedLegacySessionIds: [id] } : {}),
      },
    };
    store.dispatch(loadAllData({ appDataComplete: data }));
    await log.saveStateCache({
      state: data,
      lastAppliedOpSeq: 0,
      vectorClock: {},
      compactedAt: 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    for (const op of ops) await log.append(op, 'remote', { pendingApply: true });
    receiverZone.calls.reset();
    writes.calls.reset();
    if (hydration) {
      await TestBed.inject(OperationLogHydratorService).hydrateStore();
      expect(
        TestBed.inject(OperationLogRecoveryService).attemptRecovery,
      ).not.toHaveBeenCalled();
    } else {
      const result = await TestBed.inject(OperationApplierService).applyOperations(ops);
      expect(result.appliedOps).toEqual(ops);
      expect(result.failedOp).toBeUndefined();
      await log.markReducersCommittedAndMergeClocks(
        (await log.getOpsAfterSeq(0)).map((entry) => entry.seq),
        ops,
      );
      TestBed.inject(TabSeqFrontierService).establishFrontier(await log.getLastSeq());
    }
    expect(receiverZone).not.toHaveBeenCalled();
    expect(
      writes.calls
        .allArgs()
        .some(([action]) => (action as PersistentAction).meta?.isPersistent),
    ).toBeFalse();
    expect((await log.getOpsAfterSeq(0)).length).toBe(ops.length);
    expect(validateFull(snapshot()).isValid).toBeTrue();
  };
  const assertStableRestart = async (): Promise<void> => {
    const before = sessions();
    expect(backfillLegacyTaskWorkSessions(base.task, before, 'Asia/Tokyo')).toBe(before);
    expect(
      await TestBed.inject(OperationLogSnapshotService).saveCurrentStateAsSnapshot(),
    ).toBeTrue();
    const cache = await log.loadStateCache();
    store.dispatch(loadAllData({ appDataComplete: cache!.state as AppDataComplete }));
    expect(sessions()).toEqual(before);
    await TestBed.inject(OperationLogHydratorService).hydrateStore();
    expect(sessions()).toEqual(before);
    expect(snapshot().task).toEqual(base.task);
  };

  const withSeedOwner = (ops: Operation[], taskId: string): Operation[] =>
    ops.map((op) => {
      const payload = op.payload as {
        actionPayload: { legacySession: WorkSession };
      };
      return {
        ...op,
        payload: {
          ...payload,
          actionPayload: {
            ...payload.actionPayload,
            legacySession: { ...payload.actionPayload.legacySession, taskId },
          },
        },
      };
    });

  for (const intent of ['update', 'complete', 'uncomplete'] as const) {
    it(`rejects a missing ${intent} seed owned by another live Task and permits correct startup backfill`, async () => {
      base = addTaskToAppData(base, createValidTask('task-2'));
      const sibling: WorkSession = {
        id: 'sibling',
        taskId: task.id,
        start: 500,
        end: 600,
        timeZone: 'Europe/Berlin',
        created: 100,
        modified: 100,
      };
      base.workSession = { ids: [sibling.id], entities: { [sibling.id]: sibling } };
      await receive(withSeedOwner(senderOps([intent]), 'task-2'), false);
      expect(sessions()).toEqual(base.workSession);
      expect(sessions().entities[id]).toBeUndefined();
      expect(sessions().dismissedLegacySessionIds).toBeUndefined();
      await TestBed.inject(OperationLogHydratorService).hydrateStore();
      expect(sessions().entities[id]).toEqual(
        jasmine.objectContaining({
          id,
          taskId: task.id,
          start: 100,
          end: 200,
          timeZone: 'Asia/Tokyo',
        }),
      );
      expect(sessions().entities[id]?.completedAt).toBeUndefined();
      expect(sessions().entities[sibling.id]).toEqual(sibling);
      expect(validateFull(snapshot()).isValid).toBeTrue();
    });

    it(`ignores an unused wrong-owner seed for an existing ${intent} target`, async () => {
      const ops = withSeedOwner(senderOps([intent]), 'task-2');
      const current: WorkSession = {
        id,
        taskId: task.id,
        start: 700,
        end: 800,
        timeZone: 'Europe/Berlin',
        created: 50,
        modified: 50,
        completedAt: 75,
      };
      base.workSession = { ids: [id], entities: { [id]: current } };
      await receive(ops, false);
      expect(sessions().entities[id]).toEqual(
        jasmine.objectContaining({
          taskId: task.id,
          timeZone: current.timeZone,
          created: current.created,
          start: intent === 'update' ? 300 : 700,
          end: intent === 'update' ? 450 : 800,
          completedAt: intent === 'complete' ? 250 : intent === 'uncomplete' ? null : 75,
        }),
      );
    });

    it(`does not materialize a missing ${intent} seed pointing to a missing Task`, async () => {
      await receive(withSeedOwner(senderOps([intent]), 'missing-task'), false);
      expect(sessions()).toEqual(base.workSession);
    });

    it(`hydrates a wrong-owner ${intent} as a no-op before correct startup backfill`, async () => {
      base = addTaskToAppData(base, createValidTask('task-2'));
      await receive(withSeedOwner(senderOps([intent]), 'task-2'), true);
      expect(sessions().entities[id]).toEqual(
        jasmine.objectContaining({
          taskId: task.id,
          start: 100,
          end: 200,
          timeZone: 'Asia/Tokyo',
        }),
      );
      expect(sessions().entities[id]?.completedAt).toBeUndefined();
      expect(sessions().dismissedLegacySessionIds).toBeUndefined();
    });

    it(`keeps dismissal unchanged after a wrong-owner ${intent}`, async () => {
      base = addTaskToAppData(base, createValidTask('task-2'));
      await receive(withSeedOwner(senderOps([intent]), 'task-2'), false, true);
      expect(sessions()).toEqual({
        ids: [],
        entities: {},
        dismissedLegacySessionIds: [id],
      });
      await assertStableRestart();
    });

    it(`rejects ${intent} materialization when the encoded Task is absent`, async () => {
      const ops = senderOps([intent]);
      base = addTaskToAppData(createValidAppData(), createValidTask('task-2'));
      store.dispatch(loadAllData({ appDataComplete: base }));
      const before = sessions();
      const result = await TestBed.inject(OperationApplierService).applyOperations(ops);
      expect(result.appliedOps).toEqual([]);
      expect(result.reducerFailures?.length).toBe(1);
      expect(sessions()).toBe(before);
      expect(validateFull(snapshot()).isValid).toBeTrue();
      expect(backfillLegacyTaskWorkSessions(base.task, before, 'Asia/Tokyo')).toBe(
        before,
      );
    });
  }

  for (const hydration of [true, false]) {
    for (const intent of ['update', 'complete', 'uncomplete', 'remove'] as const) {
      it(`${hydration ? 'hydrates' : 'live-applies'} ${intent} before materialization with sender timezone`, async () => {
        const ops = senderOps([intent]);
        await receive(ops, hydration);
        if (intent === 'remove') {
          expect(sessions().entities[id]).toBeUndefined();
          expect(sessions().dismissedLegacySessionIds).toEqual([id]);
        } else {
          expect(sessions().entities[id]).toEqual(
            jasmine.objectContaining({
              id,
              taskId: task.id,
              start: intent === 'update' ? 300 : 100,
              end: intent === 'update' ? 450 : 200,
              timeZone: 'America/Vancouver',
              created: 100,
              ...(intent === 'complete' ? { completedAt: 250 } : {}),
              ...(intent === 'uncomplete' ? { completedAt: null } : {}),
            }),
          );
          expect(sessions().ids).toEqual([id]);
        }
        await assertStableRestart();
      });
    }
    it(`${hydration ? 'hydrates' : 'live-applies'} update then completion without losing either mutation`, async () => {
      await receive(senderOps(['update', 'complete']), hydration);
      expect(sessions().entities[id]).toEqual(
        jasmine.objectContaining({
          start: 300,
          end: 450,
          completedAt: 250,
          timeZone: 'America/Vancouver',
        }),
      );
      await assertStableRestart();
    });
    it(`${hydration ? 'hydrates' : 'live-applies'} completion then uncompletion with canonical null`, async () => {
      await receive(senderOps(['complete', 'uncomplete']), hydration);
      expect(sessions().entities[id]?.completedAt).toBeNull();
      await assertStableRestart();
    });
    it(`${hydration ? 'hydrates' : 'live-applies'} late mutations without resurrecting dismissal`, async () => {
      await receive(senderOps(['update', 'complete']), hydration, true);
      expect(sessions().entities[id]).toBeUndefined();
      expect(sessions().dismissedLegacySessionIds).toEqual([id]);
      await assertStableRestart();
    });
  }
});
