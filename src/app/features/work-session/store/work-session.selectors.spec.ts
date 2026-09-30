import { WorkSession } from '../work-session.model';
import {
  selectWorkSessionById,
  selectWorkSessionsByTaskId,
} from './work-session.selectors';

describe('WorkSession selectors', () => {
  const session = (id: string, taskId: string): WorkSession => ({
    id,
    taskId,
    start: 100,
    end: 200,
    created: 50,
    modified: 50,
  });
  const sessions = [
    session('a', 'task-1'),
    session('b', 'task-1'),
    session('c', 'task-2'),
  ];

  it('selects zero, one, or many sessions by Task without combining owners', () => {
    expect(
      selectWorkSessionsByTaskId.projector(sessions, 'task-1', { taskId: 'task-1' }),
    ).toEqual(sessions.slice(0, 2));
    expect(
      selectWorkSessionsByTaskId.projector(sessions, 'task-2', { taskId: 'task-2' }),
    ).toEqual([sessions[2]]);
    expect(
      selectWorkSessionsByTaskId.projector(sessions, 'missing', { taskId: 'missing' }),
    ).toEqual([]);
  });

  it('selects by stable ID and returns undefined for a missing session', () => {
    expect(selectWorkSessionById.projector({ a: sessions[0] }, { id: 'a' })).toBe(
      sessions[0],
    );
    expect(selectWorkSessionById.projector({}, { id: 'missing' })).toBeUndefined();
  });
});
