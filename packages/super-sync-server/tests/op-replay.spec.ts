import {
  legacyPlanningRecord,
  PlanningRecord,
  CURRENT_SCHEMA_VERSION,
} from '@sp/shared-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resolveExpectedFirstSeq,
  assertContiguousReplayBatch,
  assertReplayStateSize,
  EncryptedOpsNotSupportedError,
  LegacyRepairReplayUnsupportedError,
  LegacyFullStateAfterCutoverError,
  MAX_REPLAY_STATE_SIZE_BYTES,
  replayOpsToState,
  type ReplayOperationRow,
} from '../src/sync/op-replay';

const row = (overrides: Partial<ReplayOperationRow>): ReplayOperationRow => ({
  id: 'op-1',
  serverSeq: 1,
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: { title: 'Initial' },
  schemaVersion: CURRENT_SCHEMA_VERSION,
  isPayloadEncrypted: false,
  ...overrides,
});

describe('op replay', () => {
  it('fails closed on a late legacy import that would resurrect an unplanned Task', () => {
    const tombstone = {
      id: 'X',
      placement: null,
      revision: { counter: 1, clientId: 'client-a', opId: 'unplan-X' },
    };
    const canonical = {
      task: { ids: ['X'], entities: { X: { id: 'X' } } },
      planning: { ids: ['X'], entities: { X: tombstone } },
    };
    const legacy = {
      task: { ids: ['X'], entities: { X: { id: 'X' } } },
      planner: { days: { '2026-10-08': ['X'] } },
    };
    for (const opType of ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR']) {
      const late = row({
        opType,
        entityType: 'ALL',
        entityId: null,
        payload: legacy,
        schemaVersion: 4,
        repairBaseServerSeq: 0,
      });
      expect(() => replayOpsToState([late], canonical)).toThrow(
        LegacyFullStateAfterCutoverError,
      );
      expect(() =>
        replayOpsToState([
          row({
            opType: 'SYNC_IMPORT',
            entityType: 'ALL',
            entityId: null,
            payload: canonical,
          }),
          { ...late, serverSeq: 2 },
        ]),
      ).toThrow(LegacyFullStateAfterCutoverError);
      expect(canonical.planning.entities.X).toEqual(tombstone);
    }
    expect(
      replayOpsToState([
        row({
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          entityId: null,
          payload: legacy,
          schemaVersion: 4,
        }),
      ]).planning,
    ).toBeDefined();
  });
  it('converges concurrent same-Task Planning operations across opposite server receipt orders', () => {
    const base = {
      task: { ids: ['X'], entities: { X: { id: 'X' } } },
      planning: { ids: [], entities: {} },
    };
    const operation = (clientId: string, timestamp: number, orderKey: string) => ({
      ...row({
        id: `planning-${clientId}`,
        opType: 'PLANNING_V1',
        entityType: 'PLANNING',
        entityId: 'X',
        payload: {
          actionPayload: {
            record: {
              id: 'X',
              placement: { target: { type: 'DAY', key: '2026-10-08' }, orderKey },
              revision: {
                counter: timestamp / 1000,
                clientId,
                opId: `planning-${clientId}`,
              },
            },
          },
          entityChanges: [],
        },
      }),
      clientId,
      clientTimestamp: BigInt(timestamp),
      vectorClock: { [clientId]: 1 },
    });
    const winner = operation('A', 2000, 'F');
    const loser = operation('B', 1000, 'T');
    const forward = replayOpsToState(
      [
        { ...winner, serverSeq: 1 },
        { ...loser, serverSeq: 2 },
      ],
      base,
    );
    const reverse = replayOpsToState(
      [
        { ...loser, serverSeq: 1 },
        { ...winner, serverSeq: 2 },
      ],
      base,
    );
    // The larger logical counter wins in both histories. Compaction must not
    // turn receipt order into a competing schema-5 ordering policy.
    expect(forward.planning).toEqual(reverse.planning);
    expect(forward.planning).toEqual({
      ids: ['X'],
      entities: {
        X: {
          id: 'X',
          placement: { target: { type: 'DAY', key: '2026-10-08' }, orderKey: 'F' },
          revision: { counter: 2, clientId: 'A', opId: 'planning-A' },
        },
      },
    });
  });
  it('folds tombstones in both orders and keeps self-contained snapshot winners', () => {
    const record: PlanningRecord = {
      id: 'X',
      placement: { target: { type: 'DAY', key: '2026-10-08' }, orderKey: 'V' },
      revision: { counter: 9, clientId: 'A', opId: 'stale' },
    };
    const winner: PlanningRecord = {
      ...record,
      placement: null,
      revision: { counter: 10, clientId: 'B', opId: 'winner' },
    };
    const operation = (record: PlanningRecord, serverSeq: number) =>
      row({
        id: record.revision.opId,
        serverSeq,
        opType: 'PLANNING_V1',
        entityType: 'PLANNING',
        entityId: 'X',
        payload: { actionPayload: { record }, entityChanges: [] },
      });
    const base = { planning: { ids: [], entities: {} } };
    expect(
      replayOpsToState([operation(record, 1), operation(winner, 2)], base).planning,
    ).toEqual(
      replayOpsToState([operation(winner, 1), operation(record, 2)], base).planning,
    );
    for (const placement of [winner.placement, record.placement]) {
      const snapshotWinner = { ...winner, placement };
      const snapshot = { planning: { ids: ['X'], entities: { X: snapshotWinner } } };
      expect(replayOpsToState([operation(record, 1)], snapshot).planning).toEqual(
        snapshot.planning,
      );
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replays schema-5 semantic placements/removal without an uppercase entity-map shadow', () => {
    const base = {
      task: { ids: ['X', 'Y'], entities: { X: { id: 'X' }, Y: { id: 'Y' } } },
      planning: { ids: [], entities: {} },
    };
    const placement: PlanningRecord = {
      id: 'X',
      placement: { target: { type: 'DAY', key: '2026-10-08' }, orderKey: 'V' },
      revision: { counter: 1, clientId: 'A', opId: 'op-1' },
    };
    const set = row({
      opType: 'PLANNING_V1',
      entityType: 'PLANNING',
      entityId: 'X',
      payload: { actionPayload: { record: placement }, entityChanges: [] },
    });
    const planned = replayOpsToState([set], base);
    expect(planned.planning).toEqual({ ids: ['X'], entities: { X: placement } });
    expect(planned.PLANNING).toBeUndefined();
    expect(
      replayOpsToState(
        [
          row({
            ...set,
            payload: {
              actionPayload: {
                record: {
                  ...placement,
                  placement: null,
                  revision: { ...placement.revision, counter: 2 },
                },
              },
              entityChanges: [],
            },
          }),
        ],
        planned,
      ).planning,
    ).toEqual({
      ids: ['X'],
      entities: {
        X: {
          ...placement,
          placement: null,
          revision: { ...placement.revision, counter: 2 },
        },
      },
    });
    const deleted = row({
      opType: 'DEL',
      entityType: 'TASK',
      entityId: 'X',
      payload: {},
    });
    for (const ops of [
      [set, deleted],
      [deleted, set],
    ]) {
      const state = replayOpsToState(ops, base);
      expect(state.planning).toEqual({ ids: ['X'], entities: { X: placement } });
      expect((state.task as typeof base.task).entities.X).toBeUndefined();
    }
    expect(base.task.entities.X).toEqual({ id: 'X' });
  });
  it('recovers date-addressable Planning from an actual normalized schema-4 full-state snapshot', () => {
    const state = replayOpsToState([
      row({
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        entityId: null,
        schemaVersion: 4,
        payload: {
          appDataComplete: {
            task: { ids: ['X'], entities: { X: { id: 'X', dueDay: '2026-10-08' } } },
            planner: { days: {} },
            tag: { entities: { TODAY: { taskIds: ['X'] } } },
          },
        },
      }),
    ]);
    expect((state.planning as { entities: Record<string, unknown> }).entities.X).toEqual(
      legacyPlanningRecord({
        id: 'X',
        target: { type: 'DAY', key: '2026-10-08' },
        orderKey: 'TV',
      }),
    );
  });
  it('returns the base state for an empty op list', () => {
    const base = { TASK: { 'task-1': { title: 'Existing' } } };

    expect(replayOpsToState([], base)).toEqual(base);
  });

  it('folds CREATE and UPDATE operations into the same entity', () => {
    const state = replayOpsToState([
      row({ id: 'op-1', serverSeq: 1, opType: 'CRT', payload: { title: 'A' } }),
      row({ id: 'op-2', serverSeq: 2, opType: 'UPD', payload: { done: true } }),
    ]);

    expect(state).toEqual({
      TASK: {
        'task-1': {
          title: 'A',
          done: true,
        },
      },
    });
  });

  it('deletes entities for DEL operations', () => {
    const state = replayOpsToState(
      [row({ id: 'op-2', serverSeq: 2, opType: 'DEL', payload: {} })],
      { TASK: { 'task-1': { title: 'A' } } },
    );

    expect(state).toEqual({ TASK: {} });
  });

  it('deletes EVERY entity of a multi-entity batch DEL, not just the scalar (#8340)', () => {
    const state = replayOpsToState(
      [
        row({
          id: 'op-2',
          serverSeq: 2,
          opType: 'DEL',
          // deleteTasks stores the full set in entityIds and the scalar = entityIds[0].
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2', 'task-3'],
          payload: {},
        }),
      ],
      {
        TASK: {
          'task-1': { title: 'A' },
          'task-2': { title: 'B' },
          'task-3': { title: 'C' },
          'task-4': { title: 'D' },
        },
      },
    );

    // Before the fix only task-1 (the scalar) was deleted; task-2/task-3 survived.
    expect(state).toEqual({ TASK: { 'task-4': { title: 'D' } } });
  });

  it('falls back to the scalar entityId when a DEL has an empty entityIds array', () => {
    const state = replayOpsToState(
      [
        row({
          id: 'op-2',
          serverSeq: 2,
          opType: 'DEL',
          entityId: 'task-1',
          entityIds: [],
          payload: {},
        }),
      ],
      { TASK: { 'task-1': { title: 'A' }, 'task-2': { title: 'B' } } },
    );

    expect(state).toEqual({ TASK: { 'task-2': { title: 'B' } } });
  });

  it('skips prototype-pollution keys inside a multi-entity DEL set', () => {
    const state = replayOpsToState(
      [
        row({
          id: 'op-2',
          serverSeq: 2,
          opType: 'DEL',
          entityId: 'task-1',
          entityIds: ['task-1', '__proto__', 'task-2'],
          payload: {},
        }),
      ],
      { TASK: { 'task-1': { title: 'A' }, 'task-2': { title: 'B' } } },
    );

    expect(state).toEqual({ TASK: {} });
  });

  it('throws when the replay state exceeds the size guard', () => {
    vi.spyOn(Buffer, 'byteLength').mockReturnValueOnce(MAX_REPLAY_STATE_SIZE_BYTES + 1);

    expect(() => assertReplayStateSize({ TASK: {} })).toThrow(
      'State too large during replay',
    );
  });

  it('rejects encrypted operations', () => {
    expect(() => replayOpsToState([row({ isPayloadEncrypted: true })])).toThrowError(
      EncryptedOpsNotSupportedError,
    );
  });

  it('rejects legacy repairs whose missing causal base makes server replay ambiguous', () => {
    expect(() =>
      replayOpsToState([
        row({
          opType: 'REPAIR',
          entityType: 'ALL',
          entityId: null,
          payload: { appDataComplete: { TASK: {} } },
          repairBaseServerSeq: null,
        }),
      ]),
    ).toThrowError(LegacyRepairReplayUnsupportedError);
  });

  it('replays a repair with an explicit causal base as a full-state operation', () => {
    const state = replayOpsToState([
      row({
        opType: 'REPAIR',
        entityType: 'ALL',
        entityId: null,
        payload: { appDataComplete: { TASK: { repaired: { done: true } } } },
        repairBaseServerSeq: 0,
      }),
    ]);

    expect(state).toEqual({ TASK: { repaired: { done: true } } });
  });

  it('rejects non-contiguous replay batches', () => {
    expect(() =>
      assertContiguousReplayBatch(
        [row({ serverSeq: 1 }), row({ id: 'op-3', serverSeq: 3 })],
        1,
        3,
      ),
    ).toThrow('Expected seq 2 but got 3');
  });

  it('allows a leading gap when the first surviving op is full-state', () => {
    expect(
      _resolveExpectedFirstSeq(
        [
          row({
            id: 'op-10',
            serverSeq: 10,
            opType: 'SYNC_IMPORT',
            entityType: 'ALL',
            entityId: null,
            payload: { appDataComplete: { TASK: {} } },
          }),
        ],
        0,
        0,
        10,
      ),
    ).toBe(10);
  });

  it('rejects a leading gap when the first surviving op is not full-state', () => {
    expect(() => _resolveExpectedFirstSeq([row({ serverSeq: 10 })], 0, 0, 10)).toThrow(
      'Expected operation serverSeq 1 but got 10',
    );
  });

  it('rejects a leading gap at a legacy repair without a causal base', () => {
    expect(() =>
      _resolveExpectedFirstSeq(
        [
          row({
            serverSeq: 10,
            opType: 'REPAIR',
            repairBaseServerSeq: null,
          }),
        ],
        0,
        0,
        10,
      ),
    ).toThrow('Expected operation serverSeq 1 but got 10');
  });
});
