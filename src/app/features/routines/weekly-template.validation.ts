import { isValidEntityId } from '../../op-log/validation/is-valid-entity-id';
import { isValidDBDateStr } from '../../util/get-db-date-str';
import { isEventSeriesTimestamp } from './event-series.validation';
import {
  WeeklyTemplate,
  WeeklyTemplateInput,
  WeeklyTemplateState,
} from './weekly-template.model';

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(v).every((key) => allowed.includes(key));
const validId = (v: unknown): v is string =>
  isValidEntityId(v) && !Object.hasOwn(Object.prototype, v);
const date = (v: unknown): v is string => typeof v === 'string' && isValidDBDateStr(v);

export const isValidWeeklyTemplateInput = (v: unknown): v is WeeklyTemplateInput =>
  record(v) &&
  keys(v, ['title', 'isActive', 'startDate', 'endDate']) &&
  typeof v['title'] === 'string' &&
  !!v['title'].trim() &&
  typeof v['isActive'] === 'boolean' &&
  date(v['startDate']) &&
  (!Object.hasOwn(v, 'endDate') ||
    (date(v['endDate']) && v['endDate'] >= v['startDate']));

export const isValidWeeklyTemplate = (v: unknown): v is WeeklyTemplate =>
  record(v) &&
  keys(v, [
    'id',
    'title',
    'isActive',
    'startDate',
    'endDate',
    'created',
    'modified',
    'deletedAt',
  ]) &&
  validId(v['id']) &&
  isEventSeriesTimestamp(v['created']) &&
  isEventSeriesTimestamp(v['modified']) &&
  v['modified'] >= v['created'] &&
  (!Object.hasOwn(v, 'deletedAt') ||
    (isEventSeriesTimestamp(v['deletedAt']) &&
      v['deletedAt'] >= v['created'] &&
      v['modified'] >= v['deletedAt'])) &&
  isValidWeeklyTemplateInput({
    title: v['title'],
    isActive: v['isActive'],
    startDate: v['startDate'],
    ...(Object.hasOwn(v, 'endDate') ? { endDate: v['endDate'] } : {}),
  });

export const isValidWeeklyTemplateState = (v: unknown): v is WeeklyTemplateState => {
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
        validId(id) && isValidWeeklyTemplate(entities[id]) && entities[id].id === id,
    )
  );
};
