import { createFeatureSelector, createSelector } from '@ngrx/store';
import { OccurrenceExceptionState } from '../occurrence-exception.model';
import {
  OCCURRENCE_EXCEPTION_FEATURE_NAME,
  occurrenceExceptionAdapter,
  initialOccurrenceExceptionState,
} from './occurrence-exception.reducer';

const feature = createFeatureSelector<OccurrenceExceptionState | undefined>(
  OCCURRENCE_EXCEPTION_FEATURE_NAME,
);
export const selectOccurrenceExceptionFeatureState = createSelector(
  feature,
  (state) => state ?? initialOccurrenceExceptionState,
);
export const {
  selectAll: selectAllOccurrenceException,
  selectEntities: selectOccurrenceExceptionEntities,
} = occurrenceExceptionAdapter.getSelectors(selectOccurrenceExceptionFeatureState);
export const selectOccurrenceExceptionById = createSelector(
  selectOccurrenceExceptionEntities,
  (entities, props: { id: string }) => entities[props.id],
);
