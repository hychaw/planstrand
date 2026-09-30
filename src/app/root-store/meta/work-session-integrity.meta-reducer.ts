import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import {
  WORK_SESSION_FEATURE_NAME,
  isValidWorkSession,
  assertNoWorkSessionsForTasks,
} from '../../features/work-session/store/work-session.reducer';
import { loadAllData } from './load-all-data.action';
import {
  addWorkSession,
  updateWorkSession,
} from '../../features/work-session/store/work-session.actions';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { TaskSharedActions } from './task-shared.actions';
import { RootState } from '../root-state';

const collectTaskFamily = (state: RootState, rootIds: readonly string[]): Set<string> => {
  const result = new Set<string>();
  const pending = [...rootIds];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || result.has(id)) continue;
    result.add(id);
    const task = state[TASK_FEATURE_NAME]?.entities[id];
    if (task?.subTaskIds) pending.push(...task.subTaskIds);
  }
  return result;
};

const getRemovedTaskIds = (state: RootState, action: Action): Set<string> => {
  if (action.type === TaskSharedActions.deleteTask.type) {
    const { task } = action as ReturnType<typeof TaskSharedActions.deleteTask>;
    return collectTaskFamily(state, [task.id]);
  }
  if (action.type === TaskSharedActions.deleteTasks.type) {
    const { taskIds } = action as ReturnType<typeof TaskSharedActions.deleteTasks>;
    return collectTaskFamily(state, taskIds);
  }
  if (action.type === TaskSharedActions.moveToArchive.type) {
    const { tasks } = action as ReturnType<typeof TaskSharedActions.moveToArchive>;
    return collectTaskFamily(
      state,
      tasks.flatMap((task) => [task.id, ...task.subTaskIds]),
    );
  }
  return new Set();
};

/**
 * Enforces the WorkSession → live Task foreign key at the cross-model boundary.
 *
 * Phase 1 deliberately has no Trash/restore contract for WorkSessions. Deleting
 * or archiving a Task that owns sessions is therefore rejected instead of
 * silently destroying hidden session data or leaving dangling references.
 */
export const workSessionIntegrityMetaReducer: MetaReducer<RootState> = (
  reducer: ActionReducer<RootState>,
): ActionReducer<RootState> => {
  return (state: RootState | undefined, action: Action): RootState => {
    if (state) {
      if (action.type === addWorkSession.type) {
        const { workSession } = action as ReturnType<typeof addWorkSession>;
        if (
          state[TASK_FEATURE_NAME]?.entities[workSession.taskId]?.id !==
          workSession.taskId
        ) {
          throw new Error('WorkSession taskId must reference a live Task');
        }
      }

      if (action.type === updateWorkSession.type) {
        const { changes } = action as ReturnType<typeof updateWorkSession>;
        if (
          changes.taskId !== undefined &&
          state[TASK_FEATURE_NAME]?.entities[changes.taskId]?.id !== changes.taskId
        ) {
          throw new Error('WorkSession taskId must reference a live Task');
        }
      }

      const removedTaskIds = getRemovedTaskIds(state, action);
      if (removedTaskIds.size > 0) {
        assertNoWorkSessionsForTasks(state[WORK_SESSION_FEATURE_NAME], removedTaskIds);
      }
    }

    const next = reducer(state, action);
    // Check the result as well: project cascades and generic LWW replacement
    // can remove a Task or replace a session without a WorkSession CRUD action.
    // Full-state loads use the existing validation/repair boundary instead.
    if (
      action.type !== loadAllData.type &&
      (next[TASK_FEATURE_NAME] !== state?.[TASK_FEATURE_NAME] ||
        next[WORK_SESSION_FEATURE_NAME] !== state?.[WORK_SESSION_FEATURE_NAME])
    ) {
      for (const session of Object.values(
        next[WORK_SESSION_FEATURE_NAME]?.entities ?? {},
      )) {
        if (!isValidWorkSession(session)) throw new Error('Invalid WorkSession');
        if (next[TASK_FEATURE_NAME]?.entities[session.taskId]?.id !== session.taskId) {
          throw new Error('WorkSession taskId must reference a live Task');
        }
      }
    }
    return next;
  };
};
