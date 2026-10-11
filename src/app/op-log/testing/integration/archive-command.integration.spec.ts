import { Injector } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { BehaviorSubject, Subject, map } from 'rxjs';
import {
  ARCHIVE_COMMAND_V1,
  TASK_FOLDER_OWNERSHIP_V1,
  supportsRequiredCapabilities,
} from '@sp/shared-schema';
import { ArchiveService } from '../../../features/archive/archive.service';
import { ArchiveModel } from '../../../features/archive/archive.model';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { META_REDUCERS } from '../../../root-store/meta/meta-reducer-registry';
import { reducerFailureGuardMetaReducer } from '../../../root-store/meta/reducer-failure-guard.meta-reducer';
import {
  createMockTask,
  createStateWithExistingTasks,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { taskReducer } from '../../../features/tasks/store/task.reducer';
import { projectReducer } from '../../../features/project/store/project.reducer';
import { tagReducer } from '../../../features/tag/store/tag.reducer';
import { planningReducer } from '../../../features/planning/store/planning.reducer';
import { folderReducer } from '../../../features/folder/store/folder.reducer';
import { timeTrackingReducer } from '../../../features/time-tracking/store/time-tracking.reducer';
import {
  updateWorkContextData,
  syncTimeTracking,
} from '../../../features/time-tracking/store/time-tracking.actions';
import { RootState } from '../../../root-store/root-state';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import {
  setOperationCaptureService,
  clearDeferredActions,
} from '../../capture/operation-capture.meta-reducer';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { ImmediateUploadService } from '../../sync/immediate-upload.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ALL_ACTIONS, LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { LockService } from '../../sync/lock.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { ArchiveOperationHandler } from '../../apply/archive-operation-handler.service';
import { HydrationStateService } from '../../apply/hydration-state.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { Operation, ActionType } from '../../core/operation.types';
import { convertOpToAction } from '../../apply/operation-converter.util';
import { getOperationRequiredCapabilities } from '../../sync/sync-capability.util';
import { SuperSyncStatusService } from '../../sync/super-sync-status.service';
import { buildReplacementOperation } from '../../sync/build-replacement-operation';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { validateOperationPayload } from '../../validation/validate-operation-payload';
import type { TaskWithSubTasks } from '../../../features/tasks/task.model';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const NOW = new Date(2026, 9, 11, 12).getTime();
const THIRTY_DAYS = 30 * 86400000;
const OLD_DAY = '2026-10-01';
const emptyArchive = (flush: number): ArchiveModel => ({
  task: { ids: [], entities: {} },
  timeTracking: { project: {}, tag: {} },
  lastTimeTrackingFlush: flush,
});
const initial = (): RootState => ({
  ...createStateWithExistingTasks(['task1', 'keep'], [], ['task1'], ['task1']),
  timeTracking: {
    project: {
      project1: { [OLD_DAY]: { s: 1, e: 2 }, [getDbDateStr(NOW)]: { s: 10, e: 11 } },
    },
    tag: {},
  },
  workSession: { ids: [], entities: {} },
  planning: {
    ids: ['task1'],
    entities: {
      task1: {
        id: 'task1',
        placement: { target: { type: 'DAY', key: OLD_DAY }, orderKey: 'V' },
        revision: { counter: 1, clientId: 'source', opId: 'planning-seed' },
      },
    },
  },
});

/** Actual producer, capture effect, bulk meta-reducers, applier and archive handler.
 * Only persistence and external effects are replaced with isolated test ports. */
interface ArchiveTestRuntime {
  state: BehaviorSubject<RootState>;
  operations: Operation[];
  dispatched: Action[];
  store: { dispatch: (action: Action) => void };
  service: ArchiveService;
  applier: OperationApplierService;
  archives: () => { young: ArchiveModel; old: ArchiveModel };
  gate: (gate?: () => Promise<void>) => void;
  settle: () => Promise<void>;
  close: () => void;
}
const runtime = (seed: RootState, flush = NOW): ArchiveTestRuntime => {
  const state = new BehaviorSubject(seed);
  const actions = new Subject<Action>();
  const capture = new OperationCaptureService();
  setOperationCaptureService(capture);
  const features = {
    tasks: taskReducer,
    projects: projectReducer,
    tag: tagReducer,
    planning: planningReducer,
    folder: folderReducer,
    timeTracking: timeTrackingReducer,
  };
  const root = (before: RootState | undefined, action: Action): RootState => {
    const after = { ...before } as RootState;
    for (const [key, reducer] of Object.entries(features))
      (after as unknown as Record<string, unknown>)[key] = reducer(
        (before as unknown as Record<string, never>)?.[key],
        action,
      );
    return after;
  };
  const reducer = META_REDUCERS.filter(
    (meta) => meta !== reducerFailureGuardMetaReducer,
  ).reduceRight((inner, meta) => meta(inner), root);
  const dispatched: Action[] = [];
  const store = {
    select: (selector: (root: RootState) => unknown) => state.pipe(map(selector)),
    dispatch: (action: Action) => {
      state.next(reducer(state.value, action));
      dispatched.push(action);
      actions.next(action);
    },
  };
  let young = emptyArchive(flush);
  let old = emptyArchive(flush);
  let writeGate: (() => Promise<void>) | undefined;
  const adapter = {
    loadArchiveYoung: async () => copy(young),
    loadArchiveOld: async () => copy(old),
    saveArchivesAtomic: async (nextYoung: ArchiveModel, nextOld: ArchiveModel) => {
      await writeGate?.();
      young = copy(nextYoung);
      old = copy(nextOld);
    },
    saveArchiveYoung: async (next: ArchiveModel) => {
      young = copy(next);
    },
  };
  const operations: Operation[] = [];
  const injector = Injector.create({
    providers: [
      ArchiveService,
      ArchiveOperationHandler,
      OperationApplierService,
      OperationLogEffects,
      LockService,
      SuperSyncStatusService,
      { provide: Store, useValue: store },
      { provide: ArchiveDbAdapter, useValue: adapter },
      { provide: OperationCaptureService, useValue: capture },
      { provide: ALL_ACTIONS, useValue: actions },
      { provide: LOCAL_ACTIONS, useValue: actions },
      {
        provide: OperationLogStoreService,
        useValue: {
          clearVectorClockCache: () => {},
          getCompactionCounter: async () => 0,
          appendWithVectorClockOverwrite: async (op: Operation) => {
            operations.push(copy(op));
            return operations.length;
          },
        },
      },
      {
        provide: VectorClockService,
        useValue: { getCurrentVectorClock: async () => ({ source: operations.length }) },
      },
      {
        provide: ClientIdService,
        useValue: { getOrGenerateClientId: async () => 'source' },
      },
      { provide: OperationLogCompactionService, useValue: {} },
      {
        provide: SnackService,
        useValue: {
          open: () => {
            throw new Error('Unexpected persistence failure');
          },
        },
      },
      { provide: ImmediateUploadService, useValue: { trigger: () => {} } },
      {
        provide: HydrationStateService,
        useValue: {
          startApplyingRemoteOps: () => {},
          startPostSyncCooldown: () => {},
          endApplyingRemoteOps: () => {},
        },
      },
      { provide: CLIENT_ID_PROVIDER, useValue: { loadClientId: async () => 'receiver' } },
    ],
  });
  const effects = injector.get(OperationLogEffects);
  const subscription = effects.persistOperation$.subscribe();
  return {
    state,
    operations,
    dispatched,
    store,
    service: injector.get(ArchiveService),
    applier: injector.get(OperationApplierService),
    archives: () => copy({ young, old }),
    gate: (gate?: () => Promise<void>) => {
      writeGate = gate;
    },
    settle: async () => {
      for (let i = 0; i < 50 && capture.getPendingCount(); i++)
        await new Promise((resolve) => setTimeout(resolve, 0));
      expect(capture.getPendingCount()).toBe(0);
    },
    close: () => {
      subscription.unsubscribe();
      injector.destroy();
      state.complete();
      actions.complete();
    },
  };
};

describe('causal archive command production boundary', () => {
  const clients: ReturnType<typeof runtime>[] = [];
  const client = (flush = NOW): ArchiveTestRuntime => {
    const value = runtime(initial(), flush);
    clients.push(value);
    return value;
  };
  const tasks = (): TaskWithSubTasks[] => [
    {
      ...createMockTask({ id: 'task1', isDone: true, doneOn: NOW - THIRTY_DAYS }),
      subTasks: [],
    },
  ];
  beforeEach(() => {
    spyOn(Date, 'now').and.returnValue(NOW);
    clearDeferredActions();
  });
  afterEach(() => {
    for (const value of clients.splice(0)) value.close();
    clearDeferredActions();
  });

  for (const flush of [NOW, 0])
    it(`preserves source/archive replay partition with flush base ${flush}`, async () => {
      const source = client(flush);
      await source.service.moveTasksToArchiveAndFlushArchiveIfDue(tasks());
      await source.settle();
      expect(source.operations.length).toBe(1);
      expect(source.operations[0].actionType).toBe(
        ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      );
      expect(source.operations[0].requiredCapabilities).toContain(ARCHIVE_COMMAND_V1);
      expect(source.dispatched.map((action) => action.type)).toEqual([
        TaskSharedActions.moveToArchive.type,
      ]);
      const replay = client(flush);
      (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
      const result = await replay.applier.applyOperations(source.operations, {
        skipDeferredLocalActions: true,
      });
      expect(result.failedOp).toBeUndefined();
      expect(result.reducerFailures ?? []).toEqual([]);
      expect(replay.archives()).toEqual(source.archives());
      expect(replay.state.value.timeTracking).toEqual(source.state.value.timeTracking);
      expect(replay.state.value.projects).toEqual(source.state.value.projects);
      expect(replay.state.value.planning).toEqual(source.state.value.planning);
      expect(source.state.value.planning).toEqual(initial().planning);
      expect(replay.state.value.tasks.entities['task1']).toBeUndefined();
      expect(
        (flush ? replay.archives().young : replay.archives().old).task.ids,
      ).toContain('task1');
    });

  it('preserves edits made during delayed writes and captures their causal order', async () => {
    const source = client();
    let release!: () => void;
    let entered!: () => void;
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    source.gate(async () => {
      entered();
      await gate;
    });
    let completed = false;
    const mutation = source.service
      .moveTasksToArchiveAndFlushArchiveIfDue(tasks())
      .then(() => {
        completed = true;
      });
    await entry;
    source.store.dispatch(
      updateWorkContextData({
        ctx: { id: 'project1', type: WorkContextType.PROJECT },
        date: OLD_DAY,
        updates: { e: 3 },
      }),
    );
    expect(completed).toBeFalse();
    (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
    release();
    await mutation;
    await source.settle();
    expect(source.operations.map((operation) => operation.actionType)).toEqual([
      ActionType.TIME_TRACKING_UPDATE_CONTEXT_DATA,
      ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    ]);
    expect(source.state.value.timeTracking.project['project1'][OLD_DAY].e).toBe(3);
    expect(source.archives().young.timeTracking.project['project1'][OLD_DAY].e).toBe(2);
    const replay = client();
    await replay.applier.applyOperations(source.operations, {
      skipDeferredLocalActions: true,
    });
    expect(replay.archives()).toEqual(source.archives());
    expect(replay.state.value.timeTracking).toEqual(source.state.value.timeTracking);
  });

  it('keeps a later time-tracking change active across complete or split replay windows', async () => {
    const source = client();
    await source.service.moveTasksToArchiveAndFlushArchiveIfDue(tasks());
    await source.settle();
    source.store.dispatch(
      syncTimeTracking({
        contextType: 'PROJECT',
        contextId: 'project1',
        date: OLD_DAY,
        data: { s: 4, e: 5 },
      }),
    );
    await source.settle();
    for (const split of [false, true]) {
      const replay = client();
      for (const window of split
        ? source.operations.map((operation) => [operation])
        : [source.operations]) {
        const result = await replay.applier.applyOperations(window, {
          skipDeferredLocalActions: true,
        });
        expect(result.failedOp).toBeUndefined();
      }
      expect(replay.archives()).toEqual(source.archives());
      expect(replay.state.value.timeTracking).toEqual(source.state.value.timeTracking);
    }
  });

  it('retries archive writes using serialized inputs after reducers have committed', async () => {
    const source = client();
    await source.service.moveTasksToArchiveAndFlushArchiveIfDue(tasks());
    await source.settle();
    const replay = client();
    replay.gate(async () => {
      throw new Error('Injected archive failure');
    });
    const failed = await replay.applier.applyOperations(source.operations, {
      skipDeferredLocalActions: true,
    });
    expect(failed.failedOp?.op.id).toBe(source.operations[0].id);
    replay.gate();
    await replay.applier.applyOperations(source.operations, {
      skipReducerDispatch: true,
      skipDeferredLocalActions: true,
    });
    expect(replay.archives()).toEqual(source.archives());
  });

  for (const flush of [NOW, 0])
    it(`keeps archive retries idempotent after a successful write (flush base ${flush})`, async () => {
      const source = client(flush);
      await source.service.moveTasksToArchiveAndFlushArchiveIfDue(tasks());
      await source.settle();
      const replay = client(flush);
      await replay.applier.applyOperations(source.operations, {
        skipDeferredLocalActions: true,
      });
      await replay.applier.applyOperations(source.operations, {
        skipReducerDispatch: true,
        skipDeferredLocalActions: true,
      });
      expect(replay.archives()).toEqual(source.archives());
      expect(replay.state.value.timeTracking).toEqual(source.state.value.timeTracking);
    });

  it('rolls back archive writes rather than remove an uncaptured reverse-linked child', async () => {
    const source = client();
    const before = source.state.value;
    source.state.next({
      ...before,
      tasks: {
        ...before.tasks,
        ids: [...before.tasks.ids, 'child'],
        entities: {
          ...before.tasks.entities,
          child: createMockTask({ id: 'child', parentId: 'task1' }),
        },
      },
    });
    const archives = source.archives();
    await expectAsync(
      source.service.moveTasksToArchiveAndFlushArchiveIfDue(tasks()),
    ).toBeRejectedWithError('Archive command would remove an uncaptured Task');
    await source.settle();
    expect(source.archives()).toEqual(archives);
    expect(source.operations).toEqual([]);
    expect(source.state.value.tasks.entities['task1']).toBeDefined();
    expect(source.state.value.tasks.entities['child']).toBeDefined();
  });

  it('preserves whole-window archive/LWW removal filtering and Planning state', async () => {
    const source = client();
    await source.service.moveTasksToArchiveAndFlushArchiveIfDue(tasks());
    await source.settle();
    const lww = buildReplacementOperation(
      'TASK',
      'task1',
      createMockTask({ id: 'task1', title: 'Winning edit' }),
      'other',
      { source: 1, other: 1 },
      NOW,
    );
    const replay = client();
    const result = await replay.applier.applyOperations([...source.operations, lww], {
      skipDeferredLocalActions: true,
    });
    expect(result.failedOp).toBeUndefined();
    expect(result.reducerFailures ?? []).toEqual([]);
    expect(replay.state.value.tasks.entities['task1']).toBeUndefined();
    expect(replay.state.value.planning).toEqual(source.state.value.planning);
    expect(replay.state.value.projects).toEqual(source.state.value.projects);
    expect(replay.archives()).toEqual(source.archives());
  });

  it('rejects missing or unsupported commands and fences older semantic readers', async () => {
    const source = client();
    await source.service.moveTasksToArchiveAndFlushArchiveIfDue(tasks());
    await source.settle();
    const op = source.operations[0];
    expect(
      supportsRequiredCapabilities(getOperationRequiredCapabilities(op), [
        TASK_FOLDER_OWNERSHIP_V1,
      ]),
    ).toBeFalse();
    for (const version of [undefined, 0, 2, '1']) {
      const bad = copy(op);
      const payload = bad.payload as {
        actionPayload: { archiveCommand?: { version: unknown } };
      };
      if (version === undefined) delete payload.actionPayload.archiveCommand;
      else payload.actionPayload.archiveCommand!.version = version;
      expect(() => convertOpToAction(bad)).toThrow();
      expect(validateOperationPayload(bad).success).toBeFalse();
    }
    const stripped = { ...op, requiredCapabilities: [] };
    expect(() => convertOpToAction(stripped)).toThrow();
    expect(validateOperationPayload(stripped).success).toBeFalse();
    for (const data of [{ invalid: 1 }, { e: Number.NaN }, null]) {
      const malformed = copy(op);
      const payload = malformed.payload as {
        actionPayload: {
          archiveCommand: {
            transferredTimeTracking: { project: Record<string, Record<string, unknown>> };
          };
        };
      };
      payload.actionPayload.archiveCommand.transferredTimeTracking.project['project1'][
        OLD_DAY
      ] = data;
      expect(() => convertOpToAction(malformed)).toThrow();
      expect(validateOperationPayload(malformed).success).toBeFalse();
    }
  });
});
