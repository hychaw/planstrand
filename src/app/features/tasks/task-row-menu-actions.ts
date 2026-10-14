import { InjectionToken } from '@angular/core';
import { Task, TaskWithSubTasks } from './task.model';
import { PlanningPlacement } from '../planning/planning.model';

/** The owning list supplies its existing ordering and folder commands. */
export interface TaskRowMenuActions {
  canMoveTask(task: Task, direction: -1 | 1, isNested?: boolean): boolean;
  moveTask(task: Task, direction: -1 | 1, isNested?: boolean): void;
  moveTaskToFolder(task: Task): void;
  plan(task: TaskWithSubTasks, target: string): void;
  chooseDestination(
    task: TaskWithSubTasks,
    type: 'DAY' | 'WEEK',
    current?: PlanningPlacement['target'],
  ): void;
  schedule(task: TaskWithSubTasks): void;
  planningTarget(task: Task): PlanningPlacement['target'] | undefined;
}

export const TASK_ROW_MENU_ACTIONS = new InjectionToken<TaskRowMenuActions>(
  'TASK_ROW_MENU_ACTIONS',
);
