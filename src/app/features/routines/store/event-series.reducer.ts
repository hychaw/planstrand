import { createEntityAdapter } from '@ngrx/entity';
import { Action, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { EventSeries, EventSeriesState } from '../event-series.model';
import {
  isValidEventSeries,
  isValidEventSeriesInput,
  isValidEventSeriesPlan,
  isValidEventSeriesState,
} from '../event-series.validation';
import {
  addEventSeries,
  updateEventSeries,
  replaceEventSeriesPlan,
  deleteEventSeries,
} from './event-series.actions';

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
    if (!current || current.deletedAt !== undefined) return state;
    return eventSeriesAdapter.setOne(
      valid({
        ...current,
        title: changes.title,
        modified,
        // Legacy complete-definition operations deterministically replace the plan.
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
  on(replaceEventSeriesPlan, (state, { id, plan, modified }) => {
    if (!isValidEventSeriesPlan(plan)) throw new Error('Invalid EventSeries plan');
    const current = state.entities[id];
    if (!current || current.deletedAt !== undefined) return state;
    if (plan.segments[0].id !== current.segments[0].id)
      throw new Error('Immutable EventSeries metadata');
    return eventSeriesAdapter.setOne(valid({ ...current, ...plan, modified }), state);
  }),
  on(deleteEventSeries, (state, { eventSeries }) => {
    valid(eventSeries);
    if (eventSeries.deletedAt === undefined)
      throw new Error('Missing EventSeries tombstone');
    const current = state.entities[eventSeries.id];
    if (
      current &&
      (current.templateId !== eventSeries.templateId ||
        current.created !== eventSeries.created ||
        current.segments[0].id !== eventSeries.segments[0].id)
    )
      throw new Error('Immutable EventSeries metadata');
    return eventSeriesAdapter.setOne(eventSeries, state);
  }),
);

/** Live compensation only updates existing lineages; terminal tombstones may
 * precede creation. No resurrection, ambient timestamps or hard deletion.
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
  const next = valid(payload as unknown as EventSeries);
  if (!current)
    return next.deletedAt !== undefined
      ? eventSeriesAdapter.setOne(next, state ?? initialEventSeriesState)
      : (state ?? initialEventSeriesState);
  if (current.deletedAt !== undefined && next.deletedAt === undefined) return state!;
  if (
    next.templateId !== current.templateId ||
    next.created !== current.created ||
    next.segments[0].id !== current.segments[0].id ||
    (next.segments[0].logicalSlotOffset ?? 0) !==
      (current.segments[0].logicalSlotOffset ?? 0)
  )
    throw new Error('Immutable EventSeries metadata');
  return eventSeriesAdapter.setOne(next, state!);
};
