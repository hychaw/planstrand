import { LocalEvent } from '../event/event.model';
import { parseDbDateStr } from '../../util/parse-db-date-str';
import { CalendarDisplayItem } from './calendar-display-item.model';
import { WorkSession } from '../work-session/work-session.model';
import { Task, TaskWithDueTime } from '../tasks/task.model';
import { legacyTaskWorkSessionId } from '../work-session/legacy-task-work-session-backfill';
import { getTimeLeftForTask } from '../../util/get-time-left-for-task';
import { isAllDayCalendarEvent, ScheduleFromCalendarEvent } from './schedule.model';

export const projectEvent = (event: LocalEvent): CalendarDisplayItem => ({
  id: `event:${event.id}`,
  sourceType: 'event',
  sourceId: event.id,
  title: event.title,
  isAllDay: event.isAllDay,
  // Date-only source remains authoritative; these are disposable view coordinates.
  ...(event.isAllDay
    ? {
        date: event.date,
        start: parseDbDateStr(event.date).getTime(),
        end: parseDbDateStr(event.date).getTime(),
      }
    : { start: event.start, end: event.end, timeZone: event.timeZone }),
  canMove: !event.isAllDay,
  canResize: !event.isAllDay,
  canDelete: true,
  isReadOnly: false,
});

export const projectWorkSession = (
  session: WorkSession,
  task?: Pick<Task, 'title'>,
): CalendarDisplayItem => ({
  id: `workSession:${session.id}`,
  sourceType: 'workSession',
  sourceId: session.id,
  start: session.start,
  end: session.end,
  timeZone: session.timeZone,
  title: task?.title,
  taskId: session.taskId,
  canMove: true,
  canResize: true,
  canDelete: true,
  isReadOnly: false,
});

/** Keep timed-Task fallback until its exact migration exists or was dismissed. */
export const projectLocalCalendarDisplayItems = (
  sessions: WorkSession[],
  tasks: Record<string, Task | undefined>,
  scheduledTasks: TaskWithDueTime[],
  dismissedLegacySessionIds: readonly string[] = [],
): CalendarDisplayItem[] => {
  const sessionOwners = new Map(sessions.map((s) => [s.id, s.taskId]));
  return [
    ...sessions.map((session) => projectWorkSession(session, tasks[session.taskId])),
    ...scheduledTasks
      .filter(
        (task) =>
          sessionOwners.get(legacyTaskWorkSessionId(task.id, task.dueWithTime)) !==
            task.id &&
          !dismissedLegacySessionIds.includes(
            legacyTaskWorkSessionId(task.id, task.dueWithTime),
          ),
      )
      .map(
        (task): CalendarDisplayItem => ({
          id: `legacyTask:${task.id}`,
          sourceType: 'legacyTask',
          sourceId: task.id,
          start: task.dueWithTime,
          end: task.dueWithTime + getTimeLeftForTask(task),
          title: task.title,
          taskId: task.id,
          canMove: true,
          canResize: task.timeEstimate > 0,
          canDelete: true,
          isReadOnly: false,
        }),
      ),
  ];
};

/** Capabilities are supplied from the existing provider definition by the facade. */
export const projectCalendarIntegrationEvent = (
  event: ScheduleFromCalendarEvent,
  canMove = false,
  canDelete = false,
): CalendarDisplayItem => {
  const isReference = !!event.isReferenceCalendar;
  return {
    id: `external:${JSON.stringify([event.calProviderId, event.id])}`,
    sourceType: 'external',
    sourceId: event.id,
    start: event.start,
    end: event.start + event.duration,
    title: event.title,
    isAllDay: isAllDayCalendarEvent(event),
    canMove: !isReference && canMove,
    // Existing calendar events have no resize handle.
    canResize: false,
    canDelete: !isReference && canDelete,
    isReadOnly: isReference || (!canMove && !canDelete),
  };
};
