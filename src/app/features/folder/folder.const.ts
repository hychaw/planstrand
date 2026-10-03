import { Folder } from './folder.model';

/** Reserved domain identity. Later migration maps INBOX_PROJECT to this id. */
export const INBOX_FOLDER_ID = 'INBOX_FOLDER';
export const INBOX_FOLDER: Folder = Object.freeze({
  id: INBOX_FOLDER_ID,
  title: 'Inbox',
  parentId: null,
});

/** System semantics come from identity, never a mutable title or duplicated flag. */
export const isInboxFolder = (folder: Folder): boolean => folder.id === INBOX_FOLDER_ID;
