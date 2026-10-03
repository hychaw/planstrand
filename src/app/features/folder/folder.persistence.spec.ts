import { TestBed } from '@angular/core/testing';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { FolderState } from './folder.model';
import { INBOX_FOLDER_ID } from './folder.const';
import { initialFolderState, isFolderState } from './folder-state';
import { folderReducer } from './store/folder.reducer';
import { addFolder, moveFolder } from './store/folder.actions';
import { Operation, ActionType, OpType } from '../../op-log/core/operation.types';
import {
  encodeOperation,
  decodeOperation,
} from '../../op-log/persistence/compact/operation-codec.service';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { toLwwUpdateActionType } from '../../op-log/core/lww-update-action-types';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { AppDataComplete, withDefaultModelSlices } from '../../op-log/model/model-config';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';
import {
  validateFull,
  validateAppDataProperty,
} from '../../op-log/validation/validation-fn';
import { dataRepair } from '../../op-log/validation/data-repair';
import { EncryptAndCompressHandlerService } from '../../op-log/encryption/encrypt-and-compress-handler.service';
import { assertDecryptedOpMetadataIntegrity } from '../../op-log/sync/verify-decrypted-op-integrity';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { extractEntityKeysFromState } from '../../op-log/persistence/extract-entity-keys';
import { assertFolderSuperSyncSnapshotCompatible } from '../../op-log/sync/folder-full-state-gate';

const seeded = (): FolderState =>
  addFolder({ state: initialFolderState, folder: { id: 'a', title: 'A', orderKey: 'F' } })
    .folderState;
const operation = (folder: FolderState): Operation => ({
  id: 'folder-op',
  actionType: ActionType.FOLDER_ADD,
  opType: OpType.Update,
  entityType: 'FOLDER',
  entityId: '*',
  payload: { actionPayload: { folderState: folder }, entityChanges: [] },
  clientId: 'folder-client',
  vectorClock: { ['folder-client']: 1 },
  timestamp: 100,
  schemaVersion: CURRENT_SCHEMA_VERSION,
});

