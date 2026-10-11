import { Action } from '@ngrx/store';
import { TASK_REPLAY_CONTEXT_V1 } from '@sp/shared-schema';
import { AppState } from '../../root-store/app-state/app-state.reducer';
import { getDbDateStr, isValidDBDateStr } from '../../util/get-db-date-str';
import { isValidEntityId } from '../validation/is-valid-entity-id';
import { ActionType } from './action-types.enum';
import type { PersistentAction } from './persistent-action.interface';

export type TaskReplayContexts = Record<string, TaskReplayContext>;

/** Actions whose source calendar/mutation values must survive replay. */
export const TASK_CONTEXT_ACTIONS: readonly string[] = [
  ActionType.TASK_SHARED_UPDATE,
  ActionType.TASK_SHARED_SCHEDULE_WITH_TIME,
  ActionType.TASK_SHARED_RESCHEDULE_WITH_TIME,
  ActionType.TASK_SHARED_UNSCHEDULE,
  ActionType.TASK_SHARED_CONVERT_TO_MAIN,
  ActionType.TASK_SHARED_CONVERT_TO_SUB,
];

/** Source mutation values; the operation's ordering timestamp remains independent. */
export interface TaskReplayContext {
  version: 1;
  /** null preserves a winning Task that has never had a modified value. */
  modified: number | null;
  today: string;
  /** Source-local day boundaries including the configured logical-day offset. */
  todayStart: number;
  todayEnd: number;
  /** Source-local calendar date of updateTask's completion timestamp. */
  completionDay?: string;
}

export const assertTaskReplayContext: (
  value: unknown,
) => asserts value is TaskReplayContext = (value) => {
  const c = value as TaskReplayContext | undefined;
  if (
    !c ||
    typeof c !== 'object' ||
    Array.isArray(c) ||
    c.version !== 1 ||
    (c.modified !== null && (!Number.isSafeInteger(c.modified) || c.modified < 0)) ||
    typeof c.today !== 'string' ||
    !isValidDBDateStr(c.today) ||
    !Number.isSafeInteger(c.todayStart) ||
    !Number.isSafeInteger(c.todayEnd) ||
    c.todayEnd <= c.todayStart ||
    c.todayEnd - c.todayStart > 172800000 ||
    (c.completionDay !== undefined &&
      (typeof c.completionDay !== 'string' || !isValidDBDateStr(c.completionDay))) ||
    Object.keys(c).some(
      (key) =>
        ![
          'version',
          'modified',
          'today',
          'todayStart',
          'todayEnd',
          'completionDay',
        ].includes(key),
    )
  )
    throw new Error('Invalid or unsupported Task replay context');
};

export const captureTaskReplayContext = (
  calendar?: AppState,
  modified?: number | null,
): TaskReplayContext => {
  const now = Date.now();
  const today = calendar?.todayStr ?? getDbDateStr(now);
  const [year, month, day] = today.split('-').map(Number);
  const offset = calendar?.startOfNextDayDiffMs ?? 0;
  const context: TaskReplayContext = {
    version: 1,
    modified: modified === undefined ? now : modified,
    today,
    todayStart: new Date(year, month - 1, day).getTime() + offset,
    todayEnd: new Date(year, month - 1, day + 1).getTime() + offset,
  };
  assertTaskReplayContext(context);
  return context;
};

export const prepareTaskReplayAction = <A extends Action>(
  state: { appState?: AppState } | undefined,
  original: A,
): A => {
  if (!TASK_CONTEXT_ACTIONS.includes(original.type)) return original;
  const action = original as unknown as PersistentAction;
  // Archive mutations prepare their action before I/O and dispatch the same
  // context afterwards. Never resample it at that later capture boundary.
  const supplied = readTaskReplayContext(action.meta?.taskReplayContext);
  const context = supplied ?? captureTaskReplayContext(state?.appState);
  if (original.type !== ActionType.TASK_SHARED_UPDATE) {
    if (context.modified === null)
      throw new Error('Missing source Task mutation timestamp');
    return {
      ...original,
      meta: { ...action.meta, taskReplayContext: context },
    };
  }
  const changes = action.task.changes;
  const timestamp = context.modified!;
  if (changes.isDone === true && !supplied)
    context.completionDay = getDbDateStr(
      typeof changes.doneOn === 'number' ? changes.doneOn : timestamp,
    );
  assertTaskReplayContext(context);
  if (context.modified === null) throw new Error('Missing source Task update timestamp');
  if (changes.isDone === true && !context.completionDay)
    throw new Error('Missing source Task completion day');
  return {
    ...original,
    task: {
      ...action.task,
      changes: {
        ...changes,
        ...(changes.isDone === true && typeof changes.doneOn !== 'number'
          ? { doneOn: timestamp }
          : {}),
      },
    },
    meta: { ...action.meta, taskReplayContext: context },
  };
};

