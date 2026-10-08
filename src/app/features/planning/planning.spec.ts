import { ActionReducer } from '@ngrx/store';
import { RootState } from '../../root-store/root-state';
import { createStateWithExistingTasks } from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import { plannerSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/planner-shared.reducer';
import { taskSharedSchedulingMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer';
import { taskSharedCrudMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer';
import { taskReducer } from '../tasks/store/task.reducer';
import { plannerReducer } from '../planner/store/planner.reducer';
import { PlannerActions } from '../planner/store/planner.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { ActionType, Operation } from '../../op-log/core/operation.types';
import { PersistentAction } from '../../op-log/core/persistent-action.interface';
import {
  encodeOperation,
  decodeOperation,
} from '../../op-log/persistence/compact/operation-codec.service';
import { buildReplacementOperation } from '../../op-log/sync/build-replacement-operation';
import { comparePlacements, PlanningPlacement, PLANNING_V1 } from './planning.model';
import { projectLegacyPlanning } from '@sp/shared-schema';
import { planningReducer, initialPlanningState } from './store/planning.reducer';
import {
  setPlacement as preparedSet,
  removePlacement as preparedRemove,
} from './store/planning.actions';
import { PlanningRecord, planningPlacementView } from '@sp/shared-schema';
let fixtureId = 0;
const setPlacement = ({
  placement,
}: {
  placement: PlanningPlacement;
}): ReturnType<typeof preparedSet> =>
  preparedSet({
    record: {
      id: placement.id,
      placement: { target: placement.target, orderKey: placement.orderKey },
      revision: { counter: 1, clientId: 'client-a', opId: 'fixture-' + ++fixtureId },
    },
  });
const removePlacement = ({ id }: { id: string }): ReturnType<typeof preparedRemove> =>
  preparedRemove({
    record: {
      id,
      placement: null,
      revision: { counter: 2, clientId: 'client-a', opId: 'fixture-' + ++fixtureId },
    },
  });
import {
  selectPlanningIdsForWeek,
  selectTodayPlanningIds,
} from './store/planning.selectors';

describe('normalized Planning replay', () => {
  const D = '2026-10-08',
    TODAY = '2026-10-01';
  const base = (): RootState => {
    const state = createStateWithExistingTasks(['X', 'Y', 'B', 'C'], [], [], ['X', 'Y']);
    state.appState = { ...state.appState, todayStr: TODAY, startOfNextDayDiffMs: 0 };
    state.planning = initialPlanningState;
    return state;
  };
  const feature: ActionReducer<RootState> = (state = base(), action) => ({
    ...state,
    tasks: taskReducer(state.tasks, action),
    planner: plannerReducer(state.planner, action),
    planning: planningReducer(state.planning, action),
  });
  const reduce = bulkOperationsMetaReducer(
    taskSharedSchedulingMetaReducer(
      plannerSharedMetaReducer(taskSharedCrudMetaReducer(feature)),
    ),
  );
  it('replays atomic task capture with an initial placement without a second action', () => {
    for (const type of ['WEEK', 'DAY'] as const) {
      const initial = base();
      const action = TaskSharedActions.addTask({
        task: { ...initial.tasks.entities['X']!, id: 'captured' },
        workContextId: initial.tasks.entities['X']!.projectId!,
        workContextType:
          'PROJECT' as import('../work-context/work-context.model').WorkContextType,
        isAddToBacklog: false,
        isAddToBottom: true,
        isIgnoreShortSyntax: true,
        initialPlanning: {
          id: 'captured',
          placement: { target: { type, key: '2026-10-05' }, orderKey: 'V' },
          revision: { counter: 1, clientId: 'client-a', opId: 'initial-capture' },
        },
      });
      const replay = JSON.parse(JSON.stringify(action));
      const next = reduce(initial, replay);
      expect(next.tasks.entities['captured']).toBeDefined();
      expect(planningPlacementView(next.planning?.entities['captured'])?.target).toEqual({
        type,
        key: '2026-10-05',
      });
      expect(reduce(next, replay).planning).toEqual(next.planning);
    }
  });
  const placement = (
    id: string,
    day = D,
    orderKey = 'V',
    type: 'DAY' | 'WEEK' = 'DAY',
  ): PlanningPlacement => ({ id, target: { type, key: day }, orderKey });
  const op = (
    action: PersistentAction,
    schemaVersion = 4,
    clientId = 'client-a',
    timestamp = 100,
  ): Operation => ({
    id:
      action.meta.opType === PLANNING_V1
        ? (action['record'] as PlanningRecord).revision.opId
        : clientId + ':' + timestamp + ':' + action.type + ':' + action.meta.entityId,
    clientId,
    timestamp,
    schemaVersion,
    vectorClock: { [clientId]: 1 },
    entityType: action.meta.entityType,
    entityId: action.meta.entityId,
    entityIds: action.meta.entityIds,
    opType: action.meta.opType,
    actionType: action.type as ActionType,
    payload: {
      actionPayload: Object.fromEntries(
        Object.entries(action)
          .filter(([k]) => k !== 'type' && k !== 'meta')
          .map(([k, v]) =>
            k === 'record'
              ? [
                  k,
                  {
                    ...(v as PlanningRecord),
                    revision: { ...(v as PlanningRecord).revision, clientId },
                  },
                ]
              : [k, v],
          ),
      ),
      entityChanges: [],
    },
  });
  const replay = (state: RootState, operations: Operation[]): RootState =>
    reduce(state, bulkApplyOperations({ operations }));
  const migrate = (state: RootState): RootState => ({
    ...state,
    planning: projectLegacyPlanning({
      task: state.tasks,
      planner: state.planner,
      tag: state.tag,
    }).state,
  });
  const ordered = (state: RootState): string[] =>
    Object.values(state.planning!.entities)
      .map(planningPlacementView)
      .filter((p): p is PlanningPlacement => !!p)
      .sort(comparePlacements)
      .map((p) => p.id);

  it('does not promote a schedule-only Task before or after the snapshot boundary', () => {
    const initial = base(),
      time = Date.parse(TODAY + 'T12:00:00Z');
    const schedule = op(
      TaskSharedActions.scheduleTaskWithTime({
        task: initial.tasks.entities['X']!,
        dueWithTime: time,
        isMoveToBacklog: false,
      }),
    );
    const a = replay(migrate(initial), [schedule]);
    const b = replay(
      migrate({ ...initial, appState: { ...initial.appState, todayStr: D } }),
      [schedule],
    );
    expect(a.planning).toEqual(b.planning);
    expect(a.planning!.entities['X']).toBeUndefined();
    expect(migrate(a).planning).toEqual(a.planning);
    expect(a.tasks.entities['X']!.dueWithTime).toBe(time);
    expect(a.tasks.entities['X']).toBeDefined();
    expect(a.tag.entities['TODAY']!.taskIds).not.toEqual(
      b.tag.entities['TODAY']!.taskIds,
    );
  });
  for (const date of [D, '2025-10-01'])
    it('stale Today removal preserves Planner-backed ' + date, () => {
      const state = base();
      state.planner.days[date] = ['X'];
      state.tasks.entities['X'] = { ...state.tasks.entities['X']!, dueDay: '2026-10-09' };
      const migrated = migrate(state),
        result = replay(migrated, [
          op(TaskSharedActions.removeTasksFromTodayTag({ taskIds: ['X'] })),
        ]);
      expect(result.planning).toEqual(migrated.planning);
      expect(result.planning!.entities['X']!.placement?.target.key).toBe(date);
    });
  it('Today-only and timed-only removal never fabricates a placement', () => {
    const state = base();
    state.tasks.entities['X'] = { ...state.tasks.entities['X']!, dueWithTime: 1 };
    expect(
      replay(migrate(state), [
        op(TaskSharedActions.removeTasksFromTodayTag({ taskIds: ['X'] })),
      ]).planning!.ids,
    ).toEqual([]);
  });
  it('a late schema-4 action cannot change a newer schema-5 placement or resurrect unplanning', () => {
    const state = reduce(
      base(),
      setPlacement({ placement: placement('X', '2026-10-20') }),
    );
    const legacy = [
      op(PlannerActions.planTaskForDay({ task: state.tasks.entities['X']!, day: D })),
      op(TaskSharedActions.removeTasksFromTodayTag({ taskIds: ['X'] })),
    ];
    expect(replay(state, legacy).planning).toEqual(state.planning);
    const removed = reduce(state, removePlacement({ id: 'X' }));
    expect(replay(removed, legacy).planning).toEqual(removed.planning);
  });
  it('current scheduling, due changes and rollover leave canonical planning intact', () => {
    let state = reduce(base(), setPlacement({ placement: placement('X') }));
    const planned = state.planning;
    state = replay(state, [
      op(
        TaskSharedActions.unscheduleTask({
          id: 'X',
          isLeaveInToday: true,
          today: TODAY,
        }),
        5,
      ),
    ]);
    state = reduce(
      state,
      PlannerActions.cleanupOldAndUndefinedPlannerTasks({
        today: '2027-01-01',
        allTaskIds: ['X', 'Y', 'B', 'C'],
      }),
    );
    state = replay(state, [
      op(
        TaskSharedActions.updateTask({
          task: { id: 'X', changes: { dueDay: '2027-01-01' } },
        }),
        5,
      ),
    ]);
    expect(state.planning).toEqual(planned);
  });
  it('Task deletion wins in both replay orders without recreating a Task', () => {
    const initial = base(),
      set = op(setPlacement({ placement: placement('X') }), 5),
      remove = op(
        TaskSharedActions.deleteTask({
          task: { ...initial.tasks.entities['X']!, subTasks: [] },
        }),
        5,
      );
    for (const operations of [
      [set, remove],
      [remove, set],
    ]) {
      const state = replay(initial, operations);
      expect(state.tasks.entities['X']).toBeUndefined();
      expect(state.planning!.entities['X']).toBeDefined();
      expect(selectTodayPlanningIds(state)).not.toContain('X');
    }
  });
  it('codecs retain the semantic family and dense key', () => {
    const operation = op(setPlacement({ placement: placement('X') }), 5);
    expect(decodeOperation(encodeOperation(operation))).toEqual(
      JSON.parse(JSON.stringify(operation)),
    );
  });
  it('derives week/Today membership without due or WorkSession inference', () => {
    let state = reduce(
      base(),
      setPlacement({ placement: placement('X', '2026-09-28', 'V', 'WEEK') }),
    );
    state = reduce(state, setPlacement({ placement: placement('Y', TODAY, 'F') }));
    expect(selectPlanningIdsForWeek('2026-09-28')(state)).toEqual(['X', 'Y']);
    expect(selectTodayPlanningIds(state)).toEqual(['Y']);
  });
  it('distinct Task placements commute in opposite arrival orders including equal gap keys', () => {
    const operations = [
      op(setPlacement({ placement: placement('B') }), 5),
      op(setPlacement({ placement: placement('C') }), 5),
    ];
    const a = replay(base(), operations),
      b = replay(base(), [...operations].reverse());
    expect(a.planning).toEqual(b.planning);
    expect(ordered(a)).toEqual(['B', 'C']);
  });

  it('rejects obsolete Planning compensation instead of creating synthetic operations', () => {
    expect(() =>
      buildReplacementOperation('PLANNING', 'X', undefined, 'client-a', {}, 100),
    ).toThrow();
  });
  it('stale placement cannot revive a tombstone and stale removal cannot erase a placement', () => {
    const active = preparedSet({
      record: {
        id: 'X',
        placement: { target: { type: 'DAY', key: D }, orderKey: 'F' },
        revision: { counter: 10, clientId: 'client-a', opId: 'winner' },
      },
    });
    const tombstone = preparedRemove({
      record: {
        ...active.record,
        placement: null,
        revision: { ...active.record.revision, opId: 'removed' },
      },
    });
    const staleSet = preparedSet({
      record: {
        ...active.record,
        revision: { ...active.record.revision, counter: 9, opId: 'stale-set' },
      },
    });
    const staleRemove = preparedRemove({
      record: {
        ...tombstone.record,
        revision: { ...tombstone.record.revision, counter: 9, opId: 'stale-remove' },
      },
    });
    expect(reduce(reduce(base(), tombstone), staleSet).planning!.entities.X).toEqual(
      tombstone.record,
    );
    expect(reduce(reduce(base(), active), staleRemove).planning!.entities.X).toEqual(
      active.record,
    );
    for (const winner of [active, tombstone]) {
      const operations = [op(winner, 5), op(staleSet, 5)];
      expect(replay(base(), operations).planning).toEqual(
        replay(base(), [...operations].reverse()).planning,
      );
    }
  });
});
