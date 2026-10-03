import { hasMeaningfulFolderState } from '@sp/shared-schema';
import { ProjectState } from '../project/project.model';
import { INBOX_PROJECT } from '../project/project.const';
import { MenuTreeState } from '../menu-tree/store/menu-tree.model';
import { Folder, FolderState } from './folder.model';
import { assertFolderState, folderAdapter, initialFolderState } from './folder-state';
import {
  migrateLegacyProjectFolders,
  projectFolderId,
} from './legacy-project-folder-migration';

/** Compatibility materialization, never a captured Folder intent. Existing
 * hierarchy wins; only explicit deletion evidence suppresses a missing seed.
 */
export const ensureProjectFolderAssociations = (
  project: ProjectState,
  existing: FolderState = initialFolderState,
): FolderState => {
  assertFolderState(existing);
  if (
    !existing.legacyProjectMigrationComplete &&
    !hasMeaningfulFolderState({ folder: existing })
  )
    return existing;
  const dismissed = new Set(existing.dismissedProjectFolderIds ?? []);
  const folders: Folder[] = [];
  for (const id of [...new Set(project.ids.map(String))].sort()) {
    const p = Object.hasOwn(project.entities, id) ? project.entities[id] : undefined;
    const folderId = projectFolderId(id);
    if (
      p &&
      id !== INBOX_PROJECT.id &&
      !p.isArchived &&
      !p.isDone &&
      !Object.hasOwn(existing.entities, folderId) &&
      !dismissed.has(folderId)
    ) {
      // Equal keys use compareFolders' canonical id tie-break. No dependency
      // on insertion order, Project.ids order, or unrelated manual siblings.
      folders.push({ id: folderId, title: p.title, parentId: null, orderKey: 'V' });
    }
  }
  if (!folders.length) return existing;
  const next = folderAdapter.addMany(folders, existing);
  return { ...next, ids: [...next.ids].sort() };
};

/** Authoritative startup/restore boundary: legacy cutover first, additive seeds
 * second. Activate even an empty source so its future Project creates can seed.
 */
export const materializeProjectFolders = (
  project: ProjectState,
  menuTree: MenuTreeState,
  existing: FolderState = initialFolderState,
): FolderState => {
  const migrated = migrateLegacyProjectFolders(project, menuTree, existing);
  const activated = migrated.legacyProjectMigrationComplete
    ? migrated
    : { ...migrated, legacyProjectMigrationComplete: true as const };
  return ensureProjectFolderAssociations(project, activated);
};
