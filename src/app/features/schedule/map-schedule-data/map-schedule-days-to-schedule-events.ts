import { calendarHours, calendarTimeRow, calendarDisplayZone } from '../calendar-time';
import { ScheduleDay, ScheduleEvent } from '../schedule.model';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { SVEType } from '../schedule.const';
import { TaskWithPlannedForDayIndication } from '../../tasks/task.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

export const mapScheduleDaysToScheduleEvents = (
  days: ScheduleDay[],
  FH: number,
  displayZone = calendarDisplayZone(),
): {
  eventsFlat: ScheduleEvent[];
  beyondBudgetDays: ScheduleEvent[][];
} => {
  const eventsFlat: ScheduleEvent[] = [];
  const beyondBudgetDays: ScheduleEvent[][] = [];

  days.forEach((day, dayIndex) => {
    beyondBudgetDays[dayIndex] = day.beyondBudgetTasks.map((taskPlannedForDay) => {
      const timeLeft = getTimeLeftForTask(taskPlannedForDay);
      const timeLeftInHours = timeLeft / 1000 / 60 / 60;
      const plannedForDay =
        (taskPlannedForDay as TaskWithPlannedForDayIndication).plannedForDay ||
        taskPlannedForDay.dueDay ||
        day.dayDate;
      return {
        id: taskPlannedForDay.id,
        dayOfMonth: getDayOfMonth(plannedForDay),
        data: taskPlannedForDay,
        type: SVEType.TaskPlannedForDay,
        style: '',
        timeLeftInHours,
        startHours: 0,
        plannedForDay,
        isBeyondBudget: true,
      };
    });

    const activeEntries: (
      | { entry: (typeof day.entries)[number]; eventIndex: number }
      | undefined
    )[] = [];

    day.entries.forEach((entry) => {
      if (entry.type === SVEType.LocalEvent && entry.data.isAllDay) {
        eventsFlat.push({
          id: entry.id,
          type: entry.type,
          startHours: 0,
          timeLeftInHours: 0,
          style: '',
          data: entry.data,
          plannedForDay: day.dayDate,
        });
        return;
      }
      if (entry.type !== SVEType.WorkdayEnd && entry.type !== SVEType.WorkdayStart) {
        const hoursToday = calendarHours(entry.start, displayZone);
        const startRow = calendarTimeRow(entry.start, displayZone, FH);
        const timeLeft = entry.duration;

        // NOTE since we only use getMinutes we also need to floor the minutes for timeLeftInHours
        const timeLeftInHours = Math.floor(timeLeft / 1000 / 60) / 60;
        const rowSpan = Math.max(1, Math.round(timeLeftInHours * FH));

        const eventIndex = eventsFlat.length;
        eventsFlat.push({
          dayOfMonth: getDayOfMonth(
            (entry.data as TaskWithPlannedForDayIndication)?.plannedForDay,
          ),
          id: entry.id,
          type: entry.type as SVEType,
          startHours: hoursToday,
          timeLeftInHours,
          style: `grid-column: ${dayIndex + 2};  grid-row: ${startRow} / span ${rowSpan}`,
          data: entry.data,
          plannedForDay: [
            SVEType.LocalEvent,
            SVEType.WorkSession,
            SVEType.ScheduledTask,
            SVEType.CalendarEvent,
          ].includes(entry.type)
            ? day.dayDate
            : entry.plannedForDay,
          ...(entry.sourceOccurrenceDate
            ? { sourceOccurrenceDate: entry.sourceOccurrenceDate }
            : {}),
          isBeyondBudget: entry.isBeyondBudget,
        });

        let overlapCount = 0;
        for (let i = 0; i < activeEntries.length; i++) {
          const activeEntry = activeEntries[i];
          if (!activeEntry) {
            continue;
          }
          const entryEnd = entry.start + Math.max(entry.duration, 1);
          const activeEnd =
            activeEntry.entry.start + Math.max(activeEntry.entry.duration, 1);
          if (entryEnd <= activeEntry.entry.start || activeEnd <= entry.start) {
            delete activeEntries[i];
          } else {
            overlapCount += 1;
          }
        }

        let nextInactiveSlot = activeEntries.findIndex((s) => !s);
        if (nextInactiveSlot === -1) {
          nextInactiveSlot = activeEntries.length === 0 ? 0 : activeEntries.length;
        }

        activeEntries[nextInactiveSlot] = { entry, eventIndex };

        if (overlapCount > 0 || nextInactiveSlot > 0) {
          const activeEventSlots = activeEntries
            .map((activeEntry, offset) => ({ activeEntry, offset }))
            .filter(
              (
                activeEventSlot,
              ): activeEventSlot is {
                activeEntry: { entry: (typeof day.entries)[number]; eventIndex: number };
                offset: number;
              } => !!activeEventSlot.activeEntry,
            );
          const laneCount = Math.max(
            ...activeEventSlots.map(({ activeEntry, offset }) =>
              Math.max(
                offset + 1,
                eventsFlat[activeEntry.eventIndex].overlap?.count ?? 1,
              ),
            ),
          );

          activeEventSlots.forEach(({ activeEntry, offset }) => {
            eventsFlat[activeEntry.eventIndex].overlap = {
              count: laneCount,
              offset,
            };
          });
        }
      }
    });
  });

  return { eventsFlat, beyondBudgetDays };
};

const getDayOfMonth = (dayDate: string | undefined): number | undefined =>
  dayDate ? dateStrToUtcDate(dayDate).getDate() : undefined;
