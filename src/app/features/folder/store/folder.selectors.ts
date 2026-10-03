import { createFeatureSelector, createSelector, MemoizedSelector } from '@ngrx/store';
import { Folder, FolderState } from '../folder.model';
import { getFolderChildren, getFolderDescendantIds } from '../folder.util';
import { INBOX_FOLDER_ID } from '../folder.const';
import { FOLDER_FEATURE_NAME, folderAdapter } from './folder.reducer';

export const selectFolderFeatureState =
  createFeatureSelector<FolderState>(FOLDER_FEATURE_NAME);
export const selectAllFolders = createSelector(
  selectFolderFeatureState,
  folderAdapter.getSelectors().selectAll,
);
export const selectFolderById = (
  id: string,
): MemoizedSelector<object, Folder | undefined> =>
  createSelector(selectFolderFeatureState, (state) => state.entities[id]);
export const selectInboxFolder = selectFolderById(INBOX_FOLDER_ID);
export const selectFolderChildren = (
  parentId: string | null,
): MemoizedSelector<object, Folder[]> =>
  createSelector(selectFolderFeatureState, (state) => getFolderChildren(state, parentId));
export const selectRootFolders = selectFolderChildren(null);
export const selectFolderDescendantIds = (
  id: string,
): MemoizedSelector<object, string[]> =>
  createSelector(selectFolderFeatureState, (state) => getFolderDescendantIds(state, id));
