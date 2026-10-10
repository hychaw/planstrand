import { isLogicalSlot } from './occurrence-key';
import { isValidEntityId } from '../../op-log/validation/is-valid-entity-id';
import {
  EventSeries,
  EventSeriesInput,
  EventSeriesState,
  EventSeriesPlan,
} from './event-series.model';
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

/** Increasing offsets define disjoint, exhaustive logical-slot ownership.
 * The first segment keeps legacy offset zero; IDs cannot be reused in a plan.
 */
export const isValidEventSeriesPlan = (v: unknown): v is EventSeriesPlan => {
  if (
    !record(v) ||
    !keys(v, ['title', 'segments']) ||
    typeof v['title'] !== 'string' ||
    !v['title'].trim() ||
    !Array.isArray(v['segments']) ||
    !v['segments'].length
  )
    return false;
  let previous = -1;
  const ids = new Set<string>();
  return v['segments'].every((segment, index) => {
    if (
      !record(segment) ||
      !keys(segment, ['id', 'logicalSlotOffset', 'title', 'recurrence', 'timing']) ||
      !isValidEntityId(segment['id']) ||
      Object.hasOwn(Object.prototype, segment['id']) ||
      ids.has(segment['id']) ||
      (Object.hasOwn(segment, 'title') &&
        (typeof segment['title'] !== 'string' || !segment['title'].trim()))
    )
      return false;
    const offset = Object.hasOwn(segment, 'logicalSlotOffset')
      ? segment['logicalSlotOffset']
      : 0;
    if (!isLogicalSlot(offset) || (index === 0 && offset !== 0) || offset <= previous)
      return false;
    previous = offset;
    ids.add(segment['id']);
    const input = {
      title: v['title'],
      recurrence: segment['recurrence'],
      timing: segment['timing'],
    };
    if (!isValidEventSeriesInput(input)) return false;
    // Every engine family reserves at most one slot per civil day. Keep enough
    // numeric headroom for its supported date range, including skipped slots.
    const remainingDays =
      (Date.parse(`${input.recurrence.endDate ?? '9999-12-31'}T00:00:00Z`) -
        Date.parse(`${input.recurrence.startDate}T00:00:00Z`)) /
      86400000;
    return Number.isSafeInteger(offset + remainingDays + 1);
  });
};

export const isValidEventSeries = (v: unknown): v is EventSeries => {
  return (
    record(v) &&
    keys(v, ['id', 'title', 'segments', 'created', 'modified', 'deletedAt']) &&
    isValidEntityId(v['id']) &&
    !Object.hasOwn(Object.prototype, v['id']) &&
    isEventSeriesTimestamp(v['created']) &&
    isEventSeriesTimestamp(v['modified']) &&
    v['modified'] >= v['created'] &&
    (!Object.hasOwn(v, 'deletedAt') ||
      (isEventSeriesTimestamp(v['deletedAt']) &&
        v['deletedAt'] >= v['created'] &&
        v['modified'] >= v['deletedAt'])) &&
    isValidEventSeriesPlan({ title: v['title'], segments: v['segments'] })
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
