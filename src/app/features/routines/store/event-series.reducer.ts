import { createEntityAdapter } from '@ngrx/entity';
import { Action, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { EventSeries, EventSeriesState } from '../event-series.model';
import {
  isValidEventSeries,
  isValidEventSeriesInput,
  isValidEventSeriesState,
} from '../event-series.validation';
import { addEventSeries, updateEventSeries } from './event-series.actions';

export const EVENT_SERIES_FEATURE_NAME = 'eventSeries';
export const eventSeriesAdapter = createEntityAdapter<EventSeries>();
export const initialEventSeriesState: EventSeriesState = {
  ...eventSeriesAdapter.getInitialState(),
  ids: [],
};
const valid = (series: EventSeries): EventSeries => {
  if (!isValidEventSeries(series)) throw new Error('Invalid EventSeries');
  return series;
};
const reducer = createReducer(
  initialEventSeriesState,
  on(loadAllData, (_state, { appDataComplete }) => {
    if (!Object.hasOwn(appDataComplete, 'eventSeries')) return initialEventSeriesState;
    const eventSeries = (appDataComplete as { eventSeries: unknown }).eventSeries;
    if (!isValidEventSeriesState(eventSeries))
      throw new Error('Invalid EventSeries state');
    return eventSeries;
  }),
  on(addEventSeries, (state, { eventSeries }) => {
    valid(eventSeries);
    const current = state.entities[eventSeries.id];
    // Duplicate delivery must never undo a later update. Conflicting creations
    // cannot overwrite an existing lineage or its creation metadata.
    if (current) return state;
    return eventSeriesAdapter.addOne(eventSeries, state);
  }),
  on(updateEventSeries, (state, { id, changes, modified }) => {
    if (!isValidEventSeriesInput(changes)) throw new Error('Invalid EventSeries input');
    const current = state.entities[id];
    if (!current) return state;
    return eventSeriesAdapter.setOne(
      valid({
        ...current,
        title: changes.title,
        modified,
        segments: [
          {
            id: current.segments[0].id,
            recurrence: changes.recurrence,
            timing: changes.timing,
          },
        ],
      }),
      state,
    );
  }),
);

/** Series conflict compensation only updates an existing lineage. No generic
 * resurrection, local timestamps, immutable metadata changes or hard deletion.
 */
export const eventSeriesReducer = (
  state: EventSeriesState | undefined,
  action: Action,
): EventSeriesState => {
  if (action.type !== '[EVENT_SERIES] LWW Update') return reducer(state, action);
  const payload = { ...action } as unknown as Record<string, unknown>;
  delete payload['type'];
  delete payload['meta'];
  const current = state?.entities[payload['id'] as string];
  if (!current) return state ?? initialEventSeriesState;
  const next = valid(payload as unknown as EventSeries);
  if (next.created !== current.created || next.segments[0].id !== current.segments[0].id)
    throw new Error('Immutable EventSeries metadata');
  return eventSeriesAdapter.setOne(next, state!);
};
