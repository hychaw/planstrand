import { createAction } from '@ngrx/store';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';
import { OccurrenceException } from '../occurrence-exception.model';

/** A complete upsert supports first edits and edits delivered before creation. */
export const setOccurrenceException = createAction(
  '[OccurrenceException] Set Occurrence Exception',
  (payload: { occurrenceException: OccurrenceException }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'OCCURRENCE_EXCEPTION',
      entityId: payload.occurrenceException.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
