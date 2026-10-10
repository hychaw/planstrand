import { createAction } from '@ngrx/store';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';
import { WeeklyTemplate, WeeklyTemplateInput } from '../weekly-template.model';

export const addWeeklyTemplate = createAction(
  '[WeeklyTemplate] Add Weekly Template',
  (payload: { weeklyTemplate: WeeklyTemplate }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'WEEKLY_TEMPLATE',
      entityId: payload.weeklyTemplate.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);
export const updateWeeklyTemplate = createAction(
  '[WeeklyTemplate] Update Weekly Template',
  (payload: { id: string; changes: WeeklyTemplateInput; modified: number }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'WEEKLY_TEMPLATE',
      entityId: payload.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
export const deleteWeeklyTemplate = createAction(
  '[WeeklyTemplate] Delete Weekly Template',
  (payload: { weeklyTemplate: WeeklyTemplate }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'WEEKLY_TEMPLATE',
      entityId: payload.weeklyTemplate.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
