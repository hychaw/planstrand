import { createEntityAdapter, EntityAdapter } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { WorkSession, WorkSessionState } from '../work-session.model';
import * as WorkSessionActions from './work-session.actions';
import { isValidEntityId } from '../../../op-log/validation/is-valid-entity-id';
import { isValidIanaTimeZone } from '../../../util/iana-time-zone';
import {
  isDeterministicLegacyTaskWorkSessionId,
  isLegacyTaskWorkSessionId,
} from '../legacy-task-work-session-backfill';

export const WORK_SESSION_FEATURE_NAME = 'workSession';

export const workSessionAdapter: EntityAdapter<WorkSession> =
  createEntityAdapter<WorkSession>();

export const initialWorkSessionState: WorkSessionState = {
  ...workSessionAdapter.getInitialState(),
  ids: [],
};

const isPersistedTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const WORK_SESSION_KEYS = new Set([
  'id',
  'taskId',
  'start',
  'end',
  'timeZone',
  'completedAt',
  'created',
  'modified',
]);

export const isValidWorkSession = (value: unknown): value is WorkSession => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  const completedAt = session['completedAt'];
  return (
    Object.keys(session).every((key) => WORK_SESSION_KEYS.has(key)) &&
    isValidEntityId(session['id']) &&
    isValidEntityId(session['taskId']) &&
    isPersistedTimestamp(session['start']) &&
    isPersistedTimestamp(session['end']) &&
    session['end'] > session['start'] &&
    (!Object.hasOwn(session, 'timeZone') ||
      (typeof session['timeZone'] === 'string' &&
        isValidIanaTimeZone(session['timeZone']))) &&
    (completedAt === undefined ||
      completedAt === null ||
      isPersistedTimestamp(completedAt)) &&
    isPersistedTimestamp(session['created']) &&
    isPersistedTimestamp(session['modified'])
  );
};

export const assertNoWorkSessionsForTasks = (
  state: WorkSessionState | undefined,
  taskIds: ReadonlySet<string>,
): void => {
  if (
    Object.values(state?.entities ?? {}).some(
      (session) => session && taskIds.has(session.taskId),
    )
  ) {
    throw new Error('Remove WorkSessions before deleting or archiving their Task');
  }
};

const assertValid = (session: WorkSession): WorkSession => {
  if (!isValidWorkSession(session)) {
    throw new Error('Invalid WorkSession');
  }
  return session;
};

/** Validate incoming data without downgrading or deleting any entity payload. */
export const isValidWorkSessionState = (
  value: unknown,
  liveTaskIds: ReadonlySet<string>,
): value is WorkSessionState => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as WorkSessionState;
  if (
    Object.keys(state).some(
      (key) => !['ids', 'entities', 'dismissedLegacySessionIds'].includes(key),
    ) ||
    (state.dismissedLegacySessionIds !== undefined &&
      (!Array.isArray(state.dismissedLegacySessionIds) ||
        state.dismissedLegacySessionIds.some(
          (id) => !isValidEntityId(id) || !isLegacyTaskWorkSessionId(id),
        ) ||
        new Set(state.dismissedLegacySessionIds).size !==
          state.dismissedLegacySessionIds.length)) ||
    !Array.isArray(state.ids) ||
    state.ids.some((id) => typeof id !== 'string') ||
    new Set(state.ids).size !== state.ids.length ||
    typeof state.entities !== 'object' ||
    state.entities === null ||
    Array.isArray(state.entities)
  )
    return false;
  const entries = Object.entries(state.entities);
  const ids = new Set(state.ids);
  return (
    entries.length === ids.size &&
    entries.every(
      ([id, session]) =>
        ids.has(id) &&
        isValidWorkSession(session) &&
        session.id === id &&
        liveTaskIds.has(session.taskId),
    )
  );
};

