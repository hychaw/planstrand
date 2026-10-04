import { createEntityAdapter } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { isValidEntityId } from '../../../op-log/validation/is-valid-entity-id';
import { isValidIanaTimeZone } from '../../../util/iana-time-zone';
import { isValidDBDateStr } from '../../../util/get-db-date-str';
import { EventState, LocalEvent } from '../event.model';
import { addEvent, updateEvent, removeEvent } from './event.actions';
export const EVENT_FEATURE_NAME = 'event';
export const eventAdapter = createEntityAdapter<LocalEvent>();
export const initialEventState: EventState = {
  ...eventAdapter.getInitialState(),
  ids: [],
};
const timestamp = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v >= 0 &&
  !Number.isNaN(new Date(v).getTime());
export const isValidEvent = (value: unknown): value is LocalEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    !(
      isValidEntityId(v['id']) &&
      typeof v['title'] === 'string' &&
      !!v['title'].trim() &&
      timestamp(v['created']) &&
      timestamp(v['modified'])
    )
  )
    return false;
  if (v['isAllDay'] === true)
    return (
      typeof v['date'] === 'string' &&
      isValidDBDateStr(v['date']) &&
      Object.keys(v).every((k) =>
        ['id', 'title', 'created', 'modified', 'isAllDay', 'date'].includes(k),
      )
    );
  return (
    v['isAllDay'] === false &&
    timestamp(v['start']) &&
    timestamp(v['end']) &&
    v['end'] > v['start'] &&
    typeof v['timeZone'] === 'string' &&
    isValidIanaTimeZone(v['timeZone']) &&
    Object.keys(v).every((k) =>
      [
        'id',
        'title',
        'created',
        'modified',
        'isAllDay',
        'start',
        'end',
        'timeZone',
      ].includes(k),
    )
  );
};
export const isValidEventState = (value: unknown): value is EventState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as EventState;
  return (
    Object.keys(v).every((k) => ['ids', 'entities'].includes(k)) &&
    Array.isArray(v.ids) &&
    new Set(v.ids).size === v.ids.length &&
    !!v.entities &&
    typeof v.entities === 'object' &&
    !Array.isArray(v.entities) &&
    Object.keys(v.entities).length === v.ids.length &&
    v.ids.every(
      (id) =>
        isValidEntityId(id) && isValidEvent(v.entities[id]) && v.entities[id]?.id === id,
    )
  );
};
const valid = (event: LocalEvent): LocalEvent => {
  if (!isValidEvent(event)) throw new Error('Invalid Event');
  return event;
};
export const eventReducer = createReducer(
  initialEventState,
  on(loadAllData, (_state, { appDataComplete }) => {
    if (!Object.hasOwn(appDataComplete, 'event')) return initialEventState;
    const event = (appDataComplete as { event: unknown }).event;
    if (!isValidEventState(event)) throw new Error('Invalid Event state');
    return event;
  }),
  on(addEvent, (state, { event }) => {
    if (state.entities[event.id]) throw new Error('Event id already exists');
    return eventAdapter.addOne(valid(event), state);
  }),
  on(updateEvent, (state, { id, changes, modified }) => {
    const current = state.entities[id];
    if (!current) return state;
    return eventAdapter.setOne(
      valid({ ...changes, id, created: current.created, modified }),
      state,
    );
  }),
  on(removeEvent, (state, { id }) => eventAdapter.removeOne(id, state)),
);
