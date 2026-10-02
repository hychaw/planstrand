import { createEntityAdapter } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import {
  PlanningRecord,
  mergePlanningRecord,
  mergePlanningState,
  PlanningState,
  isPlanningState,
  comparePlanningStrings,
} from '../planning.model';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { setPlacement, removePlacement } from './planning.actions';
export const PLANNING_FEATURE_NAME = 'planning';
export const planningAdapter = createEntityAdapter<PlanningRecord>();
export const initialPlanningState: PlanningState = planningAdapter.getInitialState({
  ids: [] as string[],
});
/** Canonical ids do not depend on operation arrival order. */
export const normalizePlanningIds = (state: PlanningState): PlanningState => ({
  ...state,
  ids: [...state.ids].sort(comparePlanningStrings),
});
export const planningReducer = createReducer(
  initialPlanningState,
  on(loadAllData, (state, action) => {
    const { appDataComplete } = action;
    if (!Object.hasOwn(appDataComplete, 'planning')) return initialPlanningState;
    const next = (appDataComplete as { planning?: unknown }).planning;
    const live = new Set(
      (appDataComplete.task?.ids ?? []).filter(
        (id) => appDataComplete.task.entities[id]?.id === id,
      ) as string[],
    );
    if (!isPlanningState(next, live)) throw new Error('Invalid Planning state');
    return (action as typeof action & { planningSnapshotMerge?: boolean })
      .planningSnapshotMerge
      ? mergePlanningState(state, next)
      : normalizePlanningIds(next);
  }),
  on(setPlacement, removePlacement, (state, { record }) =>
    normalizePlanningIds(
      planningAdapter.setOne(
        mergePlanningRecord(state.entities[record.id], record),
        state,
      ),
    ),
  ),
);
