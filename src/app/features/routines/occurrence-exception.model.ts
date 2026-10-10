import { EntityState } from '@ngrx/entity';
import { EventInput } from '../event/event.model';
import { OccurrenceKey } from './occurrence-key';

export type OccurrenceExceptionValue =
  | { kind: 'inherit' }
  | { kind: 'cancelled' }
  | { kind: 'override'; event: EventInput };
/** Ownership is encoded in id. Value is always replaced atomically. No parent
 * foreign-key pruning: sync may deliver the exception before its series.
 */
export interface OccurrenceException extends OccurrenceKey {
  readonly id: string;
  value: OccurrenceExceptionValue;
  modified: number;
}
export interface OccurrenceExceptionState extends EntityState<OccurrenceException> {
  ids: string[];
}
