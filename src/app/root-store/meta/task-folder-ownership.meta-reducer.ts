import { isValidTaskProjectIdUpdate } from './task-shared-meta-reducers/task-shared-helpers';
import { RootState } from '../root-state';
import { installLegacyFolderMigration } from '../../features/folder/store/folder.actions';
import { toLwwUpdateActionType } from '../../op-log/core/lww-update-action-types';
import { Action, ActionReducer } from '@ngrx/store';
import { FolderState } from '../../features/folder/folder.model';
import { ProjectState } from '../../features/project/project.model';
import { Task, TaskState } from '../../features/tasks/task.model';
import { taskAdapter } from '../../features/tasks/store/task.adapter';
import { addSubTask, moveSubTask } from '../../features/tasks/store/task.actions';
import { TaskSharedActions } from './task-shared.actions';
import {
  materializeTaskFolders,
  resolveTaskFolderId,
  taskFolderIdForProject,
} from '../../features/tasks/task-folder-ownership';

export interface TaskFolderState {
  tasks?: TaskState;
  projects?: ProjectState;
  folder?: FolderState;
}

type OwnershipAction = Action & {
  task?: Task & { changes?: Partial<Task> };
  subTasks?: Task[];
  parentId?: string;
  folderId?: string;
  targetProjectId?: string;
  projectId?: string;
  meta?: { isRemote?: boolean };
};

// Capture sees the original dispatch object, while reducers receive the prepared
// copy. Keep the exact accepted payload through asynchronous writes and retries.
const preparedActions = new WeakMap<Action, Action>();
export const getTaskFolderCaptureAction = <A extends Action>(action: A): A =>
  (preparedActions.get(action) ?? action) as A;
export const rememberTaskFolderCaptureAction = (
  original: Action,
  prepared: Action,
): void => {
  if (original !== prepared) preparedActions.set(original, prepared);
};

export const prepareTaskFolderAction = <A extends Action>(
  state: TaskFolderState | undefined,
  original: A,
): A => {
  if (!state?.folder || !state.projects) return original;
  const action = original as OwnershipAction;
  if (action.type === TaskSharedActions.batchUpdateForProject.type) {
    return {
      ...original,
      folderId: taskFolderIdForProject(action.projectId, state.projects, state.folder),
    };
  }
  if (
    action.type === TaskSharedActions.updateTask.type &&
    action.task?.changes &&
    Object.hasOwn(action.task.changes, 'projectId')
  ) {
    const current = state.tasks?.entities[action.task.id];
    const target = action.task.changes.projectId;
    if (
      !current ||
      typeof target !== 'string' ||
      !isValidTaskProjectIdUpdate(state as RootState, current, target)
    )
      return original;
    return {
      ...original,
      task: {
        ...action.task,
        changes: {
          ...action.task.changes,
          folderId:
            action.task.changes.folderId ??
            taskFolderIdForProject(
              action.task.changes.projectId,
              state.projects,
              state.folder,
            ),
        },
      },
    };
  }
  if (action.type === TaskSharedActions.restoreTask.type && action.task) {
    const folderId =
      action.task.folderId ??
      taskFolderIdForProject(action.task.projectId, state.projects, state.folder);
    return {
      ...original,
      task: { ...action.task, folderId },
      subTasks: (action.subTasks ?? []).map((child) => ({
        ...child,
        folderId: resolveTaskFolderId({ folderId }, state.folder!),
      })),
    };
  }
  if (action.type === TaskSharedActions.addTask.type || action.type === addSubTask.type) {
    if (!action.task) return original;
    const parent = state.tasks?.entities[action.parentId ?? action.task.parentId ?? ''];
    const folderId = parent
      ? resolveTaskFolderId(parent, state.folder)
      : (action.task.folderId ??
        taskFolderIdForProject(action.task.projectId, state.projects, state.folder));
    return { ...original, task: { ...action.task, folderId } };
  }
  if (
    action.type === TaskSharedActions.moveToOtherProject.type ||
    (action.type === TaskSharedActions.applyShortSyntax.type &&
      action.targetProjectId !== undefined)
  ) {
    return {
      ...original,
      folderId: taskFolderIdForProject(
        action.targetProjectId,
        state.projects,
        state.folder,
      ),
    };
  }
  return original;
};

