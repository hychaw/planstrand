import { ActionReducer } from '@ngrx/store';
import {
  addWorkSession,
  completeWorkSession,
  removeWorkSession,
  uncompleteWorkSession,
  updateWorkSession,
} from '../../features/work-session/store/work-session.actions';
import { WORK_SESSION_FEATURE_NAME } from '../../features/work-session/store/work-session.reducer';
import { TASK_FEATURE_NAME, taskReducer } from '../../features/tasks/store/task.reducer';
import { RootState } from '../root-state';
import { TaskSharedActions } from './task-shared.actions';
import { workSessionIntegrityMetaReducer } from './work-session-integrity.meta-reducer';
import { workSessionReducer } from '../../features/work-session/store/work-session.reducer';
import { taskSharedCrudMetaReducer } from './task-shared-meta-reducers/task-shared-crud.reducer';
import { lwwUpdateMetaReducer } from './task-shared-meta-reducers/lww-update.meta-reducer';
import {
  addTaskToAppData,
  appDataToRootState,
  createValidAppData,
  createValidTask,
} from '../../op-log/validation/state-validity-test-utils';

const rootState = (withSession = false): RootState =>
  ({
    [TASK_FEATURE_NAME]: {
      ids: ['task-1'],
      entities: {
        ['task-1']: { id: 'task-1', subTaskIds: [] },
      },
    },
    [WORK_SESSION_FEATURE_NAME]: withSession
      ? {
          ids: ['session-1'],
          entities: {
            ['session-1']: {
              id: 'session-1',
              taskId: 'task-1',
              start: 100,
              end: 200,
              created: 50,
              modified: 50,
            },
          },
        }
      : { ids: [], entities: {} },
  }) as unknown as RootState;

