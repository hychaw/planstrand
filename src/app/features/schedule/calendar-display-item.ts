import { CalendarDisplayItem } from './calendar-display-item.model';
import { WorkSession } from '../work-session/work-session.model';
import { Task, TaskWithDueTime } from '../tasks/task.model';
import { legacyTaskWorkSessionId } from '../work-session/legacy-task-work-session-backfill';
import { getTimeLeftForTask } from '../../util/get-time-left-for-task';
import { isAllDayCalendarEvent, ScheduleFromCalendarEvent } from './schedule.model';

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

/** Keep the existing timed-Task fallback until its exact migrated session exists. */
export const projectLocalCalendarDisplayItems = (
  sessions: WorkSession[],
  tasks: Record<string, Task | undefined>,
  scheduledTasks: TaskWithDueTime[],
): CalendarDisplayItem[] => {
  const sessionOwners = new Map(sessions.map((s) => [s.id, s.taskId]));
  return [
    ...sessions.map((session) => projectWorkSession(session, tasks[session.taskId])),
    ...scheduledTasks
      .filter(
        (task) =>
          sessionOwners.get(legacyTaskWorkSessionId(task.id, task.dueWithTime)) !==
          task.id,
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