const relationshipTypes = new Set<string>([
  addSubTask.type,
  moveSubTask.type,
  TaskSharedActions.convertToSubTask.type,
  TaskSharedActions.moveToOtherProject.type,
  TaskSharedActions.applyShortSyntax.type,
  TaskSharedActions.restoreTask.type,
  TaskSharedActions.updateTask.type,
  TaskSharedActions.batchUpdateForProject.type,
  TaskSharedActions.addTask.type,
  toLwwUpdateActionType('TASK'),
]);

/** Inside bulk replay, outside Folder seeding: reconciliation precedes ownership.
 * No dispatch, action mutation, or synthetic operation on hydration/replay.
 */
export const taskFolderOwnershipMetaReducer =
  <S extends TaskFolderState>(reducer: ActionReducer<S>): ActionReducer<S> =>
  (state, original): S => {
    const next = reducer(state, original);
    if (!next.tasks || !next.projects || !next.folder) return next;
    let task = next.tasks;
    const action = original as OwnershipAction;
    const isRemote = !!action.meta?.isRemote;
    if (
      (action.type === TaskSharedActions.moveToOtherProject.type ||
        (action.type === TaskSharedActions.applyShortSyntax.type &&
          action.targetProjectId !== undefined)) &&
      action.task
    ) {
      const entry = task.entities[action.task.id];
      if (
        entry &&
        entry.projectId === action.targetProjectId &&
        (!isRemote || entry.folderId !== undefined || action.folderId !== undefined)
      ) {
        task = taskAdapter.updateOne(
          {
            id: entry.id,
            changes: {
              folderId:
                action.folderId ??
                taskFolderIdForProject(
                  action.targetProjectId,
                  next.projects,
                  next.folder,
                ),
            },
          },
          task,
        );
      }
    }
    if (
      action.type === TaskSharedActions.updateTask.type &&
      action.task?.changes &&
      Object.hasOwn(action.task.changes, 'projectId')
    ) {
      const entry = task.entities[action.task.id];
      if (
        entry &&
        entry.projectId === action.task.changes.projectId &&
        (!isRemote ||
          entry.folderId !== undefined ||
          action.task.changes.folderId !== undefined)
      ) {
        task = taskAdapter.updateOne(
          {
            id: entry.id,
            changes: {
              folderId:
                action.task.changes.folderId ??
                taskFolderIdForProject(entry.projectId, next.projects, next.folder),
            },
          },
          task,
        );
      }
    }
    if (
      next.folder.legacyProjectMigrationComplete &&
      action.type === installLegacyFolderMigration.type
    ) {
      task = materializeTaskFolders(task, next.projects, next.folder);
    }
    const updatesOwnership =
      (action.type !== TaskSharedActions.applyShortSyntax.type ||
        action.targetProjectId !== undefined) &&
      (action.type !== TaskSharedActions.updateTask.type ||
        (!!action.task?.changes &&
          ['parentId', 'projectId', 'folderId'].some((key) =>
            Object.hasOwn(action.task!.changes!, key),
          )));
    if (relationshipTypes.has(action.type) && updatesOwnership && task !== state?.tasks) {
      const owners = new Map<string, string>();
      for (const id of task.ids) {
        const path: string[] = [];
        const seen = new Set<string>();
        let entry = task.entities[id];
        let owner: string | undefined;
        while (entry && !seen.has(entry.id)) {
          owner = owners.get(entry.id);
          if (owner !== undefined) break;
          seen.add(entry.id);
          path.push(entry.id);
          if (!entry.parentId) {
            if (entry.folderId === undefined) break;
            owner = resolveTaskFolderId(entry, next.folder);
            break;
          }
          entry = task.entities[entry.parentId];
        }
        if (owner === undefined) continue;
        for (const childId of path) owners.set(childId, owner);
      }
      task = taskAdapter.updateMany(
        task.ids.flatMap((id) => {
          const entry = task.entities[id];
          const folderId = owners.get(id);
          return entry?.parentId && folderId !== undefined && entry.folderId !== folderId
            ? [{ id, changes: { folderId } }]
            : [];
        }),
        task,
      );
    }
    return task === next.tasks ? next : { ...next, tasks: task };
  };