describe('workSessionIntegrityMetaReducer', () => {
  const reducer: ActionReducer<RootState> = (state) => state!;
  const guarded = workSessionIntegrityMetaReducer(reducer);

  it('rejects creation for a missing Task', () => {
    expect(() =>
      guarded(
        rootState(),
        addWorkSession({
          workSession: {
            id: 'session-1',
            taskId: 'missing',
            start: 100,
            end: 200,
            created: 50,
            modified: 50,
          },
        }),
      ),
    ).toThrowError('WorkSession taskId must reference a live Task');
  });

  it('rejects reassignment to a missing Task', () => {
    expect(() =>
      guarded(
        rootState(true),
        updateWorkSession({
          id: 'session-1',
          changes: { taskId: 'missing' },
          modified: 300,
        }),
      ),
    ).toThrowError('WorkSession taskId must reference a live Task');
  });

  it('blocks Task deletion while WorkSessions exist', () => {
    expect(() =>
      guarded(rootState(true), TaskSharedActions.deleteTasks({ taskIds: ['task-1'] })),
    ).toThrowError('Remove WorkSessions before deleting or archiving their Task');
  });

  it('does not mutate Task state when a WorkSession action is accepted', () => {
    const state = rootState();
    const next = guarded(
      state,
      addWorkSession({
        workSession: {
          id: 'session-1',
          taskId: 'task-1',
          start: 100,
          end: 200,
          created: 50,
          modified: 50,
        },
      }),
    );
    expect(next[TASK_FEATURE_NAME]).toBe(state[TASK_FEATURE_NAME]);
  });

  const domainReducer: ActionReducer<RootState> = (state, action) => ({
    ...state!,
    tasks: taskReducer(state!.tasks, action),
    workSession: workSessionReducer(state!.workSession, action),
  });
  const integrated = workSessionIntegrityMetaReducer(
    taskSharedCrudMetaReducer(lwwUpdateMetaReducer(domainReducer)),
  );
  const completeState = (): RootState => {
    const data = addTaskToAppData(
      createValidAppData(),
      createValidTask('task-1', {
        dueDay: '2026-09-30',
        dueWithTime: 1000,
        deadlineDay: '2026-10-01',
        deadlineWithTime: 2000,
        timeEstimate: 3000,
      }),
    );
    data.workSession = rootState(true).workSession;
    return appDataToRootState(data);
  };

  it('permits deletion and archive only after all referencing sessions are explicitly removed', () => {
    const initial = completeState();
    const second = { ...initial.workSession.entities['session-1']!, id: 'second' };
    const two = integrated(initial, addWorkSession({ workSession: second }));
    const one = integrated(two, removeWorkSession({ id: 'session-1' }));
    const deleteAction = TaskSharedActions.deleteTasks({ taskIds: ['task-1'] });
    const archiveAction = TaskSharedActions.moveToArchive({
      tasks: [{ ...one.tasks.entities['task-1']!, subTasks: [] }],
    });
    for (const action of [deleteAction, archiveAction]) {
      expect(() => integrated(one, action)).toThrowError(
        'Remove WorkSessions before deleting or archiving their Task',
      );
    }
    const none = integrated(one, removeWorkSession({ id: 'second' }));
    expect(none.tasks).toBe(initial.tasks);
    expect(none.planning).toBe(initial.planning);
    for (const action of [deleteAction, archiveAction]) {
      expect(integrated(none, action).tasks.entities['task-1']).toBeUndefined();
    }
  });

  it('creation, editing and removal preserve Task scheduling and Planner/Today membership', () => {
    const initial = completeState();
    const removed = integrated(initial, removeWorkSession({ id: 'session-1' }));
    const created = integrated(
      removed,
      addWorkSession({ workSession: initial.workSession.entities['session-1']! }),
    );
    const edited = integrated(
      created,
      updateWorkSession({
        id: 'session-1',
        changes: { start: 300, end: 400 },
        modified: 300,
      }),
    );
    for (const state of [removed, created, edited]) {
      expect(state.tasks).toBe(initial.tasks);
      expect(state.planner).toBe(initial.planner);
      expect(state.tag).toBe(initial.tag);
    }
  });

  it('blocks parent deletion when a child owns a session', () => {
    const state = completeState();
    state.tasks.entities['parent'] = createValidTask('parent', {
      subTaskIds: ['task-1'],
    });
    expect(() =>
      guarded(state, TaskSharedActions.deleteTasks({ taskIds: ['parent'] })),
    ).toThrowError('Remove WorkSessions before deleting or archiving their Task');
  });

  it('completion/uncompletion preserve all Task fields and Planner/Today membership', () => {
    const initial = completeState();
    const completed = integrated(
      initial,
      completeWorkSession({ id: 'session-1', completedAt: 300, modified: 300 }),
    );
    const uncompleted = integrated(
      completed,
      uncompleteWorkSession({ id: 'session-1', modified: 400 }),
    );
    expect(uncompleted.tasks).toBe(initial.tasks);
    expect(uncompleted.tasks.entities['task-1']!.isDone).toBeFalse();
    expect(uncompleted.planner).toBe(initial.planner);
    expect(uncompleted.tag).toBe(initial.tag);
    expect(uncompleted.workSession.entities['session-1']!.completedAt).toBeNull();
  });

  it('Task completion leaves sessions incomplete', () => {
    const initial = completeState();
    const completed = integrated(
      initial,
      TaskSharedActions.updateTask({ task: { id: 'task-1', changes: { isDone: true } } }),
    );
    expect(completed.tasks.entities['task-1']!.isDone).toBeTrue();
    expect(completed.workSession).toBe(initial.workSession);
    expect(completed.workSession.entities['session-1']!.completedAt).toBeUndefined();
  });

  it('applies a generic LWW winner using the registered adapter', () => {
    const initial = completeState();
    const winner = {
      ...initial.workSession.entities['session-1']!,
      end: 250,
      completedAt: 300,
      modified: 300,
    };
    const next = integrated(initial, { type: '[WORK_SESSION] LWW Update', ...winner });
    expect(next.workSession.entities['session-1']!.end).toBe(250);
    expect(next.workSession.entities['session-1']!.completedAt).toBe(300);
    expect(next.tasks).toBe(initial.tasks);
  });

  it('rejects dangling and malformed generic LWW winners', () => {
    const initial = completeState();
    const dangling = {
      type: '[WORK_SESSION] LWW Update',
      ...initial.workSession.entities['session-1']!,
      taskId: 'missing',
    };
    const malformed = {
      type: '[WORK_SESSION] LWW Update',
      ...initial.workSession.entities['session-1']!,
      end: 0,
    };
    expect(() => integrated(initial, dangling)).toThrowError(
      'WorkSession taskId must reference a live Task',
    );
    expect(() => integrated(initial, malformed)).toThrowError('Invalid WorkSession');
  });

  it('rejects indirect Task removal without losing its sessions', () => {
    const initial = completeState();
    const cascade: ActionReducer<RootState> = (state) => ({
      ...state!,
      tasks: { ...state!.tasks, ids: [], entities: {} },
    });
    expect(() =>
      workSessionIntegrityMetaReducer(cascade)(initial, {
        type: '[Project] Delete Project',
      }),
    ).toThrowError('WorkSession taskId must reference a live Task');
    expect(initial.workSession.ids).toEqual(['session-1']);
  });
});
