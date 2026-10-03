import { createEntityAdapter } from '@ngrx/entity';
import { Folder, FolderState } from './folder.model';
import { INBOX_FOLDER, INBOX_FOLDER_ID } from './folder.const';
import { getFolderChildren, isFolderOrderKey, isValidFolderParent } from './folder.util';

export const folderAdapter = createEntityAdapter<Folder>();
export const initialFolderState: FolderState = folderAdapter.addOne(
  INBOX_FOLDER,
  folderAdapter.getInitialState<FolderState>({}),
);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Exact current-client shape. Never repair ambiguous ancestry or Inbox mutations. */
export const isFolderState = (v: unknown): v is FolderState => {
  if (
    !isRecord(v) ||
    Object.keys(v).some(
      (k) => !['ids', 'entities', 'legacyProjectMigrationComplete'].includes(k),
    ) ||
    (v['legacyProjectMigrationComplete'] !== undefined &&
      v['legacyProjectMigrationComplete'] !== true)
  )
    return false;
  const ids = v['ids'],
    entities = v['entities'];
  if (
    !Array.isArray(ids) ||
    !isRecord(entities) ||
    new Set(ids).size !== ids.length ||
    Object.keys(entities).length !== ids.length ||
    !ids.every(
      (id, index) =>
        typeof id === 'string' &&
        id.trim().length > 0 &&
        !Object.hasOwn(Object.prototype, id) &&
        Object.hasOwn(entities, id) &&
        (index === 0 || ids[index - 1] < id),
    )
  )
    return false;
  for (const id of ids) {
    const folder = entities[id];
    if (
      !isRecord(folder) ||
      folder['id'] !== id ||
      typeof folder['title'] !== 'string' ||
      Object.keys(folder).some(
        (key) => !['id', 'title', 'parentId', 'orderKey'].includes(key),
      ) ||
      (folder['parentId'] !== undefined &&
        folder['parentId'] !== null &&
        typeof folder['parentId'] !== 'string') ||
      (folder['orderKey'] !== undefined && !isFolderOrderKey(folder['orderKey']))
    )
      return false;
  }
  const state = v as unknown as FolderState;
  const inbox = state.entities[INBOX_FOLDER_ID];
  if (!inbox || inbox.title !== INBOX_FOLDER.title || (inbox.parentId ?? null) !== null)
    return false;
  // Memoized iterative screening stays linear even for very deep trees.
  const complete = new Set<string>();
  for (const id of ids) {
    const path = new Set<string>();
    let current: string | null = id;
    while (current !== null && !complete.has(current)) {
      if (path.has(current) || !Object.hasOwn(state.entities, current)) return false;
      path.add(current);
      current = state.entities[current]!.parentId ?? null;
    }
    for (const entry of path) complete.add(entry);
  }
  return true;
};
export const assertFolderState: (value: unknown) => asserts value is FolderState = (
  value,
) => {
  if (!isFolderState(value)) throw new Error('Invalid Folder state');
};
export type FolderIntent =
  | { kind: 'add'; folder: Folder }
  | { kind: 'update'; id: string; changes: Partial<Pick<Folder, 'title'>> }
  | { kind: 'move'; id: string; parentId: string | null; orderKey: string }
  | { kind: 'remove'; id: string };
/** Producing-side transition only. Replay carries its complete result. */
export const applyFolderIntent = (
  state: FolderState,
  intent: FolderIntent,
): FolderState => {
  assertFolderState(state);
  if (intent.kind === 'add') {
    const folder = intent.folder,
      parentId = folder.parentId ?? null;
    if (
      typeof folder.id !== 'string' ||
      folder.id.trim().length === 0 ||
      Object.hasOwn(Object.prototype, folder.id) ||
      Object.hasOwn(state.entities, folder.id) ||
      typeof folder.title !== 'string' ||
      (folder.orderKey !== undefined && !isFolderOrderKey(folder.orderKey)) ||
      !isValidFolderParent(state, folder.id, parentId)
    )
      return state;
    const next = folderAdapter.addOne(
      { id: folder.id, title: folder.title, parentId, orderKey: folder.orderKey ?? 'V' },
      state,
    );
    return { ...next, ids: [...next.ids].sort() };
  }
  const folder = state.entities[intent.id];
  if (
    !Object.hasOwn(state.entities, intent.id) ||
    !folder ||
    intent.id === INBOX_FOLDER_ID
  )
    return state;
  if (intent.kind === 'update') {
    if (typeof intent.changes.title !== 'string' || intent.changes.title === folder.title)
      return state;
    return folderAdapter.updateOne(
      { id: intent.id, changes: { title: intent.changes.title } },
      state,
    );
  }
  if (intent.kind === 'remove')
    return getFolderChildren(state, intent.id).length
      ? state
      : folderAdapter.removeOne(intent.id, state);
  if (
    !isFolderOrderKey(intent.orderKey) ||
    !isValidFolderParent(state, intent.id, intent.parentId) ||
    ((folder.parentId ?? null) === intent.parentId &&
      (folder.orderKey ?? 'V') === intent.orderKey)
  )
    return state;
  return folderAdapter.updateOne(
    { id: intent.id, changes: { parentId: intent.parentId, orderKey: intent.orderKey } },
    state,
  );
};
