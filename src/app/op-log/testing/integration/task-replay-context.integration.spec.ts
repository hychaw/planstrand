import { Injector } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { BehaviorSubject, Subject, map } from 'rxjs';
import {
  ARCHIVE_COMMAND_V1,
  TASK_REPLAY_CONTEXT_V1,
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
import { RootState } from '../../../root-store/root-state';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import {
  setOperationCaptureService,
  clearDeferredActions,
  getDeferredActions,
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
import { Operation, extractActionPayload } from '../../core/operation.types';
import { convertOpToAction } from '../../apply/operation-converter.util';
import { getOperationRequiredCapabilities } from '../../sync/sync-capability.util';
import { SuperSyncStatusService } from '../../sync/super-sync-status.service';
import { buildReplacementOperation } from '../../sync/build-replacement-operation';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getTaskFolderCaptureAction } from '../../../root-store/meta/task-folder-ownership.meta-reducer';
import { validateOperationPayload } from '../../validation/validate-operation-payload';
import { TaskArchiveService } from '../../../features/archive/task-archive.service';
import {
  getOperationTaskReplayContext,
  getOperationTaskReplayContexts,
  captureTaskReplayContext,
} from '../../core/task-replay-context';
import { setIsApplyingRemoteOps } from '../../capture/operation-capture.meta-reducer';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const NOW = new Date(2026, 9, 11, 12).getTime();
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
interface TaskTestRuntime {
  state: BehaviorSubject<RootState>;
  operations: Operation[];
  dispatched: Action[];
  store: { dispatch: (action: Action) => void };
  service: ArchiveService;
  archiveTasks: TaskArchiveService;
  seedArchives: (young: ArchiveModel, old: ArchiveModel) => void;
  applier: OperationApplierService;
  archives: () => { young: ArchiveModel; old: ArchiveModel };
  gate: (gate?: () => Promise<void>) => void;
  settle: () => Promise<void>;
  logGate: (gate?: () => Promise<void>) => void;
  close: () => void;
  effects: OperationLogEffects;
}
const runtime = (seed: RootState, flush = NOW): TaskTestRuntime => {
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
      await writeGate?.();
      young = copy(next);
    },
    saveArchiveOld: async (next: ArchiveModel) => {
      await writeGate?.();
      old = copy(next);
    },
  };
  const operations: Operation[] = [];
  let operationGate: (() => Promise<void>) | undefined;
  const injector = Injector.create({
    providers: [
      ArchiveService,
      ArchiveOperationHandler,
      OperationApplierService,
      OperationLogEffects,
      LockService,
      SuperSyncStatusService,
      { provide: Store, useValue: store },
      TaskArchiveService,
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
            await operationGate?.();
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
    effects,
    operations,
    dispatched,
    store,
    service: injector.get(ArchiveService),
    archiveTasks: injector.get(TaskArchiveService),
    seedArchives: (nextYoung, nextOld) => {
      young = copy(nextYoung);
      old = copy(nextOld);
    },
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
    logGate: (gate?: () => Promise<void>) => {
      operationGate = gate;
    },
    close: () => {
      subscription.unsubscribe();
      injector.destroy();
      state.complete();
      actions.complete();
    },
  };
};

describe('deterministic Task timestamps through production capture and replay', () => {
  const clients: TaskTestRuntime[] = [];
  let zone: string;
  const NativeDate = Date;
  const client = (): TaskTestRuntime => {
    const seed = initial();
    seed.appState = { todayStr: '2026-10-11', startOfNextDayDiffMs: 0 };
    seed.tag.entities['TODAY'] = { ...seed.tag.entities['TODAY']!, taskIds: [] };
    const result = runtime(seed);
    clients.push(result);
    return result;
  };
  const update = (
    changes: Record<string, unknown>,
  ): ReturnType<typeof TaskSharedActions.updateTask> =>
    TaskSharedActions.updateTask({
      task: { id: 'task1', changes },
      isIgnoreShortSyntax: true,
    });
  const equality = (source: TaskTestRuntime, replay: TaskTestRuntime): void => {
    expect(replay.state.value.tasks).toEqual(source.state.value.tasks);
    expect(replay.state.value.tag).toEqual(source.state.value.tag);
    expect(replay.state.value.projects).toEqual(source.state.value.projects);
    expect(replay.state.value.planner).toEqual(source.state.value.planner);
    expect(replay.state.value.planning).toEqual(source.state.value.planning);
    expect(replay.archives()).toEqual(source.archives());
  };
  beforeEach(() => {
    spyOn(Date, 'now').and.returnValue(NOW);
    zone = 'America/Los_Angeles';
    // Emulate each client's native Date calendar with real IANA rules. Production
    // capture/reducers still run unmodified; no replay context fixtures are supplied.
    const parts = (timestamp: number): Record<string, number> =>
      Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          hourCycle: 'h23',
        })
          .formatToParts(timestamp)
          .map((part) => [part.type, Number(part.value)]),
      );
    const sourceDate = new Proxy(NativeDate, {
      construct: (target, args) => {
        if (args.length < 2) return Reflect.construct(target, args);
        const [year, month, day = 1, hour = 0, minute = 0, second = 0, ms = 0] = args;
        const intended = NativeDate.UTC(year, month, day, hour, minute, second, ms);
        let timestamp = intended;
        for (let i = 0; i < 3; i++) {
          const p = parts(timestamp);
          const actual = NativeDate.UTC(
            p['year'],
            p['month'] - 1,
            p['day'],
            p['hour'],
            p['minute'],
            p['second'],
            ms,
          );
          timestamp += intended - actual;
        }
        return new target(timestamp);
      },
    });
    window.Date = sourceDate;
    const dateParts = (date: Date): Record<string, number> => parts(date.getTime());
    spyOn(NativeDate.prototype, 'getFullYear').and.callFake(function (this: Date) {
      return dateParts(this)['year'];
    });
    spyOn(NativeDate.prototype, 'getMonth').and.callFake(function (this: Date) {
      return dateParts(this)['month'] - 1;
    });
    spyOn(NativeDate.prototype, 'getDate').and.callFake(function (this: Date) {
      return dateParts(this)['day'];
    });
    clearDeferredActions();
    setIsApplyingRemoteOps(false);
  });
  afterEach(() => {
    window.Date = NativeDate;
    for (const c of clients.splice(0)) c.close();
    clearDeferredActions();
    setIsApplyingRemoteOps(false);
  });

  it('captures modified before deferred I/O and replays identical state after midnight in another zone', async () => {
    const source = client();
    let release!: () => void;
    source.logGate(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    source.store.dispatch(update({ title: 'Edit', dueDay: '2026-10-11', modified: 1 }));
    for (let i = 0; i < 50 && !release; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(source.state.value.tasks.entities['task1']!.modified).toBe(NOW);
    (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
    release();
    await source.settle();
    const op = source.operations[0];
    expect(getOperationTaskReplayContext(op)?.modified).toBe(NOW);
    expect(getOperationTaskReplayContext(op)?.todayStart).toBe(
      Date.parse('2026-10-11T07:00:00Z'),
    );
    expect(getOperationTaskReplayContext(op)?.todayEnd).toBe(
      Date.parse('2026-10-12T07:00:00Z'),
    );
    expect(op.requiredCapabilities).toContain(TASK_REPLAY_CONTEXT_V1);
    zone = 'Asia/Tokyo';
    const replay = client();
    replay.state.value.appState.todayStr = '2026-10-12';
    const result = await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
    });
    expect(result.failedOp).toBeUndefined();
    expect(result.reducerFailures ?? []).toEqual([]);
    equality(source, replay);
    // A retry and a different replay window cannot re-stamp the entity.
    (Date.now as jasmine.Spy).and.returnValue(NOW + 172800000);
    await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
    });
    equality(source, replay);
  });

  it('preserves a completion fallback and source completion-day sanitization across zones', async () => {
    const source = client();
    const now = Date.parse('2026-10-12T01:00:00Z');
    (Date.now as jasmine.Spy).and.returnValue(now);
    source.state.next({
      ...source.state.value,
      tasks: {
        ...source.state.value.tasks,
        entities: {
          ...source.state.value.tasks.entities,
          task1: { ...source.state.value.tasks.entities['task1']!, dueDay: '2026-10-10' },
        },
      },
    });
    source.store.dispatch(update({ isDone: true, dueDay: '2026-10-11' }));
    await source.settle();
    expect(source.state.value.tasks.entities['task1']!.doneOn).toBe(now);
    expect(source.state.value.tasks.entities['task1']!.dueDay).toBe('2026-10-10');
    zone = 'Asia/Tokyo';
    (Date.now as jasmine.Spy).and.returnValue(now + 86400000);
    const replay = client();
    replay.state.next({
      ...replay.state.value,
      tasks: {
        ...replay.state.value.tasks,
        entities: {
          ...replay.state.value.tasks.entities,
          task1: { ...replay.state.value.tasks.entities['task1']!, dueDay: '2026-10-10' },
        },
      },
    });
    await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
    });
    equality(source, replay);
  });

  for (const mode of ['replace', 'patch'] as const)
    it(`preserves Task LWW ${mode}, timed Today membership and compensation on replay/retry`, async () => {
      const source = client();
      const modified = Date.parse('2026-10-11T17:00:00Z');
      const stamp = Date.parse('2026-10-12T08:00:00Z');
      (Date.now as jasmine.Spy).and.returnValue(stamp);
      source.state.value.appState.startOfNextDayDiffMs = 14400000;
      const op = buildReplacementOperation(
        'TASK',
        'task1',
        {
          ...createMockTask({
            id: 'task1',
            modified,
            dueWithTime: Date.parse('2026-10-12T08:30:00Z'),
          }),
        },
        'source',
        { source: 1 },
        123,
        mode,
        undefined,
        false,
        captureTaskReplayContext(source.state.value.appState, modified),
      );
      const applied = await source.applier.applyOperations([op], {
        skipDeferredLocalActions: true,
      });
      expect(applied.reducerFailures ?? []).toEqual([]);
      expect(source.state.value.tasks.entities['task1']!.modified).toBe(modified);
      expect(source.state.value.tag.entities['TODAY']!.taskIds).toContain('task1');
      zone = 'Asia/Tokyo';
      (Date.now as jasmine.Spy).and.returnValue(stamp + 86400000);
      const replay = client();
      replay.state.value.appState.todayStr = '2026-10-13';
      await replay.applier.applyOperations([copy(op)], {
        skipDeferredLocalActions: true,
      });
      equality(source, replay);
      await replay.applier.applyOperations([copy(op)], {
        skipDeferredLocalActions: true,
      });
      equality(source, replay);
      expect(op.timestamp).toBe(123);
      expect(extractActionPayload(op.payload)['taskReplayContext']).toBeUndefined();
    });

  it('preserves versioned LWW recreation timestamps when payload.modified is absent', async () => {
    const op = buildReplacementOperation(
      'TASK',
      'missing',
      {
        title: 'Recreated',
        created: NOW - 1000,
        projectId: 'project1',
        tagIds: [],
        subTaskIds: [],
        timeSpentOnDay: {},
      },
      'source',
      { source: 1 },
      1,
    );
    const source = client();
    await source.applier.applyOperations([op], { skipDeferredLocalActions: true });
    zone = 'Pacific/Auckland';
    (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
    const replay = client();
    await replay.applier.applyOperations([copy(op)], { skipDeferredLocalActions: true });
    equality(source, replay);
    expect(replay.state.value.tasks.entities['missing']!.modified).toBeUndefined();
    expect(getOperationTaskReplayContext(op)?.modified).toBeNull();
  });

  it('preserves an absent winning modified value instead of inventing a historical edit time', async () => {
    const source = client();
    const winning = source.state.value.tasks.entities['task1']!;
    expect(winning.modified).toBeUndefined();
    const op = buildReplacementOperation(
      'TASK',
      'task1',
      winning,
      'source',
      { source: 1 },
      NOW,
    );
    zone = 'Asia/Tokyo';
    (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
    const replay = client();
    await replay.applier.applyOperations([copy(op)], { skipDeferredLocalActions: true });
    equality(source, replay);
    expect(replay.state.value.tasks.entities['task1']!.modified).toBeUndefined();
  });

  it('reuses captured values after a deferred append fails and retries on a different day', async () => {
    const source = client();
    setIsApplyingRemoteOps(true);
    source.store.dispatch(update({ title: 'Retry' }));
    setIsApplyingRemoteOps(false);
    let attempts = 0;
    source.logGate(async () => {
      if (++attempts === 1) {
        (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
        zone = 'Asia/Tokyo';
        throw new Error('Transient append failure');
      }
    });
    await source.effects.processDeferredActions();
    expect(attempts).toBe(2);
    expect(source.operations.length).toBe(1);
    expect(getDeferredActions()).toEqual([]);
    expect(getOperationTaskReplayContext(source.operations[0])?.modified).toBe(NOW);
    expect(getOperationTaskReplayContext(source.operations[0])?.todayStart).toBe(
      Date.parse('2026-10-11T07:00:00Z'),
    );
    const replay = client();
    await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
    });
    equality(source, replay);
  });

  it('produces equal persisted state for a complete window and consecutive replay windows', async () => {
    const source = client();
    source.store.dispatch(update({ title: 'First', dueDay: '2026-10-11' }));
    await source.settle();
    (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
    source.state.value.appState.todayStr = '2026-10-12';
    source.store.dispatch(
      update({ notes: 'Second', isDone: true, dueDay: '2026-10-12' }),
    );
    await source.settle();
    zone = 'Asia/Tokyo';
    (Date.now as jasmine.Spy).and.returnValue(NOW + 172800000);
    const full = client();
    await full.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
    });
    equality(source, full);
    const split = client();
    for (const op of source.operations)
      await split.applier.applyOperations([copy(op)], { skipDeferredLocalActions: true });
    equality(source, split);
  });

  it('rejects versioned recreation without historical created instead of using module-load time', async () => {
    const replay = client();
    const op = buildReplacementOperation(
      'TASK',
      'missing',
      { title: 'Incomplete' },
      'source',
      { source: 1 },
      NOW,
    );
    const before = copy(replay.state.value.tasks);
    const result = await replay.applier.applyOperations([op], {
      skipDeferredLocalActions: true,
    });
    expect(result.reducerFailures?.length).toBeGreaterThan(0);
    expect(replay.state.value.tasks).toEqual(before);
  });

  for (const [day, start, end] of [
    ['2026-03-08', '2026-03-08T08:00:00Z', '2026-03-09T07:00:00Z'],
    ['2026-11-01', '2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z'],
  ])
    it(`captures the real source logical-day window across DST on ${day}`, () => {
      const context = captureTaskReplayContext({
        todayStr: day,
        startOfNextDayDiffMs: 14400000,
      });
      expect(context.todayStart).toBe(Date.parse(start) + 14400000);
      expect(context.todayEnd).toBe(Date.parse(end) + 14400000);
    });

  it('keeps captured context through deferred capture while sync is active', async () => {
    const source = client();
    setIsApplyingRemoteOps(true);
    source.store.dispatch(update({ title: 'Deferred' }));
    (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
    zone = 'Asia/Tokyo';
    setIsApplyingRemoteOps(false);
    // Flush through the production effect, which must use the already accepted context.
    const deferred = getDeferredActions()[0];
    const prepared = getTaskFolderCaptureAction(deferred);
    expect(prepared.meta.taskReplayContext?.modified).toBe(NOW);
    expect(prepared.meta.taskReplayContext?.todayStart).toBe(
      Date.parse('2026-10-11T07:00:00Z'),
    );
    await source.effects.processDeferredActions();
    expect(getDeferredActions()).toEqual([]);
    expect(getOperationTaskReplayContext(source.operations[0])).toEqual(
      prepared.meta.taskReplayContext,
    );
    const replay = client();
    await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
    });
    equality(source, replay);
  });

  it('rejects missing, malformed and unsupported context and fences archive-only readers', async () => {
    const source = client();
    source.store.dispatch(update({ title: 'New' }));
    await source.settle();
    const op = source.operations[0];
    expect(
      supportsRequiredCapabilities(getOperationRequiredCapabilities(op), [
        TASK_FOLDER_OWNERSHIP_V1,
        ARCHIVE_COMMAND_V1,
      ]),
    ).toBeFalse();
    for (const context of [
      undefined,
      null,
      { version: 2 },
      { ...getOperationTaskReplayContext(op), modified: NaN },
      { ...getOperationTaskReplayContext(op), modified: null },
      { ...getOperationTaskReplayContext(op), extra: true },
      { ...getOperationTaskReplayContext(op), todayEnd: 0 },
      { ...getOperationTaskReplayContext(op), today: '2026-02-30' },
    ]) {
      const bad = copy(op);
      (bad.payload as { taskReplayContext?: unknown }).taskReplayContext = context;
      expect(() => convertOpToAction(bad)).toThrow();
      expect(validateOperationPayload(bad).success).toBeFalse();
    }
    expect(() => convertOpToAction({ ...op, requiredCapabilities: [] })).toThrow();
    source.store.dispatch(update({ isDone: true }));
    await source.settle();
    const completion = copy(source.operations[1]);
    delete (completion.payload as { taskReplayContext: { completionDay?: string } })
      .taskReplayContext.completionDay;
    expect(() => convertOpToAction(completion)).toThrowError(
      'Missing source Task completion day',
    );
    const legacy = copy(op);
    delete (legacy.payload as { taskReplayContext?: unknown }).taskReplayContext;
    delete legacy.requiredCapabilities;
    expect(() => convertOpToAction(legacy)).not.toThrow();
    expect(convertOpToAction(legacy).meta.taskReplayContext).toBeUndefined();
  });

  const archiveSeed = (): { young: ArchiveModel; old: ArchiveModel } => {
    const young = emptyArchive(NOW),
      old = emptyArchive(NOW);
    for (const [archive, id] of [
      [young, 'young-edit'],
      [old, 'old-edit'],
    ] as const) {
      const task = createMockTask({
        id,
        folderId: 'INBOX_FOLDER',
        projectId: '',
        tagIds: [],
        subTaskIds: [],
        isDone: false,
        created: 10,
        modified: 20,
        dueDay: '2026-10-01',
      });
      archive.task = { ids: [id], entities: { [id]: task } };
    }
    return { young, old };
  };
  const seedArchiveClient = (seed: ReturnType<typeof archiveSeed>): TaskTestRuntime => {
    const result = client();
    result.seedArchives(seed.young, seed.old);
    return result;
  };
  for (const target of ['young', 'old'] as const)
    it(`archive ${target} edit retains source context across delayed midnight writes, zones and replay retry`, async () => {
      const seed = archiveSeed();
      const source = seedArchiveClient(seed);
      const stamp = Date.parse('2026-10-12T06:59:59.900Z'); // LA, just before midnight
      (Date.now as jasmine.Spy).and.returnValue(stamp);
      const id = target + '-edit';
      let entered!: () => void, release!: () => void;
      const entry = new Promise<void>((resolve) => (entered = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      source.gate(async () => {
        entered();
        await gate;
      });
      let finished = false;
      const mutation = source.archiveTasks
        .updateTask(id, {
          title: 'Archived edit',
          isDone: true,
          dueDay: '2026-10-11',
          modified: 1,
        })
        .then(() => {
          finished = true;
        });
      await entry;
      expect(finished).toBeFalse();
      expect(source.operations).toEqual([]);
      (Date.now as jasmine.Spy).and.returnValue(stamp + 5000);
      source.state.value.appState.todayStr = '2026-10-12';
      release();
      await mutation;
      await source.settle();
      const op = source.operations[0];
      const context = getOperationTaskReplayContext(op)!;
      expect(context.modified).toBe(stamp);
      expect(context.completionDay).toBe('2026-10-11');
      expect(op.timestamp).toBe(stamp + 5000);
      expect(op.requiredCapabilities).toContain(TASK_REPLAY_CONTEXT_V1);
      expect(source.archives()[target].task.entities[id]!.modified).toBe(stamp);
      expect(source.archives()[target].task.entities[id]!.doneOn).toBe(stamp);
      // The synthetic completion day must not replace the existing schedule.
      expect(source.archives()[target].task.entities[id]!.dueDay).toBe('2026-10-01');
      zone = 'Pacific/Auckland';
      (Date.now as jasmine.Spy).and.returnValue(stamp + 86400000);
      const replay = seedArchiveClient(seed);
      const result = await replay.applier.applyOperations(copy(source.operations), {
        skipDeferredLocalActions: true,
      });
      expect(result.failedOp).toBeUndefined();
      expect(result.reducerFailures ?? []).toEqual([]);
      equality(source, replay);
      (Date.now as jasmine.Spy).and.returnValue(stamp + 172800000);
      await replay.applier.applyOperations(copy(source.operations), {
        skipDeferredLocalActions: true,
        skipReducerDispatch: true,
      });
      equality(source, replay);
    });

  it('archive batch preserves each member context and complete records across both archive generations', async () => {
    const seed = archiveSeed();
    const source = seedArchiveClient(seed);
    const stamp = Date.parse('2026-10-12T06:59:59.900Z');
    (Date.now as jasmine.Spy).and.returnValue(stamp);
    let entered!: () => void, release!: () => void;
    const entry = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    source.gate(async () => {
      entered();
      await gate;
    });
    const mutation = source.archiveTasks.updateTasks([
      {
        id: 'young-edit',
        changes: { title: 'Young', isDone: true, dueDay: '2026-10-11' },
      },
      {
        id: 'old-edit',
        changes: {
          title: 'Old',
          isDone: true,
          doneOn: stamp - 86400000,
          dueDay: '2026-10-10',
        },
      },
    ]);
    await entry;
    (Date.now as jasmine.Spy).and.returnValue(stamp + 5000);
    source.state.value.appState.todayStr = '2026-10-12';
    release();
    await mutation;
    await source.settle();
    expect(source.operations.length).toBe(1);
    const op = source.operations[0];
    expect(op.actionType).toBe(TaskSharedActions.updateTasks.type);
    const contexts = getOperationTaskReplayContexts(op)!;
    expect(contexts['young-edit'].completionDay).toBe('2026-10-11');
    expect(contexts['old-edit'].completionDay).toBe('2026-10-10');
    for (const target of ['young', 'old'] as const)
      expect(source.archives()[target].task.entities[target + '-edit']!.modified).toBe(
        stamp,
      );
    zone = 'Asia/Tokyo';
    (Date.now as jasmine.Spy).and.returnValue(stamp + 86400000);
    const replay = seedArchiveClient(seed);
    const result = await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
    });
    expect(result.failedOp).toBeUndefined();
    expect(result.reducerFailures ?? []).toEqual([]);
    equality(source, replay);
    await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
      skipReducerDispatch: true,
    });
    equality(source, replay);
    const bad = copy(op);
    delete (bad.payload as { taskReplayContext: Record<string, unknown> })
      .taskReplayContext['old-edit'];
    expect(validateOperationPayload(bad).success).toBeFalse();
    expect(() => convertOpToAction(bad)).toThrow();
    expect(() => convertOpToAction({ ...op, requiredCapabilities: [] })).toThrow();
  });

  it('archive replay retries a failed write without resampling the persisted timestamp', async () => {
    const seed = archiveSeed();
    const source = seedArchiveClient(seed);
    await source.archiveTasks.updateTask('old-edit', { title: 'Retry archive' });
    await source.settle();
    const replay = seedArchiveClient(seed);
    let attempts = 0;
    replay.gate(async () => {
      if (++attempts === 1) throw new Error('Transient archive write failure');
    });
    const failed = await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
    });
    expect(failed.failedOp?.op.id).toBe(source.operations[0].id);
    expect(replay.archives()).toEqual(seed);
    zone = 'Asia/Tokyo';
    (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
    const result = await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
      skipReducerDispatch: true,
    });
    expect(result.failedOp).toBeUndefined();
    equality(source, replay);
  });

  it('archive deferred capture retries retain context and winning compensation keeps the same source values', async () => {
    const seed = archiveSeed();
    const source = seedArchiveClient(seed);
    setIsApplyingRemoteOps(true);
    await source.archiveTasks.updateTask('young-edit', { title: 'Deferred archive' });
    setIsApplyingRemoteOps(false);
    let attempts = 0;
    source.logGate(async () => {
      if (++attempts === 1) {
        (Date.now as jasmine.Spy).and.returnValue(NOW + 86400000);
        zone = 'Asia/Tokyo';
        throw new Error('Transient append failure');
      }
    });
    await source.effects.processDeferredActions();
    expect(attempts).toBe(2);
    const op = source.operations[0];
    const context = getOperationTaskReplayContext(op)!;
    expect(context.modified).toBe(NOW);
    const winning = source.archives().young.task.entities['young-edit']!;
    for (const mode of ['patch', 'replace'] as const) {
      const compensation = buildReplacementOperation(
        'TASK',
        winning.id,
        winning,
        'source',
        { source: 2 },
        NOW + 86400000,
        mode,
        undefined,
        false,
        context,
      );
      expect(getOperationTaskReplayContext(compensation)).toEqual(context);
      expect(convertOpToAction(compensation).meta.taskReplayContext).toEqual(context);
      expect(extractActionPayload(compensation.payload)['modified']).toBe(
        winning.modified,
      );
      // Existing compensation replay installs the winning record in the Task
      // store; compare the complete record as well as its retained context.
      const compensated = client();
      const result = await compensated.applier.applyOperations([copy(compensation)], {
        skipDeferredLocalActions: true,
      });
      expect(result.reducerFailures ?? []).toEqual([]);
      expect(copy(compensated.state.value.tasks.entities[winning.id])).toEqual(
        copy(winning),
      );
      await compensated.applier.applyOperations([copy(compensation)], {
        skipDeferredLocalActions: true,
      });
      expect(copy(compensated.state.value.tasks.entities[winning.id])).toEqual(
        copy(winning),
      );
    }
    const replay = seedArchiveClient(seed);
    await replay.applier.applyOperations(copy(source.operations), {
      skipDeferredLocalActions: true,
    });
    equality(source, replay);
  });
});
