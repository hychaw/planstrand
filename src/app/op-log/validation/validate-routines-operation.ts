import {
  isValidWeeklyTemplate,
  isValidWeeklyTemplateInput,
} from '../../features/routines/weekly-template.validation';
import { isValidOccurrenceException } from '../../features/routines/occurrence-exception.validation';
import {
  isValidEventSeries,
  isValidEventSeriesInput,
  isValidEventSeriesPlan,
  isEventSeriesTimestamp,
} from '../../features/routines/event-series.validation';
import { ActionType } from '../core/action-types.enum';
import { OpType } from '@sp/sync-core';
import { isValidEntityId } from './is-valid-entity-id';
import type { Operation } from '../core/operation.types';

/** Shared persisted Routines vocabulary, without browser logging dependencies. */
export const validateRoutinesOperation = (
  op: Pick<Operation, 'entityType' | 'actionType' | 'opType' | 'entityId'>,
  actionPayload: Record<string, unknown>,
): { success: boolean; error?: string } | undefined => {
  if (op.entityType === 'OCCURRENCE_EXCEPTION') {
    const p = actionPayload as Record<string, unknown>;
    const value =
      op.actionType === ActionType.OCCURRENCE_EXCEPTION_SET &&
      Object.keys(p).every((k) => k === 'occurrenceException')
        ? p['occurrenceException']
        : (op.actionType as string) === '[OCCURRENCE_EXCEPTION] LWW Update'
          ? p
          : null;
    return op.opType === OpType.Update &&
      isValidOccurrenceException(value) &&
      value.id === op.entityId
      ? { success: true }
      : { success: false, error: 'Invalid OccurrenceException operation' };
  }
  if (op.entityType === 'WEEKLY_TEMPLATE') {
    const p = actionPayload as Record<string, unknown>;
    const valid =
      (op.actionType === ActionType.WEEKLY_TEMPLATE_ADD &&
        op.opType === OpType.Create &&
        isValidWeeklyTemplate(p['weeklyTemplate']) &&
        p['weeklyTemplate'].id === op.entityId &&
        Object.keys(p).every((k) => k === 'weeklyTemplate')) ||
      (op.actionType === ActionType.WEEKLY_TEMPLATE_UPDATE &&
        op.opType === OpType.Update &&
        p['id'] === op.entityId &&
        isValidEntityId(p['id']) &&
        isValidWeeklyTemplateInput(p['changes']) &&
        isEventSeriesTimestamp(p['modified']) &&
        Object.keys(p).every((k) => ['id', 'changes', 'modified'].includes(k))) ||
      (op.actionType === ActionType.WEEKLY_TEMPLATE_DELETE &&
        op.opType === OpType.Update &&
        isValidWeeklyTemplate(p['weeklyTemplate']) &&
        p['weeklyTemplate'].id === op.entityId &&
        p['weeklyTemplate'].deletedAt !== undefined &&
        Object.keys(p).every((k) => k === 'weeklyTemplate')) ||
      ((op.actionType as string) === '[WEEKLY_TEMPLATE] LWW Update' &&
        op.opType === OpType.Update &&
        isValidWeeklyTemplate(p) &&
        p['id'] === op.entityId);
    return valid
      ? { success: true }
      : { success: false, error: 'Invalid WeeklyTemplate operation' };
  }
  if (op.entityType === 'EVENT_SERIES') {
    const p = actionPayload as Record<string, unknown>;
    const valid =
      (op.actionType === ActionType.EVENT_SERIES_ADD &&
        op.opType === OpType.Create &&
        isValidEventSeries(p['eventSeries']) &&
        p['eventSeries'].id === op.entityId) ||
      (op.actionType === ActionType.EVENT_SERIES_UPDATE &&
        op.opType === OpType.Update &&
        p['id'] === op.entityId &&
        isValidEntityId(p['id']) &&
        isValidEventSeriesInput(p['changes']) &&
        isEventSeriesTimestamp(p['modified'])) ||
      (op.actionType === ActionType.EVENT_SERIES_REPLACE_PLAN &&
        op.opType === OpType.Update &&
        p['id'] === op.entityId &&
        isValidEntityId(p['id']) &&
        isValidEventSeriesPlan(p['plan']) &&
        isEventSeriesTimestamp(p['modified']) &&
        Object.keys(p).every((k) => ['id', 'plan', 'modified'].includes(k))) ||
      (op.actionType === ActionType.EVENT_SERIES_DELETE &&
        op.opType === OpType.Update &&
        isValidEventSeries(p['eventSeries']) &&
        p['eventSeries'].id === op.entityId &&
        p['eventSeries'].deletedAt !== undefined &&
        Object.keys(p).every((k) => k === 'eventSeries')) ||
      ((op.actionType as string) === '[EVENT_SERIES] LWW Update' &&
        op.opType === OpType.Update &&
        isValidEventSeries(p) &&
        p['id'] === op.entityId);
    return valid
      ? { success: true }
      : { success: false, error: 'Invalid EventSeries operation' };
  }

  return undefined;
};
