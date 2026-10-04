import { createFeatureSelector, createSelector } from '@ngrx/store';
import { EventState } from '../event.model';
import { EVENT_FEATURE_NAME, eventAdapter, initialEventState } from './event.reducer';
const feature = createFeatureSelector<EventState | undefined>(EVENT_FEATURE_NAME);
export const selectEventFeatureState = createSelector(
  feature,
  (state) => state ?? initialEventState,
);
const selectors = eventAdapter.getSelectors();
export const selectAllEvents = createSelector(
  selectEventFeatureState,
  selectors.selectAll,
);
export const selectEventEntities = createSelector(
  selectEventFeatureState,
  selectors.selectEntities,
);
export const selectEventById = createSelector(
  selectEventEntities,
  (entities, props: { id: string }) => entities[props.id],
);
