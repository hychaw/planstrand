import { hasMeaningfulFolderState } from '@sp/shared-schema';
import { ProjectState } from '../project/project.model';
import { INBOX_PROJECT } from '../project/project.const';
import {
  MenuTreeState,
  MenuTreeKind,
  MenuTreeTreeNode,
} from '../menu-tree/store/menu-tree.model';
import { Folder, FolderState } from './folder.model';
import { INBOX_FOLDER, INBOX_FOLDER_ID, PROJECT_FOLDER_PREFIX } from './folder.const';
import { assertFolderState, initialFolderState } from './folder-state';
import { folderOrderBetween } from './folder.util';

/** Namespaces are injective and separate from reserved Inbox and menu identities. */
export const projectFolderId = (id: string): string =>
  id === INBOX_PROJECT.id ? INBOX_FOLDER_ID : `${PROJECT_FOLDER_PREFIX}${id}`;
export const menuFolderId = (id: string): string => `MENU_FOLDER:${id}`;

/** One-time seed. Existing canonical state wins, even if only some projects migrated.
 * Titles are copied at cutover; Projects never continuously mirror into Folder.
 * The durable marker disambiguates an unmigrated Inbox from intentional deletion
 * of every migrated folder. Mark established state too, without rebuilding it.
 */
export const migrateLegacyProjectFolders = (
  project: ProjectState,
  menuTree: MenuTreeState,
  existing: FolderState = initialFolderState,
): FolderState => {
  assertFolderState(existing);
  if (existing.legacyProjectMigrationComplete) return existing;
  if (hasMeaningfulFolderState({ folder: existing }))
    return { ...existing, legacyProjectMigrationComplete: true };
  const active = [...new Set(project.ids.map(String))].filter((id) => {
    const p = Object.hasOwn(project.entities, id) ? project.entities[id] : undefined;
    return !!p && id !== INBOX_PROJECT.id && !p.isArchived && !p.isDone;
  });
  const activeSet = new Set(active);
  type Placement = { id: string; parentId: string | null; title: string };
  const placements: Placement[] = [];
  const counts = new Map<string, number>();
  const pending: { node: MenuTreeTreeNode; parentId: string | null }[] = (
    menuTree.projectTree ?? []
  )
    .map((node) => ({ node, parentId: null }))
    .reverse();
  const visited = new Set<object>();
  while (pending.length) {
    const { node, parentId } = pending.pop()!;
    if (
      !node ||
      typeof node !== 'object' ||
      typeof node.id !== 'string' ||
      !node.id.length
    )
      continue;
    if (node.k === MenuTreeKind.PROJECT && activeSet.has(node.id)) {
      const id = projectFolderId(node.id);
      placements.push({ id, parentId, title: project.entities[node.id]!.title });
      counts.set(id, (counts.get(id) ?? 0) + 1);
    } else if (node.k === MenuTreeKind.FOLDER) {
      const id = menuFolderId(node.id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (visited.has(node)) continue;
      visited.add(node);
      // Named legacy folders are real hierarchy, not fabricated placeholders.
      const valid = typeof node.name === 'string' && Array.isArray(node.children);
      if (valid) placements.push({ id, parentId, title: node.name });
      const children = Array.isArray(node.children) ? node.children : [];
      for (let i = children.length - 1; i >= 0; i--)
        pending.push({ node: children[i], parentId: valid ? id : null });
    }
  }
  if (!active.length && !placements.length) return existing;
  const unique = new Map(
    placements.filter((p) => counts.get(p.id) === 1).map((p) => [p.id, p]),
  );
  const entities: Record<string, Folder> = { [INBOX_FOLDER_ID]: INBOX_FOLDER };
  const lastKey = new Map<string | null, string>();
  const append = (p: Placement): void => {
    if (Object.hasOwn(entities, p.id)) return;
    const parentId =
      p.parentId && unique.has(p.parentId) && Object.hasOwn(entities, p.parentId)
        ? p.parentId
        : null;
    const orderKey = folderOrderBetween(
      lastKey.get(parentId) ?? (parentId === null ? 'V' : null),
      null,
    );
    lastKey.set(parentId, orderKey);
    entities[p.id] = { id: p.id, title: p.title, parentId, orderKey };
  };
  for (const p of placements) if (unique.has(p.id)) append(p);
  // Unplaced or ambiguously placed Projects fall back to root, in Project.ids
  // order (an explicit persisted list, never entity-object enumeration).
  for (const id of active)
    append({
      id: projectFolderId(id),
      title: project.entities[id]!.title,
      parentId: null,
    });
  const result: FolderState = {
    ids: Object.keys(entities).sort(),
    entities,
    legacyProjectMigrationComplete: true,
  };
  assertFolderState(result);
  return result;
};
