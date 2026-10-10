import { MetaReducer } from '@ngrx/store';
import { isValidOccurrenceExceptionState } from '../../features/routines/occurrence-exception.validation';
import { RootState } from '../root-state';

export const occurrenceExceptionIntegrityMetaReducer: MetaReducer<RootState> =
  (reducer) => (state, action) => {
    const next = reducer(state, action);
    if (
      next.occurrenceException !== state?.occurrenceException &&
      next.occurrenceException !== undefined &&
      !isValidOccurrenceExceptionState(next.occurrenceException)
    )
      throw new Error('Invalid OccurrenceException state');
    return next;
  };
