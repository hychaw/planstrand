import { createAction } from '@ngrx/store';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';
import { EventInput, LocalEvent } from '../event.model';
export const addEvent = createAction(
  '[Event] Add Event',
  (payload: { event: LocalEvent }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'EVENT',
      entityId: payload.event.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);
/** Replace editable fields atomically, including all-day/timed conversion. */
export const updateEvent = createAction(
  '[Event] Update Event',
  (payload: { id: string; changes: EventInput; modified: number }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'EVENT',
      entityId: payload.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
export const removeEvent = createAction(
  '[Event] Remove Event',
  (payload: { id: string }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'EVENT',
      entityId: payload.id,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);
