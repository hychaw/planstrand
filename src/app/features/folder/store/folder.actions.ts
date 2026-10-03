import { createAction } from '@ngrx/store';
import { Folder, FolderState } from '../folder.model';
import { applyFolderIntent, FolderIntent } from '../folder-state';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

/** One shared hierarchy conflict identity, including ordering and leaf removal. */
export const FOLDER_SYNC_ID = '*';
const snapshotIntent = (
  state: FolderState,
  intent: FolderIntent,
): { folderState: FolderState; meta: PersistentActionMeta } => {
  const folderState = applyFolderIntent(state, intent);
  return {
    folderState,
    meta: {
      isPersistent: folderState !== state,
      entityType: 'FOLDER',
      entityId: FOLDER_SYNC_ID,
      // Every intent updates the singleton; DEL would delete the whole domain.
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  };
};
// Only the resulting snapshot crosses capture. Receivers never infer ancestry
// or position from their local state. Callers must supply the current state.
export const addFolder = createAction(
  '[Folder] Add',
  (p: { state: FolderState; folder: Folder }) =>
    snapshotIntent(p.state, { kind: 'add', folder: p.folder }),
);
export const updateFolder = createAction(
  '[Folder] Update',
  (p: { state: FolderState; id: string; changes: Partial<Pick<Folder, 'title'>> }) =>
    snapshotIntent(p.state, { kind: 'update', id: p.id, changes: p.changes }),
);
export const moveFolder = createAction(
  '[Folder] Move',
  (p: { state: FolderState; id: string; parentId: string | null; orderKey: string }) =>
    snapshotIntent(p.state, {
      kind: 'move',
      id: p.id,
      parentId: p.parentId,
      orderKey: p.orderKey,
    }),
);
export const removeFolder = createAction(
  '[Folder] Remove',
  (p: { state: FolderState; id: string }) =>
    snapshotIntent(p.state, { kind: 'remove', id: p.id }),
);
