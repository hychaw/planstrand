import { calendarAddDays, calendarDayStart, calendarDisplayZone } from './calendar-time';

/** Clamp the live instant into the first displayed civil day. */
export const anchorContextNow = (
  dayStr: string,
  now: number,
  displayZone = calendarDisplayZone(),
): number => {
  const start = calendarDayStart(dayStr, displayZone);
  const end = calendarDayStart(calendarAddDays(dayStr, 1), displayZone);
  return now >= start && now < end ? now : start;
};
