import { zonedDateTimeFields, zonedDateTimeToTimestamp } from './iana-time-zone';

export const calendarDate = (instant: number, zone: string): string =>
  zonedDateTimeFields(instant, zone).date;

export const calendarAddDays = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day, 12));
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
};

export const calendarDayStart = (date: string, zone: string): number => {
  date = calendarAddDays(date, 0);
  const midnight = zonedDateTimeToTimestamp(date, '00:00', zone);
  if (midnight !== null) return midnight;
  // Some IANA zones skip midnight. Find the first instant of that civil date.
  const nominal = Date.parse(`${date}T00:00:00Z`);
  const searchRadius = 36 * 3600000;
  let low = nominal - searchRadius;
  let high = nominal + searchRadius;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (calendarDate(mid, zone) < date) low = mid;
    else high = mid;
  }
  return high;
};
