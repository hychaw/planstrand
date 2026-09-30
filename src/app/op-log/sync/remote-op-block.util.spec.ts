import { ActionType, KNOWN_ACTION_TYPES } from '../core/action-types.enum';
import { SUPER_SYNC_IMPORT_REASONS, SUPER_SYNC_OP_TYPES } from '@sp/shared-schema';
import { OpType } from '../core/operation.types';
import {
  getRemoteOpBlockReason,
  getUnknownOpVocabulary,
  takeInterpretableOpPrefix,
} from './remote-op-block.util';

describe('getUnknownOpVocabulary', () => {
  it('accepts every op type and import reason of the wire vocabulary', () => {
    for (const opType of SUPER_SYNC_OP_TYPES) {
      expect(
        getUnknownOpVocabulary({
          actionType: ActionType.TASK_SHARED_UPDATE,
          opType: opType as OpType,
        }),
      ).toBeNull();
    }
    for (const reason of SUPER_SYNC_IMPORT_REASONS) {
      expect(
        getUnknownOpVocabulary({
          actionType: ActionType.TASK_SHARED_UPDATE,
          opType: OpType.SyncImport,
          syncImportReason: reason,
        }),
      ).toBeNull();
    }
  });

  it('names an opType this client does not know', () => {
    expect(
      getUnknownOpVocabulary({
        actionType: ActionType.TASK_SHARED_UPDATE,
        opType: 'FUTURE_OP' as unknown as OpType,
      }),
    ).toBe('opType');
  });

  it('names a syncImportReason this client does not know', () => {
    expect(
      getUnknownOpVocabulary({
        actionType: ActionType.TASK_SHARED_UPDATE,
        opType: OpType.SyncImport,
        syncImportReason: 'FUTURE_REASON' as never,
      }),
    ).toBe('syncImportReason');
  });

  it('cuts a batch at the first op that would block on schema version', () => {
    const ops = [
      {
        id: 'a',
        actionType: ActionType.TASK_SHARED_UPDATE,
        opType: OpType.Update,
        schemaVersion: 1,
      },
      {
        id: 'b',
        actionType: ActionType.TASK_SHARED_UPDATE,
        opType: OpType.SyncImport,
        schemaVersion: 99,
      },
      {
        id: 'c',
        actionType: ActionType.TASK_SHARED_UPDATE,
        opType: OpType.Update,
        schemaVersion: 1,
      },
    ];

    expect(takeInterpretableOpPrefix(ops).map((op) => op.id)).toEqual(['a']);
    expect(takeInterpretableOpPrefix(ops, 99).map((op) => op.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('cuts a batch at the first op with unknown vocabulary', () => {
    const ops = [
      { id: 'a', actionType: ActionType.TASK_SHARED_UPDATE, opType: OpType.Update },
      {
        id: 'b',
        actionType: ActionType.TASK_SHARED_UPDATE,
        opType: 'FUTURE_OP' as unknown as OpType,
      },
      { id: 'c', actionType: ActionType.TASK_SHARED_UPDATE, opType: OpType.SyncImport },
    ];

    expect(takeInterpretableOpPrefix(ops).map((op) => op.id)).toEqual(['a']);
    expect(takeInterpretableOpPrefix(ops.slice(0, 1)).map((op) => op.id)).toEqual(['a']);
    expect(takeInterpretableOpPrefix([])).toEqual([]);
  });

  it('accepts an absent optional import reason', () => {
    expect(
      getUnknownOpVocabulary({
        opType: OpType.Update,
        actionType: ActionType.TASK_SHARED_UPDATE,
        syncImportReason: undefined,
      }),
    ).toBeNull();
  });
});

describe('getRemoteOpBlockReason', () => {
  const current = 4;

  it('returns null for an op this client can process', () => {
    expect(
      getRemoteOpBlockReason(
        {
          actionType: ActionType.TASK_SHARED_UPDATE,
          opType: OpType.Update,
          schemaVersion: 4,
        },
        current,
      ),
    ).toBeNull();
    expect(
      getRemoteOpBlockReason(
        { actionType: ActionType.TASK_SHARED_UPDATE, opType: OpType.Update },
        current,
      ),
    ).toBeNull();
  });

  it('reports schema-version blocks before vocabulary blocks, in loop order', () => {
    expect(
      getRemoteOpBlockReason(
        {
          actionType: ActionType.TASK_SHARED_UPDATE,
          opType: OpType.Update,
          schemaVersion: '4',
        },
        current,
      ),
    ).toBe('INVALID_SCHEMA_VERSION');
    expect(
      getRemoteOpBlockReason(
        {
          actionType: ActionType.TASK_SHARED_UPDATE,
          opType: OpType.Update,
          schemaVersion: 0,
        },
        current,
      ),
    ).toBe('VERSION_UNSUPPORTED');
    expect(
      getRemoteOpBlockReason(
        {
          actionType: ActionType.TASK_SHARED_UPDATE,
          opType: OpType.Update,
          schemaVersion: 5,
        },
        current,
      ),
    ).toBe('VERSION_TOO_NEW');
    expect(
      getRemoteOpBlockReason(
        {
          actionType: ActionType.TASK_SHARED_UPDATE,
          opType: 'FUTURE_OP' as unknown as OpType,
          schemaVersion: 5,
        },
        current,
      ),
    ).toBe('VERSION_TOO_NEW');
    expect(
      getRemoteOpBlockReason(
        {
          actionType: ActionType.TASK_SHARED_UPDATE,
          opType: 'FUTURE_OP' as unknown as OpType,
          schemaVersion: 4,
        },
        current,
      ),
    ).toBe('UNKNOWN_OP_VOCABULARY');
  });
});

describe('action vocabulary', () => {
  it('accepts every authoritative action string', () => {
    for (const actionType of KNOWN_ACTION_TYPES) {
      expect(getUnknownOpVocabulary({ opType: OpType.Update, actionType })).toBeNull();
    }
  });
  it('blocks an unknown action and its suffix under a known op type', () => {
    const prefix = { opType: OpType.Update, actionType: ActionType.TASK_SHARED_ADD };
    const unknown = { opType: OpType.Update, actionType: '[Future] Semantics' };
    expect(getUnknownOpVocabulary(unknown)).toBe('actionType');
    expect(getRemoteOpBlockReason(unknown, 4)).toBe('UNKNOWN_OP_VOCABULARY');
    expect(takeInterpretableOpPrefix([prefix, unknown, prefix])).toEqual([prefix]);
  });
});

describe('untrusted vocabulary metadata', () => {
  it('does not trust typed action metadata at runtime', () => {
    for (const actionType of [null, 42, {}, ['UPD']]) {
      expect(getUnknownOpVocabulary({ opType: OpType.Update, actionType })).toBe(
        'actionType',
      );
    }
  });
});

describe('required versus optional vocabulary', () => {
  const known = { opType: OpType.Update, actionType: ActionType.TASK_SHARED_UPDATE };
  for (const field of ['opType', 'actionType'] as const) {
    for (const value of [undefined, null, '', 42, {}, 'FUTURE_VOCABULARY']) {
      it(`rejects required ${field}=${String(value)}`, () => {
        const op = { ...known, [field]: value };
        expect(getUnknownOpVocabulary(op)).toBe(field);
        expect(getRemoteOpBlockReason(op, 4)).toBe('UNKNOWN_OP_VOCABULARY');
      });
    }
    it(`rejects missing ${field} and stops the interpretable prefix`, () => {
      const missing: { opType?: unknown; actionType?: unknown } = { ...known };
      delete missing[field];
      expect(getUnknownOpVocabulary(missing)).toBe(field);
      expect(takeInterpretableOpPrefix([known, missing, known])).toEqual([known]);
    });
  }
  it('accepts known required vocabulary and absent/known optional reasons', () => {
    expect(getUnknownOpVocabulary(known)).toBeNull();
    expect(getUnknownOpVocabulary({ ...known, syncImportReason: undefined })).toBeNull();
    for (const syncImportReason of SUPER_SYNC_IMPORT_REASONS) {
      expect(getUnknownOpVocabulary({ ...known, syncImportReason })).toBeNull();
    }
  });
  for (const syncImportReason of [null, '', 42, {}, 'FUTURE_REASON']) {
    it(`rejects present optional reason=${String(syncImportReason)}`, () => {
      expect(getUnknownOpVocabulary({ ...known, syncImportReason })).toBe(
        'syncImportReason',
      );
    });
  }
  it('checks operation type before action type before import reason', () => {
    expect(getUnknownOpVocabulary({ syncImportReason: null })).toBe('opType');
    expect(
      getUnknownOpVocabulary({ opType: OpType.Update, syncImportReason: null }),
    ).toBe('actionType');
  });
});
