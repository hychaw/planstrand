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
    | { readonly frequency: 'monthly' }
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

const monthNumber = (date: string): number => {
  const yearMonths = Number(date.slice(0, 4)) * 12;
  return yearMonths + Number(date.slice(5, 7)) - 1;
};

const validateSpec = (spec: RecurrenceSpec): void => {
  if (
    !spec ||
    !validDate(spec.startDate) ||
    !Number.isSafeInteger(spec.interval) ||
    spec.interval < 1 ||
    (spec.endDate !== undefined &&
      (!validDate(spec.endDate) || spec.endDate < spec.startDate)) ||
    (spec.frequency !== 'daily' &&
      spec.frequency !== 'weekly' &&
      spec.frequency !== 'monthly')
  ) {
    throw new RangeError('Invalid recurrence specification');
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
};

/**
 * Enumerates [fromDate, toDateExclusive), clipped to the inclusive series bounds.
 * Slots count candidates from startDate, independent of the requested window.
 * Weekly phase starts on the Monday of startDate's week. Input weekday order
 * does not matter; duplicates and invalid specifications throw RangeError.
 * Monthly rules keep startDate's day of month, reserving slots for invalid dates.
 * Work is proportional to the requested candidates, not the series' age.
 */
export const getRecurrenceCandidates = (
  spec: RecurrenceSpec,
  range: RecurrenceDateRange,
): RecurrenceCandidate[] => {
  validateSpec(spec);
  if (
    !range ||
    !validDate(range.fromDate) ||
    !validDate(range.toDateExclusive) ||
    range.fromDate > range.toDateExclusive
  ) {
    throw new RangeError('Invalid recurrence date range');
  }
  const weekdays = spec.frequency === 'weekly' ? spec.weekdays : [];

  const start = dayNumber(spec.startDate);
  const from = Math.max(start, dayNumber(range.fromDate));
  const to = Math.min(
    dayNumber(range.toDateExclusive),
    spec.endDate === undefined ? Infinity : dayNumber(spec.endDate) + 1,
  );
  const candidates: RecurrenceCandidate[] = [];
  if (from >= to) return candidates;

  if (spec.frequency === 'monthly') {
    const startMonth = monthNumber(spec.startDate);
    const firstSlot = Math.max(
      0,
      Math.ceil((monthNumber(range.fromDate) - startMonth) / spec.interval),
    );
    const lastMonth = monthNumber(
      spec.endDate && spec.endDate < range.toDateExclusive
        ? spec.endDate
        : range.toDateExclusive,
    );
    for (let slot = firstSlot; ; slot++) {
      const offset = slot * spec.interval;
      const month = startMonth + offset;
      if (month > lastMonth) break;
      const yearPart = String(Math.floor(month / 12)).padStart(4, '0');
      const monthPart = String((month % 12) + 1).padStart(2, '0');
      const date = `${yearPart}-${monthPart}-${spec.startDate.slice(8)}`;
      if (
        validDate(date) &&
        date >= range.fromDate &&
        date < range.toDateExclusive &&
        (spec.endDate === undefined || date <= spec.endDate)
      ) {
        candidates.push({ date, slot });
      }
    }
    return candidates;
  }

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

/** Resolve one engine slot without enumerating its history. Missing monthly
 * dates and slots outside the inclusive series bounds have no candidate.
 */
export const getRecurrenceCandidateForSlot = (
  spec: RecurrenceSpec,
  slot: number,
): RecurrenceCandidate | null => {
  validateSpec(spec);
  if (!Number.isSafeInteger(slot) || slot < 0 || Object.is(slot, -0)) {
    throw new RangeError('Invalid recurrence slot');
  }
  let date: string;
  if (spec.frequency === 'monthly') {
    const offset = slot * spec.interval;
    const month = monthNumber(spec.startDate) + offset;
    if (month > monthNumber('9999-12-31')) return null;
    date = `${String(Math.floor(month / 12)).padStart(4, '0')}-${String(
      (month % 12) + 1,
    ).padStart(2, '0')}-${spec.startDate.slice(8)}`;
  } else {
    const start = dayNumber(spec.startDate);
    let day: number;
    if (spec.frequency === 'daily') {
      const offset = slot * spec.interval;
      day = start + offset;
    } else {
      const weekdays = [...spec.weekdays].sort((a, b) => a - b);
      const startWeekday = (((start + 3) % 7) + 7) % 7;
      const excluded = weekdays.filter((weekday) => weekday - 1 < startWeekday).length;
      const index = slot + excluded;
      const week = Math.floor(index / weekdays.length);
      const offset = week * spec.interval * 7;
      day = start - startWeekday + offset + weekdays[index % weekdays.length] - 1;
    }
    if (day > dayNumber(spec.endDate ?? '9999-12-31')) return null;
    date = civilDate(day);
  }
  return validDate(date) &&
    date >= spec.startDate &&
    (spec.endDate === undefined || date <= spec.endDate)
    ? { date, slot }
    : null;
};
