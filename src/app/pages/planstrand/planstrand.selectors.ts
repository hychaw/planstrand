import { createSelector } from '@ngrx/store';
import { selectFolderFeatureState } from '../../features/folder/store/folder.selectors';
import { folderTreeRows } from '../../features/folder/folder-tree';
import { selectAllTasksWithSubTasks } from '../../features/tasks/store/task.selectors';
import { resolveTaskFolderId } from '../../features/tasks/task-folder-ownership';
import { TaskWithSubTasks } from '../../features/tasks/task.model';

export const selectPlanstrandFolderRows = createSelector(
  selectFolderFeatureState,
  folderTreeRows,
);
export const selectMasterTaskGroups = createSelector(
  selectFolderFeatureState,
  selectAllTasksWithSubTasks,
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
