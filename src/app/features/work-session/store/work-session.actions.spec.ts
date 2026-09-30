import { OpType } from '../../../op-log/core/operation.types';
import {
  addWorkSession,
  completeWorkSession,
  removeWorkSession,
  uncompleteWorkSession,
  updateWorkSession,
} from './work-session.actions';

describe('WorkSession actions', () => {
  const session = {
    id: 'session-1',
    taskId: 'task-1',
    start: 100,
    end: 200,
    created: 50,
    modified: 50,
  };

  it('marks every mutation as a persistent WORK_SESSION operation', () => {
    const actions = [
      addWorkSession({ workSession: session }),
      updateWorkSession({ id: session.id, changes: { start: 110 }, modified: 60 }),
      removeWorkSession({ id: session.id }),
      completeWorkSession({ id: session.id, completedAt: 70, modified: 70 }),
      uncompleteWorkSession({ id: session.id, modified: 80 }),
    ];

    for (const action of actions) {
      expect(action.meta.isPersistent).toBeTrue();
      expect(action.meta.entityType).toBe('WORK_SESSION');
      expect(action.meta.entityId).toBe(session.id);
    }
    expect(actions.map((action) => action.meta.opType)).toEqual([
      OpType.Create,
      OpType.Update,
      OpType.Delete,
      OpType.Update,
      OpType.Update,
    ]);
  });
});
