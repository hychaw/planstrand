import {
  backfillLegacyTaskWorkSessions,
  legacyTaskWorkSessionId,
} from './legacy-task-work-session-backfill';
import { DEFAULT_TASK, TaskState } from '../tasks/task.model';
import { WorkSession, WorkSessionState } from './work-session.model';
import {
  initialWorkSessionState,
  isValidWorkSession,
  workSessionReducer,
} from './store/work-session.reducer';
import {
  completeWorkSession,
  installLegacyWorkSessionBackfill,
  removeWorkSession,
} from './store/work-session.actions';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { initialTaskState } from '../tasks/store/task.reducer';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';

describe('legacy Task WorkSession backfill', () => {
  it('retains intentional dismissal through restart, hydration, retry and stale installation', () => {
    const source = tasks();
    const original = JSON.stringify(source);
    const migrated = migrate(source);
    const id = migrated.ids[0];
    const removed = workSessionReducer(migrated, removeWorkSession({ id }));
    expect(removed.ids).toEqual([]);
    expect(removed.dismissedLegacySessionIds).toEqual([id]);
    const data = createValidAppData({
      task: source,
      workSession: JSON.parse(JSON.stringify(removed)),
    });
    const hydrated = workSessionReducer(
      undefined,
      loadAllData({ appDataComplete: data }),
    );
    expect(migrate(source, hydrated)).toBe(hydrated);
    expect(migrate(source, migrate(source, hydrated), 'Asia/Tokyo')).toBe(hydrated);
    expect(
      workSessionReducer(
        hydrated,
        installLegacyWorkSessionBackfill({ sessions: migrated }),
      ),
    ).toBe(hydrated);
    expect(JSON.stringify(source)).toBe(original);
    // A different legacy timestamp remains eligible; this is not a Task-wide ban.
    expect(migrate(tasks({ dueWithTime: start + 1 }), hydrated).ids.length).toBe(1);
  });
  const start = 1750000000000;
  const duration = 1800000;
  const tasks = (changes: Record<string, unknown> = {}): TaskState =>
    ({
      ...initialTaskState,
      ids: ['task:1'],
      entities: {
        ['task:1']: {
          ...DEFAULT_TASK,
          id: 'task:1',
          projectId: 'INBOX',
          dueWithTime: start,
          timeEstimate: duration,
          ...changes,
        },
      },
    }) as TaskState;
  const migrate = (
    source = tasks(),
    sessions = initialWorkSessionState,
    zone: string | null = 'America/Vancouver',
  ): WorkSessionState => backfillLegacyTaskWorkSessions(source, sessions, zone);

  it('preserves timing, Task identity and source data with an explicit valid zone', () => {
    const source = tasks();
    const original = JSON.stringify(source);
    const result = migrate(source);
    const session = result.entities[result.ids[0]]!;
    expect(isValidWorkSession(session)).toBeTrue();
    expect(session).toEqual({
      id: legacyTaskWorkSessionId('task:1', start),
      taskId: 'task:1',
      start,
      end: start + duration,
      timeZone: 'America/Vancouver',
      created: start,
      modified: start,
    });
    expect(session.completedAt).toBeUndefined();
    expect(JSON.stringify(source)).toBe(original);
  });

  it('is stable and retry-safe after JSON persistence, hydration and timezone changes', () => {
    const first = migrate();
    expect(migrate(tasks(), first)).toBe(first);
    const data = createValidAppData({
      task: tasks(),
      workSession: JSON.parse(JSON.stringify(first)),
    });
    const hydrated = workSessionReducer(
      undefined,
      loadAllData({ appDataComplete: data }),
    );
    expect(migrate(tasks(), hydrated, 'Asia/Tokyo')).toBe(hydrated);
    expect(hydrated.ids.length).toBe(1);
    expect(hydrated.entities[hydrated.ids[0]]?.timeZone).toBe('America/Vancouver');
    expect(legacyTaskWorkSessionId('task:1', start)).toBe(first.ids[0]);
    expect(legacyTaskWorkSessionId('task:1', start + 1)).not.toBe(first.ids[0]);
    expect(legacyTaskWorkSessionId('task:1:2', start)).not.toBe(first.ids[0]);
  });

  it('preserves unrelated and already edited migrated sessions', () => {
    const other: WorkSession = {
      id: 'other',
      taskId: 'task:1',
      start: 1,
      end: 2,
      created: 1,
      modified: 1,
    };
    const existing = { ids: ['other'], entities: { other } };
    const first = migrate(tasks(), existing);
    expect(first.entities['other']).toBe(other);
    expect(first.ids.length).toBe(2);
    const id = legacyTaskWorkSessionId('task:1', start);
    const edited = {
      ...first,
      entities: {
        ...first.entities,
        [id]: { ...first.entities[id]!, start: 42, end: 99, timeZone: 'Asia/Tokyo' },
      },
    };
    expect(migrate(tasks(), edited)).toBe(edited);
  });

  for (const value of [
    0,
    undefined,
    null,
    -1,
    NaN,
    Infinity,
    '60000',
    Number.MAX_VALUE,
  ]) {
    it(`retains legacy scheduling for unusable duration ${String(value)}`, () => {
      const source = tasks({ timeEstimate: value });
      // Overflow case must actually exceed the finite range.
      if (value === Number.MAX_VALUE)
        source.entities['task:1'] = {
          ...source.entities['task:1']!,
          dueWithTime: Number.MAX_VALUE,
        };
      const task = source.entities['task:1'];
      expect(migrate(source)).toBe(initialWorkSessionState);
      expect(source.entities['task:1']).toBe(task);
    });
  }

  for (const value of [undefined, null, NaN, Infinity, -1, '2026-10-02']) {
    it(`ignores untimed/date-only/invalid start ${String(value)}`, () => {
      expect(migrate(tasks({ dueWithTime: value, dueDay: '2026-10-02' }))).toBe(
        initialWorkSessionState,
      );
    });
  }

  it('does not fall back when a configured timezone is invalid', () => {
    const source = tasks();
    expect(migrate(source, initialWorkSessionState, 'invalid/zone')).toBe(
      initialWorkSessionState,
    );
    expect(source.entities['task:1']?.dueWithTime).toBe(start);
  });

  it('uses the system zone when unconfigured, retaining it on later retries', () => {
    const formatter = spyOn(Intl, 'DateTimeFormat').and.returnValue({
      resolvedOptions: () => ({ timeZone: 'Europe/Berlin' }),
    } as Intl.DateTimeFormat);
    const first = migrate(tasks(), initialWorkSessionState, null);
    expect(first.entities[first.ids[0]]?.timeZone).toBe('Europe/Berlin');
    formatter.and.throwError('unavailable');
    expect(migrate(tasks(), first, null)).toBe(first);
    expect(migrate(tasks(), initialWorkSessionState, null)).toBe(initialWorkSessionState);
  });

  it('replaying the durable installation adds once and preserves completion independence', () => {
    const source = tasks();
    const action = installLegacyWorkSessionBackfill({ sessions: migrate(source) });
    expect('meta' in action).toBeFalse();
    const first = workSessionReducer(undefined, action);
    const replayed = workSessionReducer(first, action);
    expect(replayed.ids.length).toBe(1);
    const completed = workSessionReducer(
      replayed,
      completeWorkSession({
        id: replayed.ids[0],
        completedAt: start + duration,
        modified: start + duration,
      }),
    );
    expect(completed.entities[completed.ids[0]]?.completedAt).toBe(start + duration);
    expect(source.entities['task:1']?.isDone).toBeFalse();
    expect(source.entities['task:1']?.dueWithTime).toBe(start);
    expect(source.entities['task:1']?.timeEstimate).toBe(duration);
    expect(workSessionReducer(completed, action)).toBe(completed);
  });
});
