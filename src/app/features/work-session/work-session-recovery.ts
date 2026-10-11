import { extractActionPayload } from '@sp/sync-core';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import * as actions from './store/work-session.actions';
import {
  workSessionReducer,
  isValidWorkSessionState,
  isValidWorkSession,
} from './store/work-session.reducer';
import type { WorkSessionState } from './work-session.model';
import { isValidEntityId } from '../../op-log/validation/is-valid-entity-id';
import { isValidIanaTimeZone } from '../../util/is-valid-iana-time-zone';

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
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const contracts = new Map<string, { op: string; keys: string[] }>([
  [actions.addWorkSession.type, { op: 'CRT', keys: ['workSession'] }],
  [
    actions.updateWorkSession.type,
    { op: 'UPD', keys: ['id', 'changes', 'modified', 'legacySession'] },
  ],
  [actions.removeWorkSession.type, { op: 'DEL', keys: ['id'] }],
  [
    actions.completeWorkSession.type,
    { op: 'UPD', keys: ['id', 'completedAt', 'modified', 'legacySession'] },
  ],
  [
    actions.uncompleteWorkSession.type,
    { op: 'UPD', keys: ['id', 'modified', 'legacySession'] },
  ],
]);
export const validateWorkSessionRecoveryState = (
  state: Record<string, unknown>,
): void => {
  const task = state['task'] as { ids?: string[] } | undefined;
  if (!isValidWorkSessionState(state['workSession'], new Set(task?.ids ?? [])))
    throw new Error('RECOVERY_INVALID_WORK_SESSION_STATE');
};

/** Mixed Folder histories must preserve actual WorkSession tails, rather than
 * falling through to the generic uppercase entity map. No synthetic sessions.
 */
export const applyWorkSessionRecoveryOperation = (
  state: Record<string, unknown>,
  row: RecoveryRow,
): boolean => {
  if (row.entityType !== 'WORK_SESSION') {
    if (/^\[(WorkSession|WORK_SESSION)\]/.test(row.actionType ?? ''))
      throw new Error(
        `RECOVERY_INVALID_WORK_SESSION_OPERATION at sequence ${row.serverSeq}`,
      );
    return false;
  }
  try {
    const contract = contracts.get(row.actionType ?? '');
    if (
      !contract ||
      contract.op !== row.opType ||
      row.isPayloadEncrypted ||
      row.schemaVersion !== CURRENT_SCHEMA_VERSION ||
      !isValidEntityId(row.entityId) ||
      (row.entityIds?.length &&
        (row.entityIds.length !== 1 || row.entityIds[0] !== row.entityId)) ||
      !record(row.payload)
    )
      throw new Error();
    const outer = row.payload;
    if (
      Object.hasOwn(outer, 'actionPayload') &&
      (!record(outer['actionPayload']) ||
        !Array.isArray(outer['entityChanges']) ||
        outer['entityChanges'].length !== 0 ||
        Object.keys(outer).some((k) => !['actionPayload', 'entityChanges'].includes(k)))
    )
      throw new Error();
    const body = extractActionPayload(outer);
    if (
      !record(body) ||
      Object.keys(body).some((k) => !contract.keys.includes(k)) ||
      (row.opType === 'CRT'
        ? !record(body['workSession']) || body['workSession']['id'] !== row.entityId
        : body['id'] !== row.entityId)
    )
      throw new Error();
    if (
      (row.actionType === actions.updateWorkSession.type && !record(body['changes'])) ||
      (row.opType === 'UPD' &&
        (typeof body['modified'] !== 'number' ||
          !Number.isFinite(body['modified']) ||
          body['modified'] < 0)) ||
      (row.actionType === actions.completeWorkSession.type &&
        (typeof body['completedAt'] !== 'number' ||
          !Number.isFinite(body['completedAt']) ||
          body['completedAt'] < 0)) ||
      (Object.hasOwn(body, 'legacySession') &&
        (!isValidWorkSession(body['legacySession']) ||
          body['legacySession'].id !== row.entityId))
    )
      throw new Error();
    if (row.actionType === actions.updateWorkSession.type) {
      const changes = body['changes'] as Record<string, unknown>;
      if (
        Object.keys(changes).some(
          (key) => !['taskId', 'start', 'end', 'timeZone'].includes(key),
        ) ||
        (Object.hasOwn(changes, 'taskId') && !isValidEntityId(changes['taskId'])) ||
        ['start', 'end'].some(
          (key) =>
            Object.hasOwn(changes, key) &&
            (typeof changes[key] !== 'number' ||
              !Number.isFinite(changes[key]) ||
              changes[key] < 0),
        ) ||
        (Object.hasOwn(changes, 'timeZone') &&
          (typeof changes['timeZone'] !== 'string' ||
            !isValidIanaTimeZone(changes['timeZone'])))
      )
        throw new Error();
    }
    validateWorkSessionRecoveryState(state);
    state['workSession'] = workSessionReducer(state['workSession'] as WorkSessionState, {
      ...body,
      type: row.actionType!,
    });
    validateWorkSessionRecoveryState(state);
    return true;
  } catch {
    throw new Error(
      `RECOVERY_INVALID_WORK_SESSION_OPERATION at sequence ${row.serverSeq}`,
    );
  }
};
