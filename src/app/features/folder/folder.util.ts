import { Folder, FolderState } from './folder.model';
import { isPlanningOrderKey, planningOrderBetween } from '@sp/shared-schema';

// Reuse the existing arbitrary-precision dense key algorithm without a second format.
export const folderOrderBetween = planningOrderBetween;
export const isFolderOrderKey = isPlanningOrderKey;
export const compareFolders = (a: Folder, b: Folder): number => {
  const left = a.orderKey ?? 'V';
  const right = b.orderKey ?? 'V';
  return left < right ? -1 : left > right ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export const getFolderChildren = (
  state: FolderState,
  parentId: string | null = null,
): Folder[] =>
  state.ids
    .map((id) => state.entities[id])
    .filter(
      (folder): folder is Folder => !!folder && (folder.parentId ?? null) === parentId,
    )
    .sort(compareFolders);

/** Iterative traversal supports deep nesting without consuming the call stack. */
export const getFolderDescendantIds = (state: FolderState, id: string): string[] => {
  if (!Object.hasOwn(state.entities, id)) return [];
  const children = new Map<string, string[]>();
  for (const folderId of state.ids) {
    const folder = state.entities[folderId];
    if (folder?.parentId) {
      const siblings = children.get(folder.parentId) ?? [];
      siblings.push(folderId);
      children.set(folder.parentId, siblings);
    }
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => compareFolders(state.entities[a]!, state.entities[b]!));
  const visited = new Set([id]);
  const pending = [...(children.get(id) ?? [])].reverse();
  const result: string[] = [];
  while (pending.length) {
    const next = pending.pop()!;
    if (visited.has(next)) continue;
    visited.add(next);
    result.push(next);
    const nested = children.get(next) ?? [];
    for (let i = nested.length - 1; i >= 0; i--) pending.push(nested[i]);
  }
  return result;
};

/** Reject missing parents, self/descendant moves and malformed ancestor chains. */
export const isValidFolderParent = (
  state: FolderState,
  id: string,
  parentId: string | null,
): boolean => {
  const visited = new Set([id]);
  let current = parentId;
  while (current !== null) {
    if (visited.has(current)) return false;
    visited.add(current);
    if (!Object.hasOwn(state.entities, current)) return false;
    const parent = state.entities[current];
    if (!parent) return false;
    current = parent.parentId ?? null;
  }
  return true;
};
