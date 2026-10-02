import { DEFAULT_TASK, Task, TaskWithDueTime } from '../tasks/task.model';
import { WorkSession } from '../work-session/work-session.model';
import { legacyTaskWorkSessionId } from '../work-session/legacy-task-work-session-backfill';
import {
  projectCalendarIntegrationEvent,
  projectLocalCalendarDisplayItems,
  projectWorkSession,
} from './calendar-display-item';
import { selectLocalCalendarDisplayItems } from './calendar-display-item.selectors';
import { ScheduleFromCalendarEvent } from './schedule.model';

describe('CalendarDisplayItem projection', () => {
  const start = 1750000000000;
  const task: TaskWithDueTime = {
    ...DEFAULT_TASK,
    id: 'task-1',
    projectId: 'INBOX',
    title: 'Task title',
    dueWithTime: start,
    timeEstimate: 1800000,
    timeSpent: 600000,
  };
  const session: WorkSession = {
    id: 'session-1',
    taskId: task.id,
    start,
    end: start + 1800000,
    timeZone: 'America/Vancouver',
    created: start,
    modified: start,
  };
  const migrated: WorkSession = {
    ...session,
    id: legacyTaskWorkSessionId(task.id, start),
  };
  const external: ScheduleFromCalendarEvent = {
    id: 'event-1',
    calProviderId: 'calendar-1',
    issueProviderKey: 'ICAL',
    title: 'Event title',
    start,
    duration: 3600000,
  };

  it('projects one session with exact instants, zone, identity, Task title and capabilities', () => {
    expect(projectWorkSession(session, task)).toEqual({
      id: 'workSession:session-1',
      sourceType: 'workSession',
      sourceId: session.id,
      start,
      end: session.end,
      timeZone: session.timeZone,
      title: task.title,
      taskId: task.id,
      canMove: true,
      canResize: true,
      canDelete: true,
      isReadOnly: false,
    });
    expect(projectWorkSession({ ...session, start: start + 1000 }).id).toBe(
      projectWorkSession(session).id,
    );
  });

  it('keeps multiple sessions for one Task distinct, including completed sessions', () => {
    const result = projectLocalCalendarDisplayItems(
      [session, { ...session, id: 'session-2', completedAt: session.end }],
      { [task.id]: { ...task, isDone: true } },
      [],
    );
    expect(result.length).toBe(2);
    expect(new Set(result.map((item) => item.id)).size).toBe(2);
    expect(result.every((item) => item.taskId === task.id)).toBeTrue();
  });

  it('resolves titles from current Task state without mutating or duplicating persisted data', () => {
    const frozenSession = Object.freeze({ ...session });
    const entities = Object.freeze({ [task.id]: Object.freeze({ ...task }) });
    const before = JSON.stringify({ frozenSession, entities });
    const items = selectLocalCalendarDisplayItems.projector([frozenSession], entities, {
      planned: [],
      unPlanned: [],
    });
    expect(items[0].title).toBe(task.title);
    expect(
      selectLocalCalendarDisplayItems.projector(
        [frozenSession],
        { [task.id]: { ...task, title: 'Renamed Task' } },
        { planned: [], unPlanned: [] },
      )[0].title,
    ).toBe('Renamed Task');
    expect(JSON.stringify({ frozenSession, entities })).toBe(before);
    expect(Object.hasOwn(frozenSession, 'title')).toBeFalse();
  });

  it('retains an unexpectedly orphaned session with an absent title and no synthetic Task', () => {
    const result = projectLocalCalendarDisplayItems([session], {}, []);
    expect(result.length).toBe(1);
    expect(result[0].title).toBeUndefined();
    expect(result[0].taskId).toBe(task.id);
  });

  it('preserves an absent legacy session zone without resolving a fallback', () => {
    expect(
      projectWorkSession({ ...session, timeZone: undefined }).timeZone,
    ).toBeUndefined();
  });

  it('prefers the deterministic migrated session over its legacy timed Task', () => {
    const result = projectLocalCalendarDisplayItems([migrated], { [task.id]: task }, [
      task,
    ]);
    expect(result.length).toBe(1);
    expect(result[0].sourceId).toBe(migrated.id);
    expect(result[0].end).toBe(migrated.end);
  });

  it('keeps unrelated and migrated sessions visible without a legacy duplicate', () => {
    const result = projectLocalCalendarDisplayItems(
      [session, migrated],
      { [task.id]: task },
      [task],
    );
    expect(result.map((item) => item.sourceId)).toEqual([session.id, migrated.id]);
  });

  it('uses provenance even after the migrated session is moved or completed', () => {
    const result = projectLocalCalendarDisplayItems(
      [{ ...migrated, start: start + 1000, end: session.end + 1000, completedAt: start }],
      { [task.id]: task },
      [task],
    );
    expect(result.length).toBe(1);
    expect(result[0].start).toBe(start + 1000);
  });

  it('retains legacy fallback for unrelated sessions or a newly rescheduled Task', () => {
    expect(projectLocalCalendarDisplayItems([session], {}, [task]).length).toBe(2);
    const rescheduled = { ...task, dueWithTime: start + 1000 };
    const result = projectLocalCalendarDisplayItems([migrated], {}, [rescheduled]);
    expect(result.length).toBe(2);
    expect(result[1].sourceType).toBe('legacyTask');
    expect(result[1].start).toBe(rescheduled.dueWithTime);
    expect(result[1].end).toBe(rescheduled.dueWithTime + 1200000);
    expect(result[1].timeZone).toBeUndefined();
  });

  it('does not suppress a Task for a session with a different owner', () => {
    expect(
      projectLocalCalendarDisplayItems([{ ...migrated, taskId: 'other' }], {}, [task])
        .length,
    ).toBe(2);
  });

  it('leaves date-only and untimed Tasks outside the timed calendar projection', () => {
    const dateOnly: Task = {
      ...DEFAULT_TASK,
      projectId: 'INBOX',
      id: 'date-only',
      dueDay: '2026-10-02',
    };
    const untimed: Task = { ...DEFAULT_TASK, projectId: 'INBOX', id: 'untimed' };
    expect(
      selectLocalCalendarDisplayItems.projector(
        [],
        { [dateOnly.id]: dateOnly, [untimed.id]: untimed },
        {
          planned: [],
          unPlanned: [
            { ...dateOnly, subTasks: [] },
            { ...untimed, subTasks: [] },
          ],
        },
      ),
    ).toEqual([]);
    expect(dateOnly.dueDay).toBe('2026-10-02');
  });

  it('retains external timing and read-only capabilities', () => {
    const result = projectCalendarIntegrationEvent(external);
    expect(result.start).toBe(start);
    expect(result.end).toBe(start + external.duration);
    expect(result.sourceId).toBe(external.id);
    expect(result.title).toBe(external.title);
    expect(result.canMove).toBeFalse();
    expect(result.canResize).toBeFalse();
    expect(result.canDelete).toBeFalse();
    expect(result.isReadOnly).toBeTrue();
    expect(result.timeZone).toBeUndefined();
  });

  it('preserves explicit and duration-based all-day classification without changing instants', () => {
    for (const event of [
      { ...external, isAllDay: true },
      { ...external, duration: 86400000 },
    ]) {
      const result = projectCalendarIntegrationEvent(event);
      expect(result.isAllDay).toBeTrue();
      expect(result.start).toBe(event.start);
      expect(result.end).toBe(event.start + event.duration);
    }
  });

  it('exposes provider move/delete capabilities but no resize; reference events stay read-only', () => {
    const writable = projectCalendarIntegrationEvent(external, true, true);
    expect(writable.canMove).toBeTrue();
    expect(writable.canDelete).toBeTrue();
    expect(writable.canResize).toBeFalse();
    expect(writable.isReadOnly).toBeFalse();
    const reference = projectCalendarIntegrationEvent(
      { ...external, isReferenceCalendar: true },
      true,
      true,
    );
    expect(reference.canMove).toBeFalse();
    expect(reference.canDelete).toBeFalse();
    expect(reference.isReadOnly).toBeTrue();
  });

  it('keeps matching external IDs from different calendars distinct', () => {
    expect(projectCalendarIntegrationEvent(external).id).not.toBe(
      projectCalendarIntegrationEvent({ ...external, calProviderId: 'calendar-2' }).id,
    );
  });
});
