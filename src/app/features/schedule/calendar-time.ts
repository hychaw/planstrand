import {
  getSystemIanaTimeZone,
  isValidIanaTimeZone,
  zonedDateTimeFields,
  zonedDateTimeToTimestamp,
} from '../../util/iana-time-zone';

/** Calendar display coordinates only; persisted instants never change. */
export const calendarDisplayZone = (configured?: string | null): string =>
  configured && isValidIanaTimeZone(configured)
    ? configured
    : (getSystemIanaTimeZone() ?? 'UTC');

export const calendarDate = (instant: number, zone: string): string =>
  zonedDateTimeFields(instant, zone).date;

export const calendarHours = (instant: number, zone: string): number => {
  const [hour, minute] = zonedDateTimeFields(instant, zone).time.split(':').map(Number);
  const fractionalHour = minute / 60;
  return hour + fractionalHour;
};

export const calendarTimeRow = (
  instant: number,
  zone: string,
  rowsPerHour: number,
): number => Math.round(calendarHours(instant, zone) * rowsPerHour) + 1;

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

export const calendarClock = (date: string, clock: string, zone: string): number =>
  zonedDateTimeToTimestamp(calendarAddDays(date, 0), clock.padStart(5, '0'), zone) ??
  calendarDayStart(date, zone);

/** Format wall coordinates, not a second conversion of the source instant. */
export const calendarClockLabel = (
  hours: number,
  locale: string,
  is24Hour: boolean,
): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12: !is24Hour,
  }).format(Date.UTC(2000, 0, 1, 0, Math.round(hours * 60)));