export const readTaskReplayContext = (value: unknown): TaskReplayContext | undefined => {
  if (value === undefined) return undefined;
  assertTaskReplayContext(value);
  return value;
};

interface TaskContextOperation {
  actionType: string;
  entityType?: string;
  payload: unknown;
  requiredCapabilities?: string[];
  entityId?: string;
}

/** Each batch member keeps its own source calendar/completion values. */
export const getOperationTaskReplayContexts = (
  op: TaskContextOperation,
): TaskReplayContexts | undefined => {
  const outer = op.payload as {
    taskReplayContext?: unknown;
    actionPayload?: { tasks?: unknown };
    tasks?: unknown;
  } | null;
  const contexts = outer?.taskReplayContext;
  if (op.actionType !== ActionType.TASK_SHARED_UPDATE_MULTIPLE) return undefined;
  if (
    contexts === undefined &&
    !op.requiredCapabilities?.includes(TASK_REPLAY_CONTEXT_V1)
  )
    return undefined;
  const tasks = (outer?.actionPayload ?? outer)?.tasks;
  if (
    op.entityType !== 'TASK' ||
    !op.requiredCapabilities?.includes(TASK_REPLAY_CONTEXT_V1) ||
    !contexts ||
    typeof contexts !== 'object' ||
    Array.isArray(contexts) ||
    !Array.isArray(tasks) ||
    !tasks.length
  )
    throw new Error('Invalid batch Task replay context');
  const ids = new Set<string>();
  for (const task of tasks) {
    if (
      !task ||
      !isValidEntityId(task.id) ||
      ids.has(task.id) ||
      !task.changes ||
      typeof task.changes !== 'object' ||
      Array.isArray(task.changes) ||
      !Object.hasOwn(contexts, task.id)
    )
      throw new Error('Invalid batch Task replay context footprint');
    ids.add(task.id);
    const context = (contexts as TaskReplayContexts)[task.id];
    assertTaskReplayContext(context);
    if (
      context.modified === null ||
      (task.changes.isDone === true && !context.completionDay)
    )
      throw new Error('Missing source batch Task mutation values');
  }
  if (Object.keys(contexts).length !== ids.size)
    throw new Error('Invalid batch Task replay context footprint');
  return contexts as TaskReplayContexts;
};

export const getOperationTaskReplayContext = (
  op: TaskContextOperation,
  entityId = op.entityId,
): TaskReplayContext | undefined => {
  if (op.actionType === ActionType.TASK_SHARED_UPDATE_MULTIPLE) {
    const contexts = getOperationTaskReplayContexts(op);
    return contexts && entityId && Object.hasOwn(contexts, entityId)
      ? contexts[entityId]
      : undefined;
  }
  const context = (op.payload as { taskReplayContext?: unknown } | null)
    ?.taskReplayContext;
  // A full-state snapshot carries the durable account floor, not an individual
  // Task mutation. That floor must survive replacement without requiring a
  // synthetic Task context on the snapshot itself.
  if (op.entityType === 'ALL' && context === undefined) return undefined;
  if (context === undefined && !op.requiredCapabilities?.includes(TASK_REPLAY_CONTEXT_V1))
    return undefined;
  if (
    (op.entityType !== undefined && op.entityType !== 'TASK') ||
    ![...TASK_CONTEXT_ACTIONS, '[TASK] LWW Update'].includes(op.actionType) ||
    !op.requiredCapabilities?.includes(TASK_REPLAY_CONTEXT_V1)
  )
    throw new Error('Task replay context requires its semantic reader capability');
  assertTaskReplayContext(context);
  if (TASK_CONTEXT_ACTIONS.includes(op.actionType) && context.modified === null)
    throw new Error('Missing source Task mutation timestamp');
  if (op.actionType === ActionType.TASK_SHARED_UPDATE) {
    if (context.modified === null)
      throw new Error('Missing source Task update timestamp');
    const payload = op.payload as {
      actionPayload?: { task?: { changes?: { isDone?: boolean } } };
      task?: { changes?: { isDone?: boolean } };
    };
    if (
      (payload.actionPayload ?? payload).task?.changes?.isDone === true &&
      !context.completionDay
    )
      throw new Error('Missing source Task completion day');
  }
  return context;
};
