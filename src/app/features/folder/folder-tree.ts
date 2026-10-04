import { Folder, FolderState } from './folder.model';
import { compareFolders } from './folder.util';
import { INBOX_FOLDER_ID } from './folder.const';

export interface FolderTreeRow {
  folder: Folder;
  depth: number;
  path: string;
  hasChildren: boolean;
}

/** One adjacency index, then iterative traversal; empty and deeply nested folders survive. */
export const folderTreeRows = (state: FolderState): FolderTreeRow[] => {
  const children = new Map<string | null, Folder[]>();
  for (const id of state.ids) {
    const folder = state.entities[id];
    if (!folder) continue;
    const parent = folder.parentId ?? null;
    const siblings = children.get(parent) ?? [];
    siblings.push(folder);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareFolders);
  const roots = [...(children.get(null) ?? [])].sort((a, b) =>
    a.id === INBOX_FOLDER_ID ? -1 : b.id === INBOX_FOLDER_ID ? 1 : compareFolders(a, b),
  );
  const pending = roots
    .map((folder) => ({ folder, depth: 0, path: folder.title }))
    .reverse();
  const seen = new Set<string>();
  const result: FolderTreeRow[] = [];
  while (pending.length) {
    const row = pending.pop()!;
    if (seen.has(row.folder.id)) continue;
    seen.add(row.folder.id);
    const nested = children.get(row.folder.id) ?? [];
    result.push({ ...row, hasChildren: nested.length > 0 });
    for (let i = nested.length - 1; i >= 0; i--)
      pending.push({
        folder: nested[i],
        depth: row.depth + 1,
        path: `${row.path} / ${nested[i].title}`,
      });
  }
  return result;
};

export const visibleFolderRows = (
  rows: FolderTreeRow[],
  collapsed: ReadonlySet<string>,
): FolderTreeRow[] => {
  let hiddenBelow = Infinity;
  return rows.filter((row) => {
    if (row.depth > hiddenBelow) return false;
    hiddenBelow = collapsed.has(row.folder.id) ? row.depth : Infinity;
    return true;
  });
};
