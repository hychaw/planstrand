import { createFeatureSelector, createSelector } from '@ngrx/store';
import { WeeklyTemplateState } from '../weekly-template.model';
import {
  WEEKLY_TEMPLATE_FEATURE_NAME,
  weeklyTemplateAdapter,
  initialWeeklyTemplateState,
} from './weekly-template.reducer';
import { selectAllEventSeries } from './event-series.selectors';

const feature = createFeatureSelector<WeeklyTemplateState | undefined>(
  WEEKLY_TEMPLATE_FEATURE_NAME,
);
export const selectWeeklyTemplateFeatureState = createSelector(
  feature,
  (state) => state ?? initialWeeklyTemplateState,
);
export const {
  selectAll: selectAllWeeklyTemplates,
  selectEntities: selectWeeklyTemplateEntities,
} = weeklyTemplateAdapter.getSelectors(selectWeeklyTemplateFeatureState);
export const selectWeeklyTemplateById = createSelector(
  selectWeeklyTemplateEntities,
  (entities, props: { id: string }) => entities[props.id],
);
export const selectTemplateEntries = createSelector(
  selectAllEventSeries,
  (series, props: { id: string }) =>
    series.filter((entry) => entry.templateId === props.id),
);
