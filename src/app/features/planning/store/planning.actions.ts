import { createAction } from '@ngrx/store';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { PlanningRecord, PLANNING_V1, isPlanningRecord } from '../planning.model';
export const setPlacement = createAction(
  '[Planning] Set Placement',
  (payload: { record: PlanningRecord }) => {
    if (!isPlanningRecord(payload.record) || payload.record.placement === null)
      throw new Error('Invalid Planning Set');
    return {
      ...payload,
      meta: {
        isPersistent: true,
        entityType: 'PLANNING',
        entityId: payload.record.id,
        opType: PLANNING_V1,
      } satisfies PersistentActionMeta,
    };
  },
);
export const removePlacement = createAction(
  '[Planning] Remove Placement',
  (payload: { record: PlanningRecord }) => {
    if (!isPlanningRecord(payload.record) || payload.record.placement !== null)
      throw new Error('Invalid Planning Remove');
    return {
      ...payload,
      meta: {
        isPersistent: true,
        entityType: 'PLANNING',
        entityId: payload.record.id,
        opType: PLANNING_V1,
      } satisfies PersistentActionMeta,
    };
  },
);
