import { EventInput } from '../event/event.model';
import { EventSeries } from './event-series.model';
import { OccurrenceKey, isValidOccurrenceKey } from './occurrence-key';
import { OccurrenceException } from './occurrence-exception.model';
import { getRecurrenceCandidateForSlot } from './recurrence/recurrence-candidates';
import { evaluateRecurrenceCandidate } from './recurrence/recurrence-evaluation';

export interface ResolvedEventOccurrence {
  original: EventInput;
  effective: EventInput;
  scheduledDate: string;
  kind: 'inherit' | 'override' | 'cancelled';
}

/** Resolve an editor's canonical key from current state, independently of any
 * Calendar range/display zone. Invalid or unavailable original slots stay absent.
 */
export const resolveEventOccurrence = (
  series: EventSeries | undefined,
  key: OccurrenceKey,
  exception?: OccurrenceException,
): ResolvedEventOccurrence | null => {
  if (!isValidOccurrenceKey(key) || !series || series.id !== key.seriesId) return null;
  for (const segment of series.segments) {
    const slot = key.slot - (segment.logicalSlotOffset ?? 0);
    if (slot < 0) continue;
    const candidate = getRecurrenceCandidateForSlot(segment.recurrence, slot);
    if (!candidate) continue;
    const occurrence = evaluateRecurrenceCandidate(candidate, segment.timing);
    if (!occurrence) continue;
    const original: EventInput =
      occurrence.kind === 'allDay'
        ? { title: series.title, isAllDay: true, date: occurrence.date }
        : {
            title: series.title,
            isAllDay: false,
            start: occurrence.start,
            end: occurrence.end,
            timeZone: occurrence.timeZone,
          };
    const value =
      exception?.seriesId === key.seriesId && exception.slot === key.slot
        ? exception.value
        : undefined;
    return {
      original,
      effective: value?.kind === 'override' ? value.event : original,
      scheduledDate: occurrence.date,
      kind: value?.kind ?? 'inherit',
    };
  }
  return null;
};
