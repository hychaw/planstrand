import {
  migrateLegacyProjectFolders,
  projectFolderId,
  menuFolderId,
} from './legacy-project-folder-migration';
import { INBOX_PROJECT, DEFAULT_PROJECT } from '../project/project.const';
import { ProjectState } from '../project/project.model';
import { MenuTreeKind, MenuTreeState } from '../menu-tree/store/menu-tree.model';
import { initialFolderState, isFolderState } from './folder-state';
import { INBOX_FOLDER_ID } from './folder.const';
import {
  addFolder,
  removeFolder,
  updateFolder,
  moveFolder,
} from './store/folder.actions';
import { getFolderChildren } from './folder.util';
const projects = (): ProjectState => ({
  ids: [INBOX_PROJECT.id, 'b', 'a'],
  entities: {
    [INBOX_PROJECT.id]: INBOX_PROJECT,
    a: { ...DEFAULT_PROJECT, id: 'a', title: 'A' },
    b: { ...DEFAULT_PROJECT, id: 'b', title: 'B' },
  },
});
const empty: MenuTreeState = { projectTree: [], tagTree: [] };
const p = (id: string): { id: string; k: MenuTreeKind.PROJECT } => ({
  id,
  k: MenuTreeKind.PROJECT as const,
});
const nested: MenuTreeState = {
  ...empty,
  projectTree: [
    {
      id: 'outer',
      k: MenuTreeKind.FOLDER,
      name: 'Outer',
      children: [
        { id: 'inner', k: MenuTreeKind.FOLDER, name: 'Inner', children: [p('a')] },
        p('b'),
      ],
    },
  ],
};
describe('Project/MenuTree to Folder cutover', () => {
  it('uses deterministic separate namespaces and exact reserved Inbox mapping', () => {
    expect(projectFolderId(INBOX_PROJECT.id)).toBe(INBOX_FOLDER_ID);
    expect(projectFolderId('a')).toBe('PROJECT_FOLDER:a');
    expect(menuFolderId('a')).toBe('MENU_FOLDER:a');
    expect(projectFolderId('x:y')).not.toBe(projectFolderId('x'));
  });
  it('seeds absent/default state using explicit Project list order', () => {
    const folder = migrateLegacyProjectFolders(projects(), empty);
    expect(getFolderChildren(folder).map((f) => f.id)).toEqual([
      INBOX_FOLDER_ID,
      projectFolderId('b'),
      projectFolderId('a'),
    ]);
    expect(isFolderState(folder)).toBeTrue();
    expect(folder.legacyProjectMigrationComplete).toBeTrue();
  });
  it('keeps the reserved deterministic Inbox even if the legacy Inbox title differs', () => {
    const source = projects();
    source.entities[INBOX_PROJECT.id] = { ...INBOX_PROJECT, title: 'My Inbox' };
    const folder = migrateLegacyProjectFolders(source, empty);
    expect(folder.entities[INBOX_FOLDER_ID]?.title).toBe('Inbox');
    expect(folder.entities[INBOX_FOLDER_ID]?.parentId ?? null).toBeNull();
    source.entities[INBOX_PROJECT.id] = INBOX_PROJECT;
    expect(migrateLegacyProjectFolders(source, empty, folder)).toBe(folder);
  });
  it('preserves named MenuTree depth and sibling order', () => {
    const folder = migrateLegacyProjectFolders(projects(), nested);
    expect(folder.entities[projectFolderId('a')]?.parentId).toBe(menuFolderId('inner'));
    expect(folder.entities[menuFolderId('inner')]?.parentId).toBe(menuFolderId('outer'));
    expect(getFolderChildren(folder, menuFolderId('outer')).map((f) => f.id)).toEqual([
      menuFolderId('inner'),
      projectFolderId('b'),
    ]);
  });
  it('is byte-equivalent across independent clients and entity insertion orders', () => {
    const source = projects(),
      reordered = {
        ...source,
        entities: Object.fromEntries(Object.entries(source.entities).reverse()),
      };
    expect(JSON.stringify(migrateLegacyProjectFolders(source, nested))).toBe(
      JSON.stringify(migrateLegacyProjectFolders(reordered, structuredClone(nested))),
    );
  });
  it('ignores archived/done projects, stale references and Tags', () => {
    const source = projects();
    source.entities['a'] = { ...source.entities['a']!, isArchived: true };
    source.entities['b'] = { ...source.entities['b']!, isDone: true };
    const menu = {
      ...empty,
      projectTree: [
        p('a'),
        p('b'),
        p('missing'),
        { id: 'tag', k: MenuTreeKind.TAG as const },
      ],
    };
    expect(migrateLegacyProjectFolders(source, menu)).toBe(initialFolderState);
  });
  it('keeps hidden but active projects', () => {
    const source = projects();
    source.entities['a'] = { ...source.entities['a']!, isHiddenFromMenu: true };
    expect(
      migrateLegacyProjectFolders(source, empty).entities[projectFolderId('a')],
    ).toBeDefined();
  });
  it('falls back to root for duplicate project placement', () => {
    const menu: MenuTreeState = {
      ...empty,
      projectTree: [...nested.projectTree, p('a')],
    };
    expect(
      migrateLegacyProjectFolders(projects(), menu).entities[projectFolderId('a')]
        ?.parentId,
    ).toBeNull();
  });
  it('flattens children of duplicate legacy folder identities without placeholders', () => {
    const menu: MenuTreeState = {
      ...empty,
      projectTree: [
        { id: 'same', k: MenuTreeKind.FOLDER, name: 'First', children: [p('a')] },
        { id: 'same', k: MenuTreeKind.FOLDER, name: 'Second', children: [p('b')] },
      ],
    };
    const folder = migrateLegacyProjectFolders(projects(), menu);
    expect(folder.entities[menuFolderId('same')]).toBeUndefined();
    expect(folder.entities[projectFolderId('a')]?.parentId).toBeNull();
  });
  it('does not remirror renamed/deleted Projects or later Folder edits/moves', () => {
    let folder = migrateLegacyProjectFolders(projects(), nested);
    folder = updateFolder({
      state: folder,
      id: projectFolderId('a'),
      changes: { title: 'Edited' },
    }).folderState;
    folder = moveFolder({
      state: folder,
      id: projectFolderId('a'),
      parentId: null,
      orderKey: 'z',
    }).folderState;
    const source = projects();
    delete source.entities['a'];
    source.ids = [INBOX_PROJECT.id, 'b'];
    expect(migrateLegacyProjectFolders(source, empty, folder)).toBe(folder);
  });
  it('never recreates removed folders even when only Inbox remains', () => {
    let folder = migrateLegacyProjectFolders(projects(), empty);
    for (const id of ['a', 'b'])
      folder = removeFolder({ state: folder, id: projectFolderId(id) }).folderState;
    expect(folder.ids).toEqual([INBOX_FOLDER_ID]);
    expect(migrateLegacyProjectFolders(projects(), nested, folder)).toBe(folder);
  });
  it('keeps partial/mixed/manual canonical state unchanged except cutover evidence', () => {
    for (const id of ['manual', projectFolderId('a')]) {
      const state = addFolder({
        state: initialFolderState,
        folder: { id, title: 'Authoritative' },
      }).folderState;
      const folder = migrateLegacyProjectFolders(projects(), nested, state);
      expect(folder.ids).toEqual(state.ids);
      expect(folder.entities).toBe(state.entities);
      expect(migrateLegacyProjectFolders(projects(), nested, folder)).toBe(folder);
    }
  });
  it('rejects malformed Folder rather than reconstructing it', () => {
    expect(() =>
      migrateLegacyProjectFolders(projects(), empty, { ids: [], entities: {} }),
    ).toThrowError('Invalid Folder state');
  });
  it('handles deeply nested legacy folders iteratively', () => {
    let node: MenuTreeState['projectTree'][number] = p('a');
    for (let i = 0; i < 2000; i++)
      node = { id: String(i), k: MenuTreeKind.FOLDER, name: String(i), children: [node] };
    expect(
      isFolderState(
        migrateLegacyProjectFolders(projects(), { ...empty, projectTree: [node] }),
      ),
    ).toBeTrue();
  });
});
