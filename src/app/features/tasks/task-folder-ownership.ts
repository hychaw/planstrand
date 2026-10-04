import { Task, TaskState } from './task.model';
import { FolderState } from '../folder/folder.model';
import { INBOX_FOLDER_ID } from '../folder/folder.const';
import { projectFolderId } from '../folder/legacy-project-folder-migration';
import { INBOX_PROJECT } from '../project/project.const';
import { ProjectState } from '../project/project.model';
import { taskAdapter } from './store/task.adapter';

/** A stale reference is readable, and never recreates a deleted Folder. */
export const resolveTaskFolderId = (
  task: Pick<Task, 'folderId'>,
  folderState: FolderState,
): string =>
  typeof task.folderId === 'string' &&
  Object.hasOwn(folderState.entities, task.folderId) &&
  folderState.entities[task.folderId]?.id === task.folderId
    ? task.folderId
    : INBOX_FOLDER_ID;

export const taskFolderIdForProject = (
  projectId: unknown,
  project: ProjectState,
  folder: FolderState,
): string => {
  if (
    typeof projectId !== 'string' ||
    projectId === INBOX_PROJECT.id ||
    !Object.hasOwn(project.entities, projectId) ||
    project.entities[projectId]?.id !== projectId
  )
    return INBOX_FOLDER_ID;
  const id = projectFolderId(projectId);
  return !(folder.dismissedProjectFolderIds ?? []).includes(id) &&
    Object.hasOwn(folder.entities, id) &&
    folder.entities[id]?.id === id
    ? id
    : INBOX_FOLDER_ID;
};

/** Iterative, memoized ancestry traversal: deep chains and cycles never recurse. */
export const materializeTaskFolders = (
  task: TaskState,
  project: ProjectState,
  folder: FolderState,
): TaskState => {
  const owners = new Map<string, string>();
  for (const id of task.ids) {
    const path: Task[] = [];
    const visiting = new Set<string>();
    let current = task.entities[id];
    let owner = INBOX_FOLDER_ID;
    while (current) {
      const cached = owners.get(current.id);
      if (cached !== undefined) {
        owner = cached;
        break;
      }
      if (visiting.has(current.id)) break;
      visiting.add(current.id);
      path.push(current);
      // Even a stale stored string is already materialized; never remap it
      // through Project after deletion. Children inherit its effective owner.
      if (typeof current.folderId === 'string') {
        owner = resolveTaskFolderId(current, folder);
        break;
      }
      if (!current.parentId) {
        owner = taskFolderIdForProject(current.projectId, project, folder);
        break;
      }
      current = Object.hasOwn(task.entities, current.parentId)
        ? task.entities[current.parentId]
        : undefined;
    }
    for (const entry of path) owners.set(entry.id, owner);
  }
  const updates = task.ids.flatMap((id) => {
    const entry = task.entities[id];
    return entry && entry.folderId === undefined
      ? [{ id, changes: { folderId: owners.get(id) ?? INBOX_FOLDER_ID } }]
      : [];
  });
  return updates.length ? taskAdapter.updateMany(updates, task) : task;
};

/** Replay batches reconcile only after their complete operation suffix. */
export const materializeTaskFolderState = <
  S extends {
    tasks?: TaskState;
    projects?: ProjectState;
    folder?: FolderState;
  },
>(
  state: S,
): S => {
  if (!state?.tasks || !state.projects || !state.folder?.legacyProjectMigrationComplete)
    return state;
  const tasks = materializeTaskFolders(state.tasks, state.projects, state.folder);
  return tasks === state.tasks ? state : { ...state, tasks };
};
