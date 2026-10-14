import { createSelector } from '@ngrx/store';
import { selectFolderFeatureState } from '../../features/folder/store/folder.selectors';
import { folderTreeRows } from '../../features/folder/folder-tree';
import { selectAllTasksWithSubTasks } from '../../features/tasks/store/task.selectors';
import { resolveTaskFolderId } from '../../features/tasks/task-folder-ownership';
import { selectProjectFeatureState } from '../../features/project/store/project.selectors';
import { TaskWithSubTasks } from '../../features/tasks/task.model';

export const selectPlanstrandFolderRows = createSelector(
  selectFolderFeatureState,
  folderTreeRows,
);
/** Folder and Unplanned views project the persisted Project lists, never Task entity IDs.
 * Project order is stable; regular/backlog lists remain separate ordering domains.
 */
export const selectCanonicalTasks = createSelector(
  selectAllTasksWithSubTasks,
  selectProjectFeatureState,
  (tasks, projects) => {
    const remaining = new Map(tasks.map((task) => [task.id, task]));
    const ordered: TaskWithSubTasks[] = [];
    for (const id of projects.ids) {
      const project = projects.entities[id];
      if (!project) continue;
      for (const taskId of [...project.taskIds, ...project.backlogTaskIds]) {
        const task = remaining.get(taskId);
        if (task && task.projectId === id) {
          ordered.push(task);
          remaining.delete(taskId);
        }
      }
    }
    return [...ordered, ...remaining.values()];
  },
);
export const selectMasterTaskGroups = createSelector(
  selectFolderFeatureState,
  selectCanonicalTasks,
  (folders, tasks) => {
    const groups = new Map<string, TaskWithSubTasks[]>();
    for (const task of tasks) {
      const owner = resolveTaskFolderId(task, folders);
      const group = groups.get(owner) ?? [];
      group.push(task);
      groups.set(owner, group);
    }
    return groups;
  },
);
