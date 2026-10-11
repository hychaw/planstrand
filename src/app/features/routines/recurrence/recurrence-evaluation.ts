import { isValidDBDateStr } from '../../../util/get-db-date-str';
import { isValidIanaTimeZone } from '../../../util/is-valid-iana-time-zone';
import { RecurrenceCandidate } from './recurrence-candidates';

export type RecurrenceTiming =
  | { readonly kind: 'allDay' }
  | {
      readonly kind: 'timed';
      readonly localTime: string;
      readonly timeZone: string;
      readonly durationMs: number;
    };

export type RecurrenceOccurrence = RecurrenceCandidate &
  (
    | { readonly kind: 'allDay' }
    | {
        readonly kind: 'timed';
        readonly localTime: string;
        readonly timeZone: string;
        readonly start: number;
        readonly end: number;
      }
  );

const HOUR_MS = 3600000;

/** Interpret formatted wall fields as a coordinate, including BC/years 00–99. */
const wallCoordinate = (formatter: Intl.DateTimeFormat, instant: number): number => {
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  const year = Number(part('year'));
  const coordinate = new Date(0);
  coordinate.setUTCFullYear(
    part('era') === 'BC' ? 1 - year : year,
    Number(part('month')) - 1,
    Number(part('day')),
  );
  coordinate.setUTCHours(
    Number(part('hour')),
    Number(part('minute')),
    Number(part('second')),
    0,
  );
  return coordinate.getTime();
};

/**
 * Collect surrounding IANA offsets on both sides of a transition, then round-trip
 * every possible instant. The 72-hour window covers date-line jumps as well as
 * DST; six-hour probes capture the surrounding offset regimes without assuming
 * an hour-sized offset/transition. Seconds preserve historical sub-minute offsets.
 * Return the earliest exact match for folds, or null for nonexistent wall times.
 */
const resolveStart = (date: string, time: string, timeZone: string): number | null => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone,
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const wall = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const distance = hours * HOUR_MS;
    const probe = wall + distance;
    offsets.add(wallCoordinate(formatter, probe) - probe);
  }
  let earliest: number | null = null;
  for (const offset of offsets) {
    const instant = wall - offset;
    if (
      wallCoordinate(formatter, instant) === wall &&
      (earliest === null || instant < earliest)
    ) {
      earliest = instant;
    }
  }
  return earliest;
};

/**
 * Evaluate one scheduled candidate; its date/slot remain its recurrence identity.
 * Invalid input throws RangeError. A DST gap returns null without renumbering
 * later candidates. All-day values stay floating dates, without instant fields.
 * Timed starts use the explicit zone's wall clock; duration is elapsed time.
 * Uses runtime Intl IANA data; different tzdb versions can change future instants.
 * No instant-range filtering, system-zone fallback, or persistent state is used.
 */
export const evaluateRecurrenceCandidate = (
  candidate: RecurrenceCandidate,
  timing: RecurrenceTiming,
): RecurrenceOccurrence | null => {
  if (
    !candidate ||
    typeof candidate.date !== 'string' ||
    !isValidDBDateStr(candidate.date) ||
    !Number.isSafeInteger(candidate.slot) ||
    candidate.slot < 0 ||
    !timing ||
    (timing.kind !== 'allDay' && timing.kind !== 'timed')
  ) {
    throw new RangeError('Invalid recurrence candidate or timing');
  }
  if (timing.kind === 'allDay') {
    return { kind: 'allDay', date: candidate.date, slot: candidate.slot };
  }
  if (
    typeof timing.localTime !== 'string' ||
    timing.localTime.length !== 5 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(timing.localTime) ||
    typeof timing.timeZone !== 'string' ||
    !timing.timeZone ||
    !isValidIanaTimeZone(timing.timeZone) ||
    !Number.isFinite(timing.durationMs) ||
    timing.durationMs <= 0
  ) {
    throw new RangeError('Invalid timed recurrence configuration');
  }
  const start = resolveStart(candidate.date, timing.localTime, timing.timeZone);
  if (start === null) return null;
  const end = start + timing.durationMs;
  if (end <= start || !Number.isFinite(end) || Number.isNaN(new Date(end).getTime())) {
    throw new RangeError('Recurrence end is outside the supported timestamp range');
  }
  return {
    kind: 'timed',
    date: candidate.date,
    slot: candidate.slot,
    localTime: timing.localTime,
    timeZone: timing.timeZone,
    start,
    end,
  };
};
