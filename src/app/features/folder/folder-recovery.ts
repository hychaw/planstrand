import { extractActionPayload } from '@sp/sync-core';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { isFolderState } from './folder-state';
import { folderReducer } from './store/folder.reducer';
import {
  addFolder,
  updateFolder,
  moveFolder,
  removeFolder,
} from './store/folder.actions';
import type { FolderState } from './folder.model';

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
const actions: readonly string[] = [
  addFolder.type,
  updateFolder.type,
  moveFolder.type,
  removeFolder.type,
];

export const validateFolderRecoveryState = (state: Record<string, unknown>): void => {
  if (
    Object.hasOwn(state, 'FOLDER') ||
    (Object.hasOwn(state, 'folder') && !isFolderState(state['folder']))
  )
    throw new Error('RECOVERY_INVALID_FOLDER_STATE');
};

/** Accepted server sequence already records conflict resolution. Install the
 * captured whole hierarchy, never rerun an intent against a different base.
 */
export const applyFolderRecoveryOperation = (
  state: Record<string, unknown>,
  row: RecoveryRow,
): boolean => {
  if (row.entityType !== 'FOLDER') {
    if (/^\[(Folder|FOLDER)\]/.test(row.actionType ?? ''))
      throw new Error(`RECOVERY_INVALID_FOLDER_OPERATION at sequence ${row.serverSeq}`);
    return false;
  }
  try {
    if (
      row.isPayloadEncrypted ||
      row.schemaVersion !== CURRENT_SCHEMA_VERSION ||
      row.opType !== 'UPD' ||
      row.entityId !== '*' ||
      (row.entityIds?.length &&
        (row.entityIds.length !== 1 || row.entityIds[0] !== '*')) ||
      !record(row.payload)
    )
      throw new Error();
    const outer = row.payload;
    if (
      Object.hasOwn(outer, 'actionPayload') &&
      (!record(outer['actionPayload']) ||
        !Array.isArray(outer['entityChanges']) ||
        outer['entityChanges'].length !== 0 ||
        Object.keys(outer).some(
          (k) => !['actionPayload', 'entityChanges', 'lwwUpdateMode'].includes(k),
        ) ||
        (Object.hasOwn(outer, 'lwwUpdateMode') && outer['lwwUpdateMode'] !== 'replace'))
    )
      throw new Error();
    const body = extractActionPayload(outer);
    if (!record(body)) throw new Error();
    const compensation = row.actionType === '[FOLDER] LWW Update';
    if (
      !compensation &&
      (!actions.includes(row.actionType ?? '') ||
        Object.keys(body).some((k) => k !== 'folderState'))
    )
      throw new Error();
    const folderState = compensation ? body : body['folderState'];
    if (!isFolderState(folderState)) throw new Error();
    validateFolderRecoveryState(state);
    // Singleton compensation uses the same complete replacement as normal
    // Folder actions (lww-update.meta-reducer validates and installs the state).
    state['folder'] = folderReducer(
      state['folder'] as FolderState | undefined,
      {
        type: compensation ? updateFolder.type : row.actionType!,
        folderState,
        meta: { isPersistent: true },
      } as ReturnType<typeof updateFolder>,
    );
    validateFolderRecoveryState(state);
    return true;
  } catch {
    throw new Error(`RECOVERY_INVALID_FOLDER_OPERATION at sequence ${row.serverSeq}`);
  }
};
