import { createAction, props } from '@ngrx/store';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';
import { WorkSession, WorkSessionState, WorkSessionUpdate } from '../work-session.model';

/** Install only after the startup compatibility snapshot has durably committed. */
export const installLegacyWorkSessionBackfill = createAction(
  '[WorkSession] Install persisted legacy backfill',
  props<{ sessions: WorkSessionState }>(),
);

export const addWorkSession = createAction(
  '[WorkSession] Add WorkSession',
  (payload: { workSession: WorkSession }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'WORK_SESSION',
      entityId: payload.workSession.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);

export const updateWorkSession = createAction(
  '[WorkSession] Update WorkSession',
  (payload: { id: string; changes: WorkSessionUpdate; modified: number }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'WORK_SESSION',
      entityId: payload.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const removeWorkSession = createAction(
  '[WorkSession] Remove WorkSession',
  (payload: { id: string }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'WORK_SESSION',
      entityId: payload.id,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);

export const completeWorkSession = createAction(
  '[WorkSession] Complete WorkSession',
  (payload: { id: string; completedAt: number; modified: number }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'WORK_SESSION',
      entityId: payload.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const uncompleteWorkSession = createAction(
  '[WorkSession] Uncomplete WorkSession',
  (payload: { id: string; modified: number }) => ({
    ...payload,
    meta: {
      isPersistent: true,
      entityType: 'WORK_SESSION',
      entityId: payload.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
