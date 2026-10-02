import { Task } from '../../tasks/task.model';
import { createSelector, MemoizedSelector } from '@ngrx/store';
import { RootState } from '../../../root-store/root-state';
import { selectTodayStr } from '../../../root-store/app-state/app-state.selectors';
const selectTaskEntities = (root: object): RootState['tasks']['entities'] =>
  (root as RootState).tasks.entities;
import { initialPlanningState } from './planning.reducer';
import {
  comparePlacements,
  PlanningPlacement,
  PlanningState,
  planningPlacementView,
} from '../planning.model';
export const selectPlanningState = (state: object): PlanningState =>
  (state as RootState).planning ?? initialPlanningState;
export const selectPlanningEntities = createSelector(
  selectPlanningState,
  (state) => state.entities,
);
export const selectAllPlacements = createSelector(
  selectPlanningEntities,
  selectTaskEntities,
  (entities, tasks) =>
    Object.values(entities)
      .map(planningPlacementView)
      .filter((p): p is PlanningPlacement => !!p && !!tasks[p.id])
      .sort(comparePlacements),
);
export const selectPlacementByTaskId = (
  id: string,
): MemoizedSelector<object, PlanningPlacement | undefined> =>
  createSelector(selectPlanningEntities, selectTaskEntities, (entities, tasks) =>
    tasks[id] ? planningPlacementView(entities[id]) : undefined,
  );
export const selectDayPlacements = (
  day: string,
): MemoizedSelector<object, PlanningPlacement[]> =>
  createSelector(selectAllPlacements, (placements) =>
    placements.filter((p) => p.target.type === 'DAY' && p.target.key === day),
  );
export const selectWeekOnlyPlacements = (
  week: string,
): MemoizedSelector<object, PlanningPlacement[]> =>
  createSelector(selectAllPlacements, (placements) =>
    placements.filter((p) => p.target.type === 'WEEK' && p.target.key === week),
  );
export const selectOrderedDayTaskIds = (
  day: string,
): MemoizedSelector<object, string[]> =>
  createSelector(selectDayPlacements(day), (placements) => placements.map((p) => p.id));
export const selectOrderedWeekOnlyTaskIds = (
  week: string,
): MemoizedSelector<object, string[]> =>
  createSelector(selectWeekOnlyPlacements(week), (placements) =>
    placements.map((p) => p.id),
  );
export const selectPlanningIdsForWeek = (
  week: string,
): MemoizedSelector<object, string[]> =>
  createSelector(selectAllPlacements, (placements) => {
    const end = new Date(week + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 7);
    const endKey = end.toISOString().slice(0, 10);
    return [
      ...placements.filter((p) => p.target.type === 'WEEK' && p.target.key === week),
      ...placements
        .filter(
          (p) => p.target.type === 'DAY' && p.target.key >= week && p.target.key < endKey,
        )
        .sort((a, b) =>
          a.target.key < b.target.key
            ? -1
            : a.target.key > b.target.key
              ? 1
              : comparePlacements(a, b),
        ),
    ].map((p) => p.id);
  });
export const selectPlanningTasksForWeek = (
  week: string,
): MemoizedSelector<object, Task[]> =>
  createSelector(selectPlanningIdsForWeek(week), selectTaskEntities, (ids, entities) =>
    ids.map((id) => entities[id]).filter((t) => !!t),
  );
export const selectTodayPlanningIds = createSelector(
  selectAllPlacements,
  selectTodayStr,
  (placements, today) =>
    placements
      .filter((p) => p.target.type === 'DAY' && p.target.key === today)
      .map((p) => p.id),
);
export const selectTodayPlanningTasks = createSelector(
  selectTodayPlanningIds,
  selectTaskEntities,
  (ids, entities) => ids.map((id) => entities[id]).filter((t) => !!t),
);
/** Derived compatibility view, never persisted. */
export const selectCanonicalPlannerState = createSelector(
  selectAllPlacements,
  (placements): import('../../planner/store/planner.reducer').PlannerState => {
    const days: Record<string, string[]> = {};
    for (const p of placements)
      if (p.target.type === 'DAY') (days[p.target.key] ??= []).push(p.id);
    return { days, addPlannedTasksDialogLastShown: undefined };
  },
);
