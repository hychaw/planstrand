import { extractActionPayload } from '@sp/sync-core';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import type { Operation } from '../../op-log/core/operation.types';
import { validateRoutinesOperation } from '../../op-log/validation/validate-routines-operation';
import { eventSeriesReducer } from './store/event-series.reducer';
import { occurrenceExceptionReducer } from './store/occurrence-exception.reducer';
import { weeklyTemplateReducer } from './store/weekly-template.reducer';
import { isValidEventSeriesState } from './event-series.validation';
import { isValidOccurrenceExceptionState } from './occurrence-exception.validation';
import { isValidWeeklyTemplateState } from './weekly-template.validation';
import type { EventSeriesState } from './event-series.model';
import type { OccurrenceExceptionState } from './occurrence-exception.model';
import type { WeeklyTemplateState } from './weekly-template.model';

interface RecoveryRow {
  serverSeq: number;
  entityType: string;
  entityId: string | null;
  entityIds?: string[];
  actionType?: string;
  opType: string;
  schemaVersion: number;
  payload: unknown;
  isPayloadEncrypted: boolean;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const slices = {
  EVENT_SERIES: 'eventSeries',
  OCCURRENCE_EXCEPTION: 'occurrenceException',
  WEEKLY_TEMPLATE: 'weeklyTemplate',
} as const;

/** Validate snapshots too: a valid tail must not conceal an invalid replay base. */
export const validateRoutinesRecoveryState = (state: Record<string, unknown>): void => {
  if (
    Object.hasOwn(state, 'actionPayload') ||
    Object.hasOwn(state, 'entityChanges') ||
    Object.keys(slices).some((key) => Object.hasOwn(state, key))
  )
    throw new Error('RECOVERY_INVALID_FULL_STATE');
  for (const [key, validate] of [
    ['eventSeries', isValidEventSeriesState],
    ['occurrenceException', isValidOccurrenceExceptionState],
    ['weeklyTemplate', isValidWeeklyTemplateState],
  ] as const) {
    if (Object.hasOwn(state, key) && !validate(state[key]))
      throw new Error('RECOVERY_INVALID_ROUTINES_STATE');
  }
};

/** Operator-only bridge to the exact reducers used by client hydration.
 * No projections, services, ambient clock, cascades or materialized occurrences.
 */
export const applyRoutinesRecoveryOperation = (
  state: Record<string, unknown>,
  row: RecoveryRow,
): boolean => {
  if (!Object.hasOwn(slices, row.entityType)) {
    if (
      /^\[(EventSeries|OccurrenceException|WeeklyTemplate|EVENT_SERIES|OCCURRENCE_EXCEPTION|WEEKLY_TEMPLATE)\]/.test(
        row.actionType ?? '',
      )
    )
      throw new Error(`RECOVERY_INVALID_ROUTINES_OPERATION at sequence ${row.serverSeq}`);
    return false;
  }
  try {
    if (
      row.isPayloadEncrypted ||
      row.schemaVersion !== CURRENT_SCHEMA_VERSION ||
      !row.entityId ||
      !row.actionType ||
      (row.entityIds?.length &&
        (row.entityIds.length !== 1 || row.entityIds[0] !== row.entityId)) ||
      !record(row.payload)
    )
      throw new Error();
    const outer = row.payload;
    const wrapped = Object.hasOwn(outer, 'actionPayload');
    // V1.2 capture emits empty entityChanges for these single-register actions.
    // Unknown batch footprints are not an alternative reconstruction format.
    if (
      wrapped &&
      (!record(outer['actionPayload']) ||
        !Array.isArray(outer['entityChanges']) ||
        outer['entityChanges'].length !== 0 ||
        Object.keys(outer).some(
          (key) => !['actionPayload', 'entityChanges', 'lwwUpdateMode'].includes(key),
        ) ||
        (Object.hasOwn(outer, 'lwwUpdateMode') &&
          !['replace', 'patch'].includes(outer['lwwUpdateMode'] as string)))
    )
      throw new Error();
    const body = extractActionPayload(outer);
    if (!record(body)) throw new Error();
    const validation = validateRoutinesOperation(
      row as Pick<Operation, 'entityType' | 'actionType' | 'opType' | 'entityId'>,
      body,
    );
    if (!validation?.success) throw new Error();
    // Reject extra action-envelope fields even for older complete-definition ops.
    const allowed =
      row.actionType === '[EventSeries] Add Event Series'
        ? ['eventSeries']
        : row.actionType === '[EventSeries] Update Event Series'
          ? ['id', 'changes', 'modified']
          : undefined;
    if (allowed && Object.keys(body).some((key) => !allowed.includes(key)))
      throw new Error();
    validateRoutinesRecoveryState(state);
    const action = { ...body, type: row.actionType };
    const key = slices[row.entityType as keyof typeof slices];
    switch (row.entityType) {
      case 'EVENT_SERIES':
        state[key] = eventSeriesReducer(
          state[key] as EventSeriesState | undefined,
          action,
        );
        break;
      case 'OCCURRENCE_EXCEPTION':
        state[key] = occurrenceExceptionReducer(
          state[key] as OccurrenceExceptionState | undefined,
          action,
        );
        break;
      case 'WEEKLY_TEMPLATE':
        state[key] = weeklyTemplateReducer(
          state[key] as WeeklyTemplateState | undefined,
          action,
        );
        break;
    }
    validateRoutinesRecoveryState(state);
    return true;
  } catch {
    // Reducer/decryption internals must never leak private payloads in CLI errors.
    throw new Error(`RECOVERY_INVALID_ROUTINES_OPERATION at sequence ${row.serverSeq}`);
  }
};
