import { buildReplacementOperation } from './build-replacement-operation';
import { syncOpToOperation } from './operation-sync.util';
import {
  CURRENT_SCHEMA_VERSION,
  ENTITY_TYPES,
  SUPER_SYNC_OPERATION_CAPABILITIES,
  TASK_FOLDER_OWNERSHIP_V1,
  CLIENT_SYNC_READER_CAPABILITIES,
} from '@sp/shared-schema';
import { initialFolderState } from '../../features/folder/folder-state';
import { addFolder } from '../../features/folder/store/folder.actions';
import {
  assertFullStateReaderCompatible,
  getFullStateRequiredEntityTypes,
} from './folder-full-state-gate';
import {
  getRemoteOpBlockReason,
  takeInterpretableOpPrefix,
} from './remote-op-block.util';
import { SyncCapabilityGateService } from './sync-capability-gate.service';
import { Operation, OpType, ActionType } from '../core/operation.types';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import {
  encodeOperation,
  decodeOperation,
} from '../persistence/compact/operation-codec.service';
const folder = addFolder({
  state: initialFolderState,
  folder: { id: 'user', title: 'User' },
}).folderState;
const op: Operation = {
  id: 'full',
  clientId: 'client',
  opType: OpType.SyncImport,
  actionType: ActionType.LOAD_ALL_DATA,
  entityType: 'ALL',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  payload: { folder },
  vectorClock: { client: 1 },
  timestamp: 100,
  requiredEntityTypes: ['FOLDER'],
};
describe('Semantic ownership reader requirements', () => {
  it('retains ownership semantics in a current Task replacement operation', () => {
    const replacement = buildReplacementOperation(
      'TASK',
      't',
      { id: 't', folderId: 'manual' },
      'client',
      { client: 1 },
      1,
    );
    expect(replacement.requiredCapabilities).toEqual([TASK_FOLDER_OWNERSHIP_V1]);
    expect(replacement.requiredEntityTypes).toEqual(['FOLDER']);
    expect(
      getRemoteOpBlockReason(replacement, CURRENT_SCHEMA_VERSION, ENTITY_TYPES, []),
    ).toBe('ENTITY_SUPPORT_REQUIRED');
    expect(getRemoteOpBlockReason(replacement, CURRENT_SCHEMA_VERSION)).toBeNull();
  });

  const required = [TASK_FOLDER_OWNERSHIP_V1];
  const taskOp: Operation = {
    ...op,
    entityType: 'TASK',
    opType: OpType.Update,
    actionType: ActionType.TASK_UPDATE_UI,
    payload: { task: { id: 't', changes: {} } },
    requiredCapabilities: required,
  };
  it('blocks Folder-capable pre-4E replay and the pre-processing prefix', () => {
    expect(CLIENT_SYNC_READER_CAPABILITIES).toEqual(required);
    expect(getRemoteOpBlockReason(taskOp, CURRENT_SCHEMA_VERSION, ENTITY_TYPES, [])).toBe(
      'ENTITY_SUPPORT_REQUIRED',
    );
    expect(takeInterpretableOpPrefix([taskOp, op])).toEqual([taskOp, op]);
    expect(
      getRemoteOpBlockReason(taskOp, CURRENT_SCHEMA_VERSION, ENTITY_TYPES, required),
    ).toBeNull();
    expect(
      getRemoteOpBlockReason(
        { ...taskOp, requiredCapabilities: ['FUTURE'] },
        CURRENT_SCHEMA_VERSION,
        ENTITY_TYPES,
        required,
      ),
    ).toBe('ENTITY_SUPPORT_REQUIRED');
  });
  it('preserves both requirements through JSON, compact storage and wire conversion', () => {
    expect(
      syncOpToOperation(JSON.parse(JSON.stringify(taskOp))).requiredCapabilities,
    ).toEqual(required);
    expect(decodeOperation(JSON.parse(JSON.stringify(encodeOperation(taskOp))))).toEqual(
      taskOp,
    );
  });
  it('blocks declared full-state requirements before conversion', () => {
    expect(
      getRemoteOpBlockReason(
        {
          ...op,
          payload: { appDataComplete: op.payload, requiredCapabilities: required },
        },
        CURRENT_SCHEMA_VERSION,
        ENTITY_TYPES,
        [],
      ),
    ).toBe('ENTITY_SUPPORT_REQUIRED');
    expect(() =>
      assertFullStateReaderCompatible(op.payload, ['FOLDER'], ENTITY_TYPES, required, []),
    ).toThrow();
    expect(() =>
      assertFullStateReaderCompatible(
        op.payload,
        ['FOLDER'],
        ENTITY_TYPES,
        required,
        required,
      ),
    ).not.toThrow();
  });
});
const unsupported = ENTITY_TYPES.filter((type) => type !== 'FOLDER');
describe('Folder full-state compatibility', () => {
  it('accepts current readers and blocks unsupported readers before conversion', () => {
    expect(() =>
      assertFullStateReaderCompatible(op.payload, op.requiredEntityTypes),
    ).not.toThrow();
    expect(() =>
      assertFullStateReaderCompatible(op.payload, op.requiredEntityTypes, unsupported),
    ).toThrowError(/unsupported entity/);
  });
  it('blocks unmarked Folder state after decryption too', () => {
    expect(
      getRemoteOpBlockReason(
        { ...op, requiredEntityTypes: undefined },
        CURRENT_SCHEMA_VERSION,
        unsupported,
      ),
    ).toBe('ENTITY_SUPPORT_REQUIRED');
  });
  it('blocks declared requirements while payload is still ciphertext', () => {
    expect(
      getRemoteOpBlockReason(
        { ...op, payload: 'ciphertext' },
        CURRENT_SCHEMA_VERSION,
        unsupported,
      ),
    ).toBe('ENTITY_SUPPORT_REQUIRED');
  });
  it('retains requirements through IndexedDB compact operation encoding', () => {
    expect(decodeOperation(encodeOperation(op))).toEqual(op);
  });
  it('allows default and absent Folder without requirements on unsupported readers', () => {
    for (const state of [{}, { folder: initialFolderState }]) {
      expect(getFullStateRequiredEntityTypes(state)).toEqual([]);
      expect(() => assertFullStateReaderCompatible(state, [], unsupported)).not.toThrow();
    }
  });
  it('cuts the pre-processing prefix at an incompatible full state', () => {
    const unknown = { ...op, requiredEntityTypes: ['FUTURE'] };
    expect(takeInterpretableOpPrefix([unknown, op])).toEqual([]);
    expect(getRemoteOpBlockReason(unknown, CURRENT_SCHEMA_VERSION)).toBe(
      'ENTITY_SUPPORT_REQUIRED',
    );
  });
  it('allows Folder snapshots only on an enforcing server', async () => {
    const service = new SyncCapabilityGateService();
    const provider = {
      providerMode: 'superSyncOps',
      requiresServerCapabilities: true,
      getServerSyncCapabilities: async () => ({
        kind: 'available',
        capabilities: SUPER_SYNC_OPERATION_CAPABILITIES,
      }),
    } as unknown as OperationSyncCapable;
    await expectAsync(service.assertUploadCompatible(provider, [op])).toBeResolved();
  });
});
