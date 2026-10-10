import { createFeatureSelector, createSelector } from '@ngrx/store';
import { EventSeriesState } from '../event-series.model';
import {
  EVENT_SERIES_FEATURE_NAME,
  eventSeriesAdapter,
  initialEventSeriesState,
} from './event-series.reducer';

const feature = createFeatureSelector<EventSeriesState | undefined>(
  EVENT_SERIES_FEATURE_NAME,
);
export const selectEventSeriesFeatureState = createSelector(
  feature,
  (state) => state ?? initialEventSeriesState,
);
export const {
  selectAll: selectAllEventSeries,
  selectEntities: selectEventSeriesEntities,
} = eventSeriesAdapter.getSelectors(selectEventSeriesFeatureState);
export const selectEventSeriesById = createSelector(
  selectEventSeriesEntities,
  (entities, props: { id: string }) => entities[props.id],
);