/** Existing entities receive deltas; only absent, undismissed migrations use a seed. */
const mutationBase = (
  state: WorkSessionState,
  id: string,
  legacySession?: WorkSession,
): WorkSession | undefined => {
  const current = state.entities[id];
  if (current) return current;
  if (
    !legacySession ||
    !isDeterministicLegacyTaskWorkSessionId(id) ||
    state.dismissedLegacySessionIds?.includes(id)
  )
    return undefined;
  if (legacySession.id !== id || !isValidWorkSession(legacySession)) {
    throw new Error('Invalid migrated WorkSession seed');
  }
  // The cross-model integrity boundary validates the resulting live Task reference.
  // Never derive timezone, duration or completion from receiver-specific state.
  return legacySession;
};

export const workSessionReducer = createReducer(
  initialWorkSessionState,

  // Startup migration only: already durable, so this must not create an op.
  // addMany preserves sessions edited/created while persistence was awaiting I/O.
  on(WorkSessionActions.installLegacyWorkSessionBackfill, (state, { sessions }) =>
    workSessionAdapter.addMany(
      Object.values(sessions.entities).filter(
        (s): s is WorkSession => !!s && !state.dismissedLegacySessionIds?.includes(s.id),
      ),
      state,
    ),
  ),

  on(loadAllData, (_state, { appDataComplete }) => {
    if (!Object.hasOwn(appDataComplete, 'workSession')) return initialWorkSessionState;
    const state = (appDataComplete as { workSession: unknown }).workSession;
    if (
      !isValidWorkSessionState(
        state,
        new Set(
          (appDataComplete.task?.ids ?? []).filter(
            (id) => appDataComplete.task.entities[id]?.id === id,
          ) as string[],
        ),
      )
    )
      throw new Error('Invalid WorkSession state');
    return state;
  }),

  on(WorkSessionActions.addWorkSession, (state, { workSession }) => {
    if (state.entities[workSession.id]) {
      throw new Error('WorkSession id already exists');
    }
    return workSessionAdapter.addOne(assertValid(workSession), state);
  }),

  on(
    WorkSessionActions.updateWorkSession,
    (state, { id, changes, modified, legacySession }) => {
      const current = mutationBase(state, id, legacySession);
      if (!current) return state;
      assertValid(current);
      if (
        Object.keys(changes).some(
          (key) => !['taskId', 'start', 'end', 'timeZone'].includes(key),
        ) ||
        (Object.hasOwn(changes, 'timeZone') &&
          (typeof changes.timeZone !== 'string' ||
            !isValidIanaTimeZone(changes.timeZone)))
      ) {
        throw new Error('Invalid WorkSession changes');
      }
      const next = assertValid({
        ...current,
        ...(changes.taskId !== undefined ? { taskId: changes.taskId } : {}),
        ...(changes.start !== undefined ? { start: changes.start } : {}),
        ...(changes.end !== undefined ? { end: changes.end } : {}),
        ...(changes.timeZone !== undefined ? { timeZone: changes.timeZone } : {}),
        modified,
      });
      return workSessionAdapter.setOne(next, state);
    },
  ),

  on(WorkSessionActions.removeWorkSession, (state, { id }) => {
    const removed = workSessionAdapter.removeOne(id, state);
    // Derive from the operation identity, even when replay has no entity left.
    // One reducer pass atomically records dismissal and removes the session.
    if (!isLegacyTaskWorkSessionId(id) || state.dismissedLegacySessionIds?.includes(id))
      return removed;
    return {
      ...removed,
      dismissedLegacySessionIds: [...(state.dismissedLegacySessionIds ?? []), id].sort(),
    };
  }),

  on(
    WorkSessionActions.completeWorkSession,
    (state, { id, completedAt, modified, legacySession }) => {
      const current = mutationBase(state, id, legacySession);
      if (!current) return state;
      assertValid(current);
      return workSessionAdapter.setOne(
        assertValid({ ...current, completedAt, modified }),
        state,
      );
    },
  ),

  on(
    WorkSessionActions.uncompleteWorkSession,
    (state, { id, modified, legacySession }) => {
      const current = mutationBase(state, id, legacySession);
      if (!current) return state;
      assertValid(current);
      return workSessionAdapter.setOne(
        assertValid({ ...current, completedAt: null, modified }),
        state,
      );
    },
  ),
);
