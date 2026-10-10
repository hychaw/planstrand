import { EntityState } from '@ngrx/entity';
import { RecurrenceSpec } from './recurrence/recurrence-candidates';
import { RecurrenceTiming } from './recurrence/recurrence-evaluation';

/** The series id is the stable lineage; segment ids survive whole-series edits.
 * Phase 2a permits exactly one segment. Future splitting, exceptions and template
 * ownership can reference these identities without changing occurrence lineage.
 */
export interface EventSeriesSegment {
  id: string;
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
