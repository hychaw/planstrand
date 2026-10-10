import { EntityState } from '@ngrx/entity';
import { RecurrenceSpec } from './recurrence/recurrence-candidates';
import { RecurrenceTiming } from './recurrence/recurrence-evaluation';

/** The series id is the stable lineage; segment ids survive whole-series edits.
 * Segments own [offset, next offset) logical slots. Occurrences use lineage + global
 * logical slot; the segment id is provenance and never participates in that key.
 */
export interface EventSeriesSegment {
  id: string;
  /** Engine slots are local; add this lineage offset (absent = zero). */
  logicalSlotOffset?: number;
  /** Optional title for this segment and its owned slots. */
  title?: string;
  recurrence: RecurrenceSpec;
  timing: RecurrenceTiming;
}

export interface EventSeries {
  id: string;
  title: string;
  segments: EventSeriesSegment[];
  /** Terminal tombstone; retained in snapshots, never hard-deleted. */
  deletedAt?: number;
  created: number;
  modified: number;
}

/** Complete editable definition; omission of endDate clears an existing bound. */
export interface EventSeriesInput {
  title: string;
  recurrence: RecurrenceSpec;
  timing: RecurrenceTiming;
}

export interface EventSeriesState extends EntityState<EventSeries> {
  ids: string[];
}

/** One replay-atomic replacement; arrays are never merged by index or field. */
export interface EventSeriesPlan {
  title: string;
  segments: EventSeriesSegment[];
}
export type SeriesExceptionDecision = 'retain' | 'clear';
export type SeriesEditResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'invalid'
        | 'exception-decision-required'
        | 'atomic-clear-unsupported';
    };
