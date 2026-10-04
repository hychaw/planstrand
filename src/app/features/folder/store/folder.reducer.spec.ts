import { Folder, FolderState } from '../folder.model';
import { INBOX_FOLDER, INBOX_FOLDER_ID, isInboxFolder } from '../folder.const';
import {
  getFolderChildren,
  getFolderDescendantIds,
  isValidFolderParent,
  folderOrderBetween,
} from '../folder.util';
import { isFolderState } from '../folder-state';
import { folderReducer, initialFolderState } from './folder.reducer';
import { addFolder, updateFolder, moveFolder, removeFolder } from './folder.actions';
import {
  selectAllFolders,
  selectRootFolders,
  selectFolderChildren,
  selectFolderDescendantIds,
  selectInboxFolder,
} from './folder.selectors';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { isPersistentAction } from '../../../op-log/core/persistent-action.interface';

const add = (
  state: FolderState,
  id: string,
  parentId: string | null = null,
): FolderState =>
  folderReducer(state, addFolder({ state, folder: { id, title: id, parentId } }));
const ids = (state: FolderState, parentId: string | null): string[] =>
  getFolderChildren(state, parentId).map((folder) => folder.id);
const move = (
  state: FolderState,
  id: string,
  parentId: string | null,
  orderKey = 'V',
): FolderState => folderReducer(state, moveFolder({ state, id, parentId, orderKey }));

