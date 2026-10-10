import { EntityState } from '@ngrx/entity';
import { RecurrenceSpec } from './recurrence/recurrence-candidates';
import { RecurrenceTiming } from './recurrence/recurrence-evaluation';

/** The series id is the stable lineage; segment ids survive whole-series edits.
 * Exactly one segment is currently supported. Occurrences use lineage + global
 * logical slot; the segment id is provenance and never participates in that key.
 */
export interface EventSeriesSegment {
  id: string;
  /** Engine slots are local; add this immutable lineage offset (absent = zero). */
  logicalSlotOffset?: number;
  recurrence: RecurrenceSpec;
  timing: RecurrenceTiming;
}

export interface EventSeries {
  id: string;
  title: string;
  segments: [EventSeriesSegment];
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
