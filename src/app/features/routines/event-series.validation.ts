import { isLogicalSlot } from './occurrence-key';
import { isValidEntityId } from '../../op-log/validation/is-valid-entity-id';
import { EventSeries, EventSeriesInput, EventSeriesState } from './event-series.model';
import { getRecurrenceCandidates } from './recurrence/recurrence-candidates';
import { evaluateRecurrenceCandidate } from './recurrence/recurrence-evaluation';

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(v).every((key) => allowed.includes(key));
export const isEventSeriesTimestamp = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v >= 0 &&
  !Number.isNaN(new Date(v).getTime());

/** Engine validation owns recurrence and temporal policies. The persisted boundary
 * additionally rejects unknown fields, including stale all-day/timed fields.
 */
export const isValidEventSeriesInput = (v: unknown): v is EventSeriesInput => {
  if (
    !record(v) ||
    !keys(v, ['title', 'recurrence', 'timing']) ||
    typeof v['title'] !== 'string' ||
    !v['title'].trim()
  )
    return false;
  const r = v['recurrence'];
  const t = v['timing'];
  if (
    !record(r) ||
    !record(t) ||
    !keys(r, [
      'frequency',
      'startDate',
      'endDate',
      'interval',
      ...(r['frequency'] === 'weekly' ? ['weekdays'] : []),
    ]) ||
    !keys(
      t,
      t['kind'] === 'allDay' ? ['kind'] : ['kind', 'localTime', 'timeZone', 'durationMs'],
    )
  )
    return false;
  try {
    const input = v as unknown as EventSeriesInput;
    // Empty window validates without enumerating an unbounded series.
    getRecurrenceCandidates(input.recurrence, {
      fromDate: input.recurrence.startDate,
      toDateExclusive: input.recurrence.startDate,
    });
    const candidate = { date: input.recurrence.startDate, slot: 0 };
    const occurrence = evaluateRecurrenceCandidate(candidate, input.timing);
    // A gap is a valid schedule, but the engine returns before checking end
    // overflow in that case. Validate duration in a gap-free zone as well.
    if (occurrence === null && input.timing.kind === 'timed')
      evaluateRecurrenceCandidate(candidate, { ...input.timing, timeZone: 'UTC' });
    return true;
  } catch {
    return false;
  }
};

export const isValidEventSeries = (v: unknown): v is EventSeries => {
  if (
    !record(v) ||
    !keys(v, ['id', 'title', 'segments', 'created', 'modified']) ||
    !isValidEntityId(v['id']) ||
    Object.hasOwn(Object.prototype, v['id']) ||
    !isEventSeriesTimestamp(v['created']) ||
    !isEventSeriesTimestamp(v['modified']) ||
    v['modified'] < v['created'] ||
    !Array.isArray(v['segments']) ||
    v['segments'].length !== 1
  )
    return false;
  const segment = v['segments'][0];
  return (
    record(segment) &&
    keys(segment, ['id', 'logicalSlotOffset', 'recurrence', 'timing']) &&
    (!Object.hasOwn(segment, 'logicalSlotOffset') ||
      isLogicalSlot(segment['logicalSlotOffset'])) &&
    isValidEntityId(segment['id']) &&
    !Object.hasOwn(Object.prototype, segment['id']) &&
    isValidEventSeriesInput({
      title: v['title'],
      recurrence: segment['recurrence'],
      timing: segment['timing'],
    })
  );
};

export const isValidEventSeriesState = (v: unknown): v is EventSeriesState => {
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
        isValidEntityId(id) && isValidEventSeries(entities[id]) && entities[id].id === id,
    )
  );
};
