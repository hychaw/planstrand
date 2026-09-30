import { createFeatureSelector, createSelector } from '@ngrx/store';
import { WorkSessionState } from '../work-session.model';
import { WORK_SESSION_FEATURE_NAME, workSessionAdapter } from './work-session.reducer';

export const selectWorkSessionFeatureState = createFeatureSelector<WorkSessionState>(
  WORK_SESSION_FEATURE_NAME,
);

const adapterSelectors = workSessionAdapter.getSelectors();

export const selectAllWorkSessions = createSelector(
  selectWorkSessionFeatureState,
  adapterSelectors.selectAll,
);

export const selectWorkSessionEntities = createSelector(
  selectWorkSessionFeatureState,
  adapterSelectors.selectEntities,
);

export const selectWorkSessionById = createSelector(
  selectWorkSessionEntities,
  (entities, props: { id: string }) => entities[props.id],
);

export const selectWorkSessionsByTaskId = createSelector(
  selectAllWorkSessions,
  (_sessions, props: { taskId: string }) => props.taskId,
  (sessions, taskId) => sessions.filter((session) => session.taskId === taskId),
);
