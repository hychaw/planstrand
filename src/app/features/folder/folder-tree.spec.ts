import { folderTreeRows, visibleFolderRows } from './folder-tree';
import { initialFolderState } from './folder-state';
import { INBOX_FOLDER_ID } from './folder.const';
import { FolderState } from './folder.model';
import { folderForPlanstrandRoute } from './folder-route';

describe('Planstrand Folder hierarchy', () => {
  it('gives the shared add bar canonical Folder defaults only on primary routes', () => {
    expect(folderForPlanstrandRoute('/inbox')).toBe(INBOX_FOLDER_ID);
    expect(folderForPlanstrandRoute('/today?focusItem=task')).toBe(INBOX_FOLDER_ID);
    expect(folderForPlanstrandRoute('/folder/a%20b')).toBe('a b');
    expect(folderForPlanstrandRoute('/project/legacy/tasks')).toBeUndefined();
    expect(folderForPlanstrandRoute('/tag/TODAY/tasks')).toBeUndefined();
  });
  const state: FolderState = {
    ...initialFolderState,
    ids: [...initialFolderState.ids, 'a', 'b', 'empty'],
    entities: {
      ...initialFolderState.entities,
      a: { id: 'a', title: 'A', orderKey: 'z' },
      b: { id: 'b', title: 'B', parentId: 'a' },
      empty: { id: 'empty', title: 'Empty', orderKey: 'A' },
    },
  };
  it('puts Inbox first and retains empty folders in sibling order', () => {
    expect(folderTreeRows(state).map((r) => r.folder.id)).toEqual([
      INBOX_FOLDER_ID,
      'empty',
      'a',
      'b',
    ]);
  });
  it('preserves recursive depth and ancestor context', () => {
    expect(folderTreeRows(state).at(-1)).toEqual({
      folder: state.entities['b']!,
      depth: 1,
      path: 'A / B',
      hasChildren: false,
    });
  });
  it('collapses descendants locally without hiding sibling roots', () => {
    expect(
      visibleFolderRows(folderTreeRows(state), new Set(['a'])).map((r) => r.folder.id),
    ).toEqual([INBOX_FOLDER_ID, 'empty', 'a']);
  });
  it('handles a deep tree iteratively', () => {
    const deep: FolderState = { ids: [], entities: {} };
    for (let i = 0; i < 2000; i++) {
      const id = String(i);
      deep.ids.push(id);
      deep.entities[id] = { id, title: 'x', parentId: i ? String(i - 1) : null };
    }
    expect(folderTreeRows(deep).at(-1)?.depth).toBe(1999);
  });
});
