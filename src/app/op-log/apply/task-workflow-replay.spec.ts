import { TASK_REPLAY_CONTEXT_V1 } from '@sp/shared-schema';
import { TaskSharedActions as T } from '../../root-store/meta/task-shared.actions';
import { createMockTask } from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import {
  prepareTaskReplayAction,
  getOperationTaskReplayContext,
} from '../core/task-replay-context';
import { PersistentAction } from '../core/persistent-action.interface';
import { Operation, OpType } from '../core/operation.types';
import { convertOpToAction } from './operation-converter.util';

describe('versioned Task workflow conversion', () => {
  const operation = (action: PersistentAction): Operation => {
    const prepared = prepareTaskReplayAction(undefined, action);
    const { type, meta, ...body } = prepared;
    return {
      id: 'workflow-op',
      clientId: 'source',
      timestamp: 1,
      vectorClock: { source: 1 },
      schemaVersion: 5,
      actionType: type,
      opType: meta.opType,
      entityType: 'TASK',
      entityId: meta.entityId,
      requiredCapabilities: [TASK_REPLAY_CONTEXT_V1],
      payload: {
        actionPayload: body,
        entityChanges: [],
        taskReplayContext: meta.taskReplayContext,
      },
    } as Operation;
  };
  it('keeps source mutation values rather than injecting the operation ordering timestamp', () => {
    const op = operation(
      T.convertToMainTask({
        task: createMockTask({ id: 'child' }),
        isDone: true,
        isPlanForToday: true,
      }),
    );
    const action = convertOpToAction(op);
    expect(action.modified).toBeUndefined();
    expect(action.doneOn).toBeUndefined();
    expect(action.today).toBeUndefined();
    expect(action.meta.taskReplayContext).toEqual(getOperationTaskReplayContext(op));
    expect(action.meta.taskReplayContext!.modified).not.toBe(op.timestamp);
  });
  it('keeps the source Today for unscheduling instead of deriving it from operation time', () => {
    const op = operation(T.unscheduleTask({ id: 'task', isLeaveInToday: true }));
    const action = convertOpToAction(op);
    expect(action.today).toBeUndefined();
    expect(action.meta.taskReplayContext).toEqual(getOperationTaskReplayContext(op));
  });
  it('carries context for scheduling, rescheduling and nesting, and rejects stripped capability evidence', () => {
    const task = createMockTask({ id: 'task' });
    for (const input of [
      T.scheduleTaskWithTime({ task, dueWithTime: 100, isMoveToBacklog: false }),
      T.reScheduleTaskWithTime({ task, dueWithTime: 200, isMoveToBacklog: true }),
      T.convertToSubTask({
        taskId: task.id,
        targetParentId: 'parent',
        afterTaskId: null,
      }),
    ]) {
      const op = operation(input);
      expect(convertOpToAction(op).meta.taskReplayContext).toEqual(
        getOperationTaskReplayContext(op),
      );
      expect(() => convertOpToAction({ ...op, requiredCapabilities: [] })).toThrow();
    }
  });
  it('allows full-state replacement to retain the account floor without a Task mutation context', () => {
    const op = {
      entityType: 'ALL',
      actionType: '[SP_ALL] Load(import) all data',
      opType: OpType.BackupImport,
      payload: {},
      requiredCapabilities: [TASK_REPLAY_CONTEXT_V1],
    } as Operation;
    expect(getOperationTaskReplayContext(op)).toBeUndefined();
    expect(convertOpToAction(op).meta.taskReplayContext).toBeUndefined();
  });
});
