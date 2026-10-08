import { calendarAddDays, calendarDayStart } from '../../util/calendar-date';
export {
  calendarAddDays,
  calendarDate,
  calendarDayStart,
} from '../../util/calendar-date';
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
