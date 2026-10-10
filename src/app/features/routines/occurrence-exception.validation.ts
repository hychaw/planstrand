import { isValidEvent } from '../event/store/event.reducer';
import { isEventSeriesTimestamp } from './event-series.validation';
import { occurrenceKey, isValidOccurrenceKey } from './occurrence-key';
import {
  OccurrenceException,
  OccurrenceExceptionState,
  OccurrenceExceptionValue,
} from './occurrence-exception.model';

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(v).every((k) => allowed.includes(k));
export const occurrenceExceptionId = (key: { seriesId: string; slot: number }): string =>
  `occurrenceException:${occurrenceKey(key)}`;
export const isValidOccurrenceExceptionValue = (
  v: unknown,
): v is OccurrenceExceptionValue => {
  if (!record(v)) return false;
  if (v['kind'] === 'inherit' || v['kind'] === 'cancelled') return keys(v, ['kind']);
  if (v['kind'] !== 'override' || !keys(v, ['kind', 'event']) || !record(v['event']))
    return false;
  const event = v['event'];
  // Reuse one-off temporal/title semantics, while forbidding metadata injection.
  return (
    keys(
      event,
      event['isAllDay'] === true
        ? ['title', 'isAllDay', 'date']
        : ['title', 'isAllDay', 'start', 'end', 'timeZone'],
    ) && isValidEvent({ ...event, id: 'override', created: 0, modified: 0 })
  );
};
export const isValidOccurrenceException = (v: unknown): v is OccurrenceException =>
  record(v) &&
  keys(v, ['id', 'seriesId', 'slot', 'value', 'modified']) &&
  isValidOccurrenceKey({ seriesId: v['seriesId'], slot: v['slot'] }) &&
  v['id'] ===
    occurrenceExceptionId({
      seriesId: v['seriesId'] as string,
      slot: v['slot'] as number,
    }) &&
  isEventSeriesTimestamp(v['modified']) &&
  isValidOccurrenceExceptionValue(v['value']);
export const isValidOccurrenceExceptionState = (
  v: unknown,
): v is OccurrenceExceptionState => {
  if (
    !record(v) ||
    !keys(v, ['ids', 'entities']) ||
    !Array.isArray(v['ids']) ||
    !record(v['entities'])
  )
    return false;
  const entities = v['entities'];
  return (
    new Set(v['ids']).size === v['ids'].length &&
    Object.keys(entities).length === v['ids'].length &&
    v['ids'].every(
      (id) =>
        typeof id === 'string' &&
        Object.hasOwn(entities, id) &&
        isValidOccurrenceException(entities[id]) &&
        entities[id].id === id,
    )
  );
};
