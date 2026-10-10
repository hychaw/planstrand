import { createAction } from '@ngrx/store';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';
import { EventSeries, EventSeriesInput } from '../event-series.model';

export const addEventSeries = createAction(
  '[EventSeries] Add Event Series',
  (payload: { eventSeries: EventSeries }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'EVENT_SERIES',
      entityId: payload.eventSeries.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);
export const updateEventSeries = createAction(
  '[EventSeries] Update Event Series',
  (payload: { id: string; changes: EventSeriesInput; modified: number }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'EVENT_SERIES',
      entityId: payload.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