describe('Folder domain foundation', () => {
  it('bootstraps exactly one reserved root Inbox without an action', () => {
    expect(folderReducer(undefined, { type: 'init' })).toBe(initialFolderState);
    expect(initialFolderState.ids).toEqual([INBOX_FOLDER_ID]);
    expect(selectInboxFolder.projector(initialFolderState)).toEqual(INBOX_FOLDER);
    expect(selectRootFolders.projector(initialFolderState)).toEqual([INBOX_FOLDER]);
  });
  it('defaults absent parent and order deterministically', () => {
    const state = folderReducer(
      initialFolderState,
      addFolder({ state: initialFolderState, folder: { id: 'a', title: 'A' } }),
    );
    expect(state.entities['a']).toEqual({
      id: 'a',
      title: 'A',
      parentId: null,
      orderKey: 'V',
    });
  });
  it('rejects duplicate and unsafe identities without capturing a write', () => {
    const state = add(initialFolderState, 'a');
    for (const id of ['a', '', '   ', '__proto__', 'constructor']) {
      const action = addFolder({ state, folder: { id, title: 'Duplicate' } });
      expect(folderReducer(state, action)).toBe(state);
      expect(isPersistentAction(action)).toBeFalse();
    }
  });
  it('keeps current state when a stale no-op action arrives', () => {
    const stale = addFolder({ state: initialFolderState, folder: INBOX_FOLDER });
    const current = add(initialFolderState, 'a');
    expect(folderReducer(current, stale)).toBe(current);
    expect(
      isPersistentAction(
        updateFolder({ state: current, id: 'a', changes: { title: 'a' } }),
      ),
    ).toBeFalse();
  });
  it('renames without changing ancestry or order', () => {
    const state = add(add(initialFolderState, 'a'), 'b', 'a');
    const next = folderReducer(
      state,
      updateFolder({ state, id: 'b', changes: { title: 'Renamed' } }),
    );
    expect(next.entities['b']).toEqual({
      id: 'b',
      title: 'Renamed',
      parentId: 'a',
      orderKey: 'V',
    });
    expect(next.ids).toEqual(state.ids);
    expect(state.entities['b']!.title).toBe('b');
  });
  it('ignores identity/ancestry hidden in an update payload', () => {
    const state = add(initialFolderState, 'a');
    const changes = { title: 'Renamed', id: INBOX_FOLDER_ID, parentId: 'a' };
    const next = folderReducer(state, updateFolder({ state, id: 'a', changes }));
    expect(next.entities['a']).toEqual({
      id: 'a',
      title: 'Renamed',
      parentId: null,
      orderKey: 'V',
    });
    expect(next.entities[INBOX_FOLDER_ID]).toEqual(INBOX_FOLDER);
  });
  it('derives deep children and descendants in sibling order', () => {
    let state = add(initialFolderState, 'a');
    state = add(add(add(state, 'b', 'a'), 'c', 'a'), 'd', 'b');
    expect(
      selectFolderChildren('a')
        .projector(state)
        .map((f) => f.id),
    ).toEqual(['b', 'c']);
    expect(selectFolderDescendantIds('a').projector(state)).toEqual(['b', 'd', 'c']);
    expect(selectAllFolders.projector(state).map((f) => f.id)).toEqual(state.ids);
  });
  it('supports deep nesting and rejects moves below descendants', () => {
    let state = initialFolderState;
    for (let i = 0; i < 200; i++) state = add(state, 'f' + i, i ? 'f' + (i - 1) : null);
    expect(getFolderDescendantIds(state, 'f0').length).toBe(199);
    expect(move(state, 'f0', 'f199')).toBe(state);
  });
  it('validates and traverses arbitrary practical depth iteratively', () => {
    const entities: Record<string, Folder> = { [INBOX_FOLDER_ID]: INBOX_FOLDER };
    for (let i = 0; i < 15000; i++)
      entities['f' + i] = {
        id: 'f' + i,
        title: 'f' + i,
        parentId: i ? 'f' + (i - 1) : null,
      };
    const state: FolderState = { ids: Object.keys(entities).sort(), entities };
    expect(isFolderState(state)).toBeTrue();
    expect(getFolderDescendantIds(state, 'f0').length).toBe(14999);
    expect(isValidFolderParent(state, 'new', 'f14999')).toBeTrue();
    expect(isValidFolderParent(state, 'f0', 'f14999')).toBeFalse();
  });
  it('reorders one sibling without writing identity enumeration', () => {
    const state = add(add(add(initialFolderState, 'a'), 'b', 'a'), 'c', 'a');
    const next = move(state, 'c', 'a', 'F');
    expect(ids(next, 'a')).toEqual(['c', 'b']);
    expect(next.ids).toEqual(state.ids);
    expect(next.entities['b']).toBe(state.entities['b']);
    expect(move(next, 'c', 'a', 'F')).toBe(next);
  });
  it('orders roots by absolute key with a lexical ID tie-break', () => {
    const state = add(add(initialFolderState, 'b'), 'a');
    expect(ids(state, null)).toEqual([INBOX_FOLDER_ID, 'a', 'b']);
    expect(ids(move(state, 'b', null, 'F'), null)).toEqual(['b', INBOX_FOLDER_ID, 'a']);
  });
  it('moves parent and order atomically while descendants retain their references', () => {
    let state = add(add(initialFolderState, 'a'), 'x');
    state = add(add(add(add(state, 'b', 'a'), 'c', 'a'), 'd', 'b'), 'y', 'x');
    const next = move(state, 'b', 'x', 'z');
    expect(ids(next, 'a')).toEqual(['c']);
    expect(ids(next, 'x')).toEqual(['y', 'b']);
    expect(getFolderDescendantIds(next, 'x')).toEqual(['y', 'b', 'd']);
    expect(next.entities['d']).toBe(state.entities['d']);
    expect(ids(move(next, 'b', null, 'z'), null)).toEqual([
      INBOX_FOLDER_ID,
      'a',
      'x',
      'b',
    ]);
  });
  it('rejects self-parent on create and move', () => {
    expect(add(initialFolderState, 'a', 'a')).toBe(initialFolderState);
    const state = add(initialFolderState, 'a');
    expect(move(state, 'a', 'a')).toBe(state);
  });
  it('rejects descendant cycles', () => {
    const state = add(add(add(initialFolderState, 'a'), 'b', 'a'), 'c', 'b');
    expect(move(state, 'a', 'c')).toBe(state);
  });
  it('rejects absent parents without inventing roots', () => {
    const state = add(initialFolderState, 'a');
    expect(add(state, 'b', 'missing')).toBe(state);
    expect(move(state, 'a', 'missing')).toBe(state);
    expect(move(state, 'missing', 'a')).toBe(state);
  });
  it('rejects inherited dictionary properties as parents', () => {
    const state = add(initialFolderState, 'a');
    for (const id of ['constructor', '__proto__', 'toString'])
      expect(move(state, 'a', id)).toBe(state);
  });
  it('rejects malformed order keys instead of deriving an order on replay', () => {
    const state = add(initialFolderState, 'a');
    for (const orderKey of ['', '0', 'V0', 'with space'])
      expect(move(state, 'a', null, orderKey)).toBe(state);
  });
  it('removes a leaf and preserves unrelated branches', () => {
    const state = add(add(add(initialFolderState, 'a'), 'b', 'a'), 'x');
    const next = folderReducer(state, removeFolder({ state, id: 'b' }));
    expect(next.ids).toEqual([INBOX_FOLDER_ID, 'a', 'x']);
    expect(next.entities['a']).toBe(state.entities['a']);
  });
  it('rejects non-leaf removal and missing updates', () => {
    const state = add(add(initialFolderState, 'a'), 'b', 'a');
    expect(folderReducer(state, removeFolder({ state, id: 'a' }))).toBe(state);
    expect(
      folderReducer(
        state,
        updateFolder({ state, id: 'missing', changes: { title: 'Missing' } }),
      ),
    ).toBe(state);
  });
  it('protects Inbox against duplicate, rename, reparent and deletion intents', () => {
    const state = add(initialFolderState, 'a');
    const actions = [
      addFolder({ state, folder: { id: INBOX_FOLDER_ID, title: 'Fake', parentId: 'a' } }),
      updateFolder({ state, id: INBOX_FOLDER_ID, changes: { title: 'Fake' } }),
      moveFolder({ state, id: INBOX_FOLDER_ID, parentId: 'a', orderKey: 'z' }),
      removeFolder({ state, id: INBOX_FOLDER_ID }),
    ];
    for (const action of actions) {
      expect(folderReducer(state, action)).toBe(state);
      expect(isPersistentAction(action)).toBeFalse();
    }
    expect(isInboxFolder({ id: 'ordinary', title: 'Inbox' })).toBeFalse();
    expect(ids(add(state, 'captured', INBOX_FOLDER_ID), INBOX_FOLDER_ID)).toEqual([
      'captured',
    ]);
  });
  it('captures valid intents once and defaults old imports without migrating Projects', () => {
    const action = addFolder({
      state: initialFolderState,
      folder: { id: 'a', title: 'A' },
    });
    expect(isPersistentAction(action)).toBeTrue();
    expect(action.meta.entityId).toBe('*');
    expect(
      folderReducer(
        action.folderState,
        loadAllData({ appDataComplete: {} as AppDataComplete }),
      ),
    ).toBe(initialFolderState);
  });
  it('reuses dense keys even after repeatedly inserting into one gap', () => {
    let upper = 'V';
    for (let i = 0; i < 300; i++) {
      const next = folderOrderBetween(null, upper);
      expect(next < upper).toBeTrue();
      upper = next;
    }
  });
});
