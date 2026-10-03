import { createReducer, on } from '@ngrx/store';
import * as FolderActions from './folder.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { assertFolderState, initialFolderState } from '../folder-state';

export { folderAdapter, initialFolderState } from '../folder-state';
export const FOLDER_FEATURE_NAME = 'folder';
export const folderReducer = createReducer(
  initialFolderState,
  on(
    FolderActions.addFolder,
    FolderActions.updateFolder,
    FolderActions.moveFolder,
    FolderActions.removeFolder,
    (_state, { folderState, meta }) => {
      if (meta.isPersistent === false) return _state;
      assertFolderState(folderState);
      return folderState;
    },
  ),
  on(loadAllData, (_state, { appDataComplete }) => {
    if (!Object.hasOwn(appDataComplete, 'folder')) return initialFolderState;
    const folder = (appDataComplete as { folder?: unknown }).folder;
    assertFolderState(folder);
    return folder;
  }),
);
