import { createEntityAdapter } from '@ngrx/entity';
import { Action, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import {
  OccurrenceException,
  OccurrenceExceptionState,
} from '../occurrence-exception.model';
import {
  isValidOccurrenceException,
  isValidOccurrenceExceptionState,
} from '../occurrence-exception.validation';
import { setOccurrenceException } from './occurrence-exception.actions';

export const OCCURRENCE_EXCEPTION_FEATURE_NAME = 'occurrenceException';
export const occurrenceExceptionAdapter = createEntityAdapter<OccurrenceException>();
export const initialOccurrenceExceptionState: OccurrenceExceptionState = {
  ...occurrenceExceptionAdapter.getInitialState(),
  ids: [],
};
const set = (
  state: OccurrenceExceptionState,
  exception: OccurrenceException,
): OccurrenceExceptionState => {
  if (!isValidOccurrenceException(exception))
    throw new Error('Invalid OccurrenceException');
  return occurrenceExceptionAdapter.setOne(exception, state);
};
const reducer = createReducer(
  initialOccurrenceExceptionState,
  on(loadAllData, (_state, { appDataComplete }) => {
    if (!Object.hasOwn(appDataComplete, 'occurrenceException'))
      return initialOccurrenceExceptionState;
    const slice = (appDataComplete as { occurrenceException: unknown })
      .occurrenceException;
    if (!isValidOccurrenceExceptionState(slice))
      throw new Error('Invalid OccurrenceException state');
    return slice;
  }),
  on(setOccurrenceException, (state, { occurrenceException }) =>
    set(state, occurrenceException),
  ),
);
/** Route compensation through the same strict complete replacement boundary.
 * Canonical ids make ownership/slot immutable, even if the entity is absent.
 */
export const occurrenceExceptionReducer = (
  state: OccurrenceExceptionState | undefined,
  action: Action,
): OccurrenceExceptionState => {
  if (action.type !== '[OCCURRENCE_EXCEPTION] LWW Update') return reducer(state, action);
  const payload = { ...action } as unknown as Record<string, unknown>;
  delete payload['type'];
  delete payload['meta'];
  return set(
    state ?? initialOccurrenceExceptionState,
    payload as unknown as OccurrenceException,
  );
};
