import { logicalOccurrenceSlot, occurrenceKey } from '../routines/occurrence-key';
import { EventSeries } from '../routines/event-series.model';
import {
  getRecurrenceCandidates,
  RecurrenceDateRange,
} from '../routines/recurrence/recurrence-candidates';
import { evaluateRecurrenceCandidate } from '../routines/recurrence/recurrence-evaluation';
import { isValidDBDateStr } from '../../util/get-db-date-str';
import { isValidIanaTimeZone } from '../../util/iana-time-zone';
import { calendarDayStart } from './calendar-time';
import { EventOccurrenceDisplayItem } from './calendar-display-item.model';

const DAY_MS = 86400000;
const OFFSET_MARGIN_MS = 36 * 3600000;
const FIRST_DATE = Date.parse('0000-01-01T00:00:00Z');
const LAST_DATE = Date.parse('9999-12-31T00:00:00Z');
const boundedUtcDate = (instant: number): string => {
  // The engine accepts four-digit civil dates. Refuse an unsupported upper
  // lookahead explicitly rather than silently losing its final supported day.
  if (!Number.isFinite(instant) || instant >= LAST_DATE) {
    throw new RangeError('Occurrence query exceeds the supported civil-date range');
  }
  return new Date(Math.max(FIRST_DATE, instant)).toISOString().slice(0, 10);
};

/**
 * Read-only projection of a half-open civil Calendar window in displayTimeZone.
 * Candidate seeking is delegated to the recurrence engine. Timed lookback is
 * elapsed duration plus an offset margin (all IANA offsets fit within 36 hours),
 * so even starts before the window are evaluated when their ends may overlap.
 * No limits truncate results: work is proportional to potentially overlapping
 * slots, including legitimately overlapping long-duration occurrences.
 */
export const projectEventOccurrences = (
  series: readonly EventSeries[],
  range: RecurrenceDateRange,
  displayTimeZone: string,
): EventOccurrenceDisplayItem[] => {
  if (
    !range ||
    !isValidDBDateStr(range.fromDate) ||
    !isValidDBDateStr(range.toDateExclusive) ||
    range.fromDate > range.toDateExclusive ||
    !isValidIanaTimeZone(displayTimeZone)
  ) {
    throw new RangeError('Invalid Calendar occurrence range or display timezone');
  }
  if (range.fromDate === range.toDateExclusive) return [];
  const from = calendarDayStart(range.fromDate, displayTimeZone);
  const to = calendarDayStart(range.toDateExclusive, displayTimeZone);
  const items = new Map<string, EventOccurrenceDisplayItem>();
  for (const source of series) {
    for (const segment of source.segments) {
      const timing = segment.timing;
      const candidateRange =
        timing.kind === 'allDay'
          ? range
          : {
              fromDate: boundedUtcDate(from - timing.durationMs - OFFSET_MARGIN_MS),
              toDateExclusive: boundedUtcDate(to + OFFSET_MARGIN_MS + DAY_MS),
            };
      for (const candidate of getRecurrenceCandidates(
        segment.recurrence,
        candidateRange,
      )) {
        const occurrence = evaluateRecurrenceCandidate(candidate, timing);
        if (
          !occurrence ||
          (occurrence.kind === 'timed' &&
            (occurrence.start >= to || occurrence.end <= from))
        ) {
          continue;
        }
        const slot = logicalOccurrenceSlot(occurrence.slot, segment.logicalSlotOffset);
        const key = occurrenceKey({ seriesId: source.id, slot });
        const id = `eventOccurrence:${key}`;
        items.set(id, {
          id,
          sourceType: 'eventOccurrence',
          sourceId: source.id,
          title: source.title,
          occurrence: {
            segmentId: segment.id,
            slot,
            key,
            scheduledDate: occurrence.date,
          },
          ...(occurrence.kind === 'allDay'
            ? {
                isAllDay: true,
                date: occurrence.date,
                // Disposable sorting coordinates; date remains authoritative.
                start: Date.parse(`${occurrence.date}T00:00:00Z`),
                end: Date.parse(`${occurrence.date}T00:00:00Z`),
              }
            : {
                isAllDay: false,
                start: occurrence.start,
                end: occurrence.end,
                timeZone: occurrence.timeZone,
              }),
          canMove: false,
          canResize: false,
          canDelete: false,
          isReadOnly: true,
        });
      }
    }
  }
  return [...items.values()].sort(
    (a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
};
