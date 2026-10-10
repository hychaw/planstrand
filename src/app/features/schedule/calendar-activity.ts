import { CalendarDisplayItem } from './calendar-display-item.model';
import { RecurrenceDateRange } from '../routines/recurrence/recurrence-candidates';
import { calendarAddDays, calendarDate } from './calendar-time';

/** Bucket each visible span once, rather than scanning every item for each day. */
export const bucketCalendarActivity = (
  items: readonly CalendarDisplayItem[],
  range: RecurrenceDateRange,
  zone: string,
): Map<string, { count: number; hasWork: boolean }> => {
  const days = new Map<string, { count: number; hasWork: boolean }>();
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const start = item.date ?? calendarDate(item.start, zone);
    const end =
      item.isAllDay && item.date
        ? item.date
        : calendarDate(Math.max(item.start, item.end - 1), zone);
    for (
      let day = start < range.fromDate ? range.fromDate : start;
      day <= end && day < range.toDateExclusive;
      day = calendarAddDays(day, 1)
    ) {
      const bucket = days.get(day) ?? { count: 0, hasWork: false };
      bucket.count++;
      bucket.hasWork ||= item.sourceType === 'workSession';
      days.set(day, bucket);
    }
  }
  return days;
};
