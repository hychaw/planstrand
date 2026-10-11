import { Action } from '@ngrx/store';
import { TASK_REPLAY_CONTEXT_V1 } from '@sp/shared-schema';
import { AppState } from '../../root-store/app-state/app-state.reducer';
import { getDbDateStr, isValidDBDateStr } from '../../util/get-db-date-str';
import { ActionType } from './action-types.enum';
import type { PersistentAction } from './persistent-action.interface';

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
  if (original.type !== ActionType.TASK_SHARED_UPDATE) return original;
  const action = original as unknown as PersistentAction;
  const changes = action.task.changes;
  const context = captureTaskReplayContext(state?.appState);
  const timestamp = context.modified!;
  if (changes.isDone === true)
    context.completionDay = getDbDateStr(
      typeof changes.doneOn === 'number' ? changes.doneOn : timestamp,
    );
  assertTaskReplayContext(context);
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

export const getOperationTaskReplayContext = (op: {
  actionType: string;
  entityType?: string;
  payload: unknown;
  requiredCapabilities?: string[];
}): TaskReplayContext | undefined => {
  const context = (op.payload as { taskReplayContext?: unknown } | null)
    ?.taskReplayContext;
  if (context === undefined && !op.requiredCapabilities?.includes(TASK_REPLAY_CONTEXT_V1))
    return undefined;
  if (
    (op.entityType !== undefined && op.entityType !== 'TASK') ||
    ![ActionType.TASK_SHARED_UPDATE as string, '[TASK] LWW Update'].includes(
      op.actionType,
    ) ||
    !op.requiredCapabilities?.includes(TASK_REPLAY_CONTEXT_V1)
  )
    throw new Error('Task replay context requires its semantic reader capability');
  assertTaskReplayContext(context);
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