describe('Folder persisted state and replay', () => {
  it('accepts current snapshots and defaults absent slices without Project migration', () => {
    const current = { ...createValidAppData(), folder: seeded() };
    expect(validateFull(current).isValid).toBeTrue();
    expect(folderReducer(undefined, loadAllData({ appDataComplete: current }))).toBe(
      current.folder,
    );
    const legacy: AppDataComplete = { ...current };
    delete legacy.folder;
    expect(validateFull(legacy).isValid).toBeTrue();
    expect(withDefaultModelSlices(legacy).folder).toEqual(initialFolderState);
    expect(folderReducer(current.folder, loadAllData({ appDataComplete: legacy }))).toBe(
      initialFolderState,
    );
    expect(withDefaultModelSlices(legacy).project).toEqual(legacy.project);
  });
  it('defaults only absent data; present malformed slices reach validation unchanged', () => {
    for (const folder of [null, undefined, [], {}]) {
      const data = { ...createValidAppData(), folder } as unknown as AppDataComplete;
      expect(withDefaultModelSlices(data).folder as unknown).toBe(folder);
      expect(validateFull(data).isValid).toBeFalse();
      expect(() =>
        folderReducer(seeded(), loadAllData({ appDataComplete: data })),
      ).toThrowError('Invalid Folder state');
    }
  });
  const malformed = (kind: string): FolderState => {
    const state = structuredClone(seeded()),
      a = state.entities['a']!;
    if (kind === 'duplicate') state.ids.push('a');
    if (kind === 'missing parent') state.entities['a'] = { ...a, parentId: 'missing' };
    if (kind === 'self parent') state.entities['a'] = { ...a, parentId: 'a' };
    if (kind === 'cycle') {
      state.entities['b'] = { id: 'b', title: 'B', parentId: 'a' };
      state.entities['a'] = { ...a, parentId: 'b' };
      state.ids.push('b');
      state.ids.sort();
    }
    if (kind === 'extra field') state.entities['a'] = { ...a, childIds: [] } as typeof a;
    if (kind === 'bad order') state.entities['a'] = { ...a, orderKey: 'V0' };
    if (kind === 'noncanonical ids') state.ids.reverse();
    if (kind === 'Inbox rename')
      state.entities[INBOX_FOLDER_ID] = {
        ...state.entities[INBOX_FOLDER_ID]!,
        title: 'Fake',
      };
    if (kind === 'Inbox reparent')
      state.entities[INBOX_FOLDER_ID] = {
        ...state.entities[INBOX_FOLDER_ID]!,
        parentId: 'a',
      };
    if (kind === 'Inbox delete') {
      delete state.entities[INBOX_FOLDER_ID];
      state.ids = ['a'];
    }
    return state;
  };
  for (const kind of [
    'duplicate',
    'missing parent',
    'self parent',
    'cycle',
    'extra field',
    'bad order',
    'noncanonical ids',
    'Inbox rename',
    'Inbox reparent',
    'Inbox delete',
  ]) {
    it(`rejects ${kind} in validation, remote replay, LWW recovery, hydration and repair`, () => {
      const folder = malformed(kind),
        data = { ...createValidAppData(), folder };
      expect(isFolderState(folder)).toBeFalse();
      expect(validateFull(data).isValid).toBeFalse();
      expect(validateAppDataProperty('folder', folder).success).toBeFalse();
      expect(() =>
        folderReducer(seeded(), convertOpToAction(operation(folder))),
      ).toThrowError('Invalid Folder state');
      expect(() =>
        folderReducer(seeded(), loadAllData({ appDataComplete: data })),
      ).toThrowError('Invalid Folder state');
      expect(() => dataRepair(data)).toThrowError('Invalid Folder state');
      const reducer = lwwUpdateMetaReducer((state = { folder: seeded() }) => state);
      expect(() =>
        reducer(
          { folder: seeded() },
          { ...folder, type: toLwwUpdateActionType('FOLDER') },
        ),
      ).toThrowError('Invalid Folder state');
    });
  }
  it('preserves valid data in repair and supplies only the canonical default for legacy data', () => {
    const data = { ...createValidAppData(), folder: seeded() };
    expect(dataRepair(data).data.folder).toEqual(data.folder);
    const legacy: AppDataComplete = { ...data };
    delete legacy.folder;
    expect(dataRepair(legacy).data.folder).toEqual(initialFolderState);
  });
  it('survives JSON, compact encoding, encryption/decryption and remote conversion', async () => {
    const op = operation(seeded()),
      codec = new EncryptAndCompressHandlerService();
    const cfg = { isCompress: true, isEncrypt: true };
    const json = JSON.parse(
      JSON.stringify(decodeOperation(encodeOperation(op))),
    ) as Operation;
    const wire = await codec.compressAndEncryptData(
      cfg,
      'folder-test-password',
      json,
      CURRENT_SCHEMA_VERSION,
    );
    const decoded = await codec.decompressAndDecryptData<Operation>(
      cfg,
      'folder-test-password',
      wire,
    );
    assertDecryptedOpMetadataIntegrity(decoded, decoded.payload);
    const action = convertOpToAction(decoded);
    expect(action.meta.isRemote).toBeTrue();
    expect(folderReducer(initialFolderState, action)).toEqual(seeded());
  });
  it('gates nondefault SuperSync snapshots and allows default and legacy data', () => {
    expect(() => assertFolderSuperSyncSnapshotCompatible({})).not.toThrow();
    expect(() =>
      assertFolderSuperSyncSnapshotCompatible({ folder: initialFolderState }),
    ).not.toThrow();
    expect(() =>
      assertFolderSuperSyncSnapshotCompatible({ folder: seeded() }),
    ).toThrowError(/Folder-bearing SuperSync snapshots/);
  });
});

describe('Folder IndexedDB cache and operation tail', () => {
  let db: OperationLogStoreService;
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: {
            loadClientId: async () => 'folder-client',
            getOrGenerateClientId: async () => 'folder-client',
            clearCache: () => {},
          },
        },
      ],
    });
    db = TestBed.inject(OperationLogStoreService);
    await db.init();
    await db._clearAllDataForTesting();
  });
  it('restores a snapshot plus tail using a fresh persistence service', async () => {
    const data = { ...createValidAppData(), folder: seeded() };
    const moved = moveFolder({
      state: data.folder,
      id: 'a',
      parentId: INBOX_FOLDER_ID,
      orderKey: 'z',
    }).folderState;
    const seq = await db.append(operation(moved), 'local');
    await db.saveStateCache({
      state: data,
      lastAppliedOpSeq: 0,
      vectorClock: {},
      compactedAt: 100,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      snapshotEntityKeys: extractEntityKeysFromState(data),
    });
    const fresh = TestBed.runInInjectionContext(() => new OperationLogStoreService());
    const cache = await fresh.loadStateCache();
    expect(cache?.snapshotEntityKeys).toContain('FOLDER:*');
    let loaded = folderReducer(
      undefined,
      loadAllData({ appDataComplete: cache!.state as AppDataComplete }),
    );
    const tail = await fresh.getOpsAfterSeq(cache!.lastAppliedOpSeq);
    expect(tail.length).toBe(1);
    expect(tail[0].seq).toBe(seq);
    for (const entry of tail) loaded = folderReducer(loaded, convertOpToAction(entry.op));
    expect(loaded).toEqual(moved);
  });
});
