import { isValidDBDateStr } from '../../../util/get-db-date-str';

interface RecurrenceBase {
  readonly startDate: string;
  readonly endDate?: string;
  readonly interval: number;
}

export type RecurrenceSpec = RecurrenceBase &
  (
    | { readonly frequency: 'daily' }
    | { readonly frequency: 'weekly'; readonly weekdays: readonly number[] }
  );

export interface RecurrenceDateRange {
  readonly fromDate: string;
  readonly toDateExclusive: string;
}

export interface RecurrenceCandidate {
  readonly date: string;
  readonly slot: number;
}

const DAY_MS = 86400000;
const EPOCH_NOON = Date.UTC(1970, 0, 1, 12);

const validDate = (value: unknown): value is string =>
  typeof value === 'string' && isValidDBDateStr(value);

/** UTC noon is only a civil-day coordinate, never an occurrence instant. */
const dayNumber = (date: string): number => {
  const cursor = new Date(EPOCH_NOON);
  // Date.UTC(year, ...) would reinterpret years 00–99 as 1900–1999.
  cursor.setUTCFullYear(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  return (cursor.getTime() - EPOCH_NOON) / DAY_MS;
};

const civilDate = (day: number): string => {
  const offset = day * DAY_MS;
  return new Date(EPOCH_NOON + offset).toISOString().slice(0, 10);
};

/**
 * Enumerates [fromDate, toDateExclusive), clipped to the inclusive series bounds.
 * Slots count candidates from startDate, independent of the requested window.
 * Weekly phase starts on the Monday of startDate's week. Input weekday order
 * does not matter; duplicates and invalid specifications throw RangeError.
 * Work is proportional to the requested candidates, not the series' age.
 */
export const getRecurrenceCandidates = (
  spec: RecurrenceSpec,
  range: RecurrenceDateRange,
): RecurrenceCandidate[] => {
  if (
    !spec ||
    !validDate(spec.startDate) ||
    !Number.isSafeInteger(spec.interval) ||
    spec.interval < 1 ||
    (spec.endDate !== undefined &&
      (!validDate(spec.endDate) || spec.endDate < spec.startDate)) ||
    (spec.frequency !== 'daily' && spec.frequency !== 'weekly')
  ) {
    throw new RangeError('Invalid recurrence specification');
  }
  if (
    !range ||
    !validDate(range.fromDate) ||
    !validDate(range.toDateExclusive) ||
    range.fromDate > range.toDateExclusive
  ) {
    throw new RangeError('Invalid recurrence date range');
  }
  const weekdays = spec.frequency === 'weekly' ? spec.weekdays : [];
  if (
    spec.frequency === 'weekly' &&
    (!Array.isArray(weekdays) ||
      !weekdays.length ||
      [...weekdays].some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
      new Set(weekdays).size !== weekdays.length)
  ) {
    throw new RangeError('Invalid recurrence weekdays');
  }

  const start = dayNumber(spec.startDate);
  const from = Math.max(start, dayNumber(range.fromDate));
  const to = Math.min(
    dayNumber(range.toDateExclusive),
    spec.endDate === undefined ? Infinity : dayNumber(spec.endDate) + 1,
  );
  const candidates: RecurrenceCandidate[] = [];
  if (from >= to) return candidates;

  if (spec.frequency === 'daily') {
    const firstSlot = Math.ceil((from - start) / spec.interval);
    for (let slot = firstSlot; ; slot++) {
      const offset = slot * spec.interval;
      const day = start + offset;
      if (day >= to) break;
      candidates.push({ date: civilDate(day), slot });
    }
    return candidates;
  }

  const sortedWeekdays = [...weekdays].sort((a, b) => a - b);
  // 1970-01-01 was Thursday (ISO 4); normalize negative remainders as well.
  const startWeekday = (((start + 3) % 7) + 7) % 7;
  const monday = start - startWeekday;
  const excluded = sortedWeekdays.filter((day) => day - 1 < startWeekday).length;
  const weekStride = spec.interval * 7;
  const firstWeek = Math.max(0, Math.floor((from - monday) / weekStride));

  for (let week = firstWeek; ; week++) {
    const offset = week * weekStride;
    const weekStart = monday + offset;
    if (weekStart >= to) break;
    const firstWeekSlot = week * sortedWeekdays.length;
    for (let index = 0; index < sortedWeekdays.length; index++) {
      const day = weekStart + sortedWeekdays[index] - 1;
      if (day >= from && day < to) {
        candidates.push({
          date: civilDate(day),
          slot: firstWeekSlot + index - excluded,
        });
      }
    }
  }
  return candidates;
};
