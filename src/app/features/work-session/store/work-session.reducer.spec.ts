import { WorkSession } from '../work-session.model';
import {
  addWorkSession,
  completeWorkSession,
  removeWorkSession,
  uncompleteWorkSession,
  updateWorkSession,
} from './work-session.actions';
import {
  initialWorkSessionState,
  isValidWorkSession,
  workSessionReducer,
} from './work-session.reducer';

const session = (overrides: Partial<WorkSession> = {}): WorkSession => ({
  id: 'session-1',
  taskId: 'task-1',
  start: 100,
  end: 200,
  created: 50,
  modified: 50,
  ...overrides,
});

describe('workSessionReducer', () => {
  it('starts with an empty normalized state', () => {
    expect(initialWorkSessionState).toEqual({ ids: [], entities: {} });
  });

  it('rejects reuse of an existing stable session ID', () => {
    const action = addWorkSession({ workSession: session() });
    const state = workSessionReducer(initialWorkSessionState, action);
    expect(() => workSessionReducer(state, action)).toThrowError(
      'WorkSession id already exists',
    );
    expect(state.entities['session-1']).toEqual(session());
  });

  it('creates a WorkSession with exactly the Phase 1 persisted shape', () => {
    const state = workSessionReducer(
      initialWorkSessionState,
      addWorkSession({
        workSession: session(),
      }),
    );

    expect(state.entities['session-1']).toEqual(session());
    expect(Object.keys(state.entities['session-1']!)).toEqual([
      'id',
      'taskId',
      'start',
      'end',
      'created',
      'modified',
    ]);
  });

  it('rejects future entity fields instead of silently downgrading them', () => {
    const future = { ...session(), timeZone: 'UTC' };
    expect(() =>
      workSessionReducer(
        initialWorkSessionState,
        addWorkSession({ workSession: future }),
      ),
    ).toThrowError('Invalid WorkSession');
    expect(future.timeZone).toBe('UTC');
    expect(initialWorkSessionState).toEqual({ ids: [], entities: {} });
  });

  it('rejects future update fields rather than ignoring them', () => {
    const state = workSessionReducer(
      initialWorkSessionState,
      addWorkSession({ workSession: session() }),
    );
    const changes = { end: 250, timeZone: 'UTC' };
    expect(() =>
      workSessionReducer(
        state,
        updateWorkSession({ id: 'session-1', changes, modified: 100 }),
      ),
    ).toThrowError('Invalid WorkSession changes');
    expect(state.entities['session-1']).toEqual(session());
    expect(changes.timeZone).toBe('UTC');
  });

  it('updates only Phase 1 editable fields and preserves completion', () => {
    const initial = workSessionReducer(
      initialWorkSessionState,
      addWorkSession({ workSession: session({ completedAt: 175 }) }),
    );
    const state = workSessionReducer(
      initial,
      updateWorkSession({
        id: 'session-1',
        changes: { taskId: 'task-2', start: 300, end: 400 },
        modified: 250,
      }),
    );

    expect(state.entities['session-1']).toEqual(
      session({
        taskId: 'task-2',
        start: 300,
        end: 400,
        completedAt: 175,
        modified: 250,
      }),
    );
  });

  it('removes a WorkSession', () => {
    const initial = workSessionReducer(
      initialWorkSessionState,
      addWorkSession({ workSession: session() }),
    );
    const state = workSessionReducer(initial, removeWorkSession({ id: 'session-1' }));
    expect(state).toEqual(initialWorkSessionState);
  });

  it('supports multiple sessions for one Task and sessions for different Tasks', () => {
    let state = initialWorkSessionState;
    state = workSessionReducer(state, addWorkSession({ workSession: session() }));
    state = workSessionReducer(
      state,
      addWorkSession({
        workSession: session({ id: 'session-2', start: 300, end: 400 }),
      }),
    );
    state = workSessionReducer(
      state,
      addWorkSession({
        workSession: session({ id: 'session-3', taskId: 'task-2' }),
      }),
    );
    expect(state.ids).toEqual(['session-1', 'session-2', 'session-3']);
  });

  it('rejects a range whose end is not after its start', () => {
    expect(() =>
      workSessionReducer(
        initialWorkSessionState,
        addWorkSession({ workSession: session({ end: 100 }) }),
      ),
    ).toThrowError('Invalid WorkSession');
  });

  it('rejects nonfinite persisted timestamps and malformed completion', () => {
    expect(isValidWorkSession(session({ start: Number.NaN }))).toBeFalse();
    expect(
      isValidWorkSession(session({ modified: Number.POSITIVE_INFINITY })),
    ).toBeFalse();
    expect(isValidWorkSession({ ...session(), completedAt: 'done' })).toBeFalse();
  });

  it('completes only through the explicit completion action', () => {
    const initial = workSessionReducer(
      initialWorkSessionState,
      addWorkSession({ workSession: session({ start: 1, end: 10 }) }),
    );
    const elapsedButUntouched = workSessionReducer(initial, { type: '[Clock] Tick' });
    expect(elapsedButUntouched.entities['session-1']!.completedAt).toBeUndefined();

    const completed = workSessionReducer(
      elapsedButUntouched,
      completeWorkSession({ id: 'session-1', completedAt: 500, modified: 500 }),
    );
    expect(completed.entities['session-1']!.completedAt).toBe(500);
  });

  it('uncompletes to canonical null and persists it', () => {
    const completed = workSessionReducer(
      initialWorkSessionState,
      addWorkSession({ workSession: session({ completedAt: 175 }) }),
    );
    const state = workSessionReducer(
      completed,
      uncompleteWorkSession({ id: 'session-1', modified: 600 }),
    );
    expect(state.entities['session-1']!.completedAt).toBeNull();
    expect(Object.hasOwn(state.entities['session-1']!, 'completedAt')).toBeTrue();
  });

  it('editing an elapsed session does not complete it', () => {
    const initial = workSessionReducer(
      initialWorkSessionState,
      addWorkSession({ workSession: session({ start: 1, end: 10 }) }),
    );
    const state = workSessionReducer(
      initial,
      updateWorkSession({ id: 'session-1', changes: { end: 20 }, modified: 500 }),
    );
    expect(state.entities['session-1']!.completedAt).toBeUndefined();
  });
});
