import { describe, it, expect } from 'vitest';
import {
  comparePlacements,
  comparePlanningRevision,
  mergePlanningRecord,
  mergePlanningState,
  isPlanningRecord,
  legacyPlanningRecord,
  planningPlacementView,
  PlanningRecord,
  isPlanningOrderKey,
  isPlanningState,
  planningOrderBetween,
  projectLegacyPlanning,
  LegacyPlanningEvidence,
} from '../src/planning';
import { PlanningMigration_v4v5 } from '../src/migrations/planning-v4-to-v5';

describe('dense Planning order keys', () => {
  it('supports thousands of prepend, append and gap insertions without numeric precision', () => {
    let first = planningOrderBetween(null, null),
      last = first,
      upper = last;
    for (let i = 0; i < 3000; i++) {
      const prepend = planningOrderBetween(null, first),
        append = planningOrderBetween(last, null);
      expect(prepend < first).toBe(true);
      expect(append > last).toBe(true);
      expect(isPlanningOrderKey(prepend)).toBe(true);
      expect(isPlanningOrderKey(append)).toBe(true);
      first = prepend;
      last = append;
      const gap = planningOrderBetween(first, upper);
      expect(first < gap && gap < upper).toBe(true);
      upper = gap;
    }
    expect(JSON.parse(JSON.stringify(first))).toBe(first);
  });
  it('uses lexical Task IDs for equal concurrent gap keys', () => {
    const target = { type: 'DAY' as const, key: '2026-10-08' };
    const key = planningOrderBetween('F', 'T');
    expect(planningOrderBetween('F', 'T')).toBe(key);
    const placements = ['z', 'b', 'a'].map((id) => ({ id, target, orderKey: key }));
    expect(placements.sort(comparePlacements).map((p) => p.id)).toEqual(['a', 'b', 'z']);
  });
  it('rejects malformed keys and unordered bounds', () => {
    for (const key of ['', 'A0', '!', 'a.b']) expect(isPlanningOrderKey(key)).toBe(false);
    expect(() => planningOrderBetween('T', 'F')).toThrow();
  });
});

describe('schema-4 Planning projection', () => {
  const D = '2026-10-08';
  const evidence = (
    dueDay?: unknown,
    today = false,
    planner = false,
  ): LegacyPlanningEvidence => ({
    task: { ids: ['X'], entities: { X: { id: 'X', dueDay } } },
    planner: { days: planner ? { [D]: ['X'] } : {} },
    tag: { entities: { TODAY: { taskIds: today ? ['X'] : [] } } },
  });
  for (const [name, dueDay, today, planner, expected] of [
    ['Planner only', undefined, false, true, D],
    ['dueDay only', D, false, false, D],
    ['Today only', undefined, true, false, undefined],
    ['Today plus dueDay', D, true, false, D],
    ['Today plus timed only', undefined, true, false, undefined],
    ['timed only', undefined, false, false, undefined],
    ['Planner plus Today', undefined, true, true, D],
    ['Planner disagrees with dueDay', '2026-10-09', false, true, D],
    ['Planner plus Today plus dueDay', '2026-10-09', true, true, D],
  ] as const)
    it(name, () => {
      const result = projectLegacyPlanning(evidence(dueDay, today, planner));
      expect(result.state.entities['X']?.placement?.target.key).toBe(expected);
      expect(result.state.ids.length).toBe(expected ? 1 : 0);
    });
  it('preserves explicit list order, then Today order, then lexical fallback', () => {
    const legacy: LegacyPlanningEvidence = {
      task: {
        ids: ['z', 'b', 'a', 'p', 't'],
        entities: Object.fromEntries(
          ['z', 'b', 'a', 'p', 't'].map((id) => [id, { id, dueDay: D }]),
        ),
      },
      planner: { days: { [D]: ['p'] } },
      tag: { entities: { TODAY: { taskIds: ['t'] } } },
    };
    expect(
      Object.values(projectLegacyPlanning(legacy).state.entities)
        .map(planningPlacementView)
        .filter((p) => !!p)
        .sort(comparePlacements)
        .map((p) => p.id),
    ).toEqual(['p', 't', 'a', 'b', 'z']);
    const reordered = {
      ...legacy,
      task: {
        ...legacy.task,
        ids: [...legacy.task.ids].reverse(),
        entities: Object.fromEntries(Object.entries(legacy.task.entities).reverse()),
      },
    };
    expect(projectLegacyPlanning(reordered).state).toEqual(
      projectLegacyPlanning(legacy).state,
    );
  });
  it('resolves duplicate days by earliest valid date and records aggregate counts', () => {
    const legacy = evidence(D, true, true);
    legacy.planner!.days = { [D]: ['X', 'deleted'], '2026-10-07': ['X'], invalid: ['X'] };
    legacy.tag!.entities!.TODAY!.taskIds = ['ambiguous', 'X'];
    const result = projectLegacyPlanning(legacy);
    expect(result.state.entities['X']?.placement?.target.key).toBe('2026-10-07');
    expect(result.diagnostics).toEqual({
      ambiguousToday: 0,
      invalidReferences: 2,
      duplicateMemberships: 1,
    });
  });
  it('documents lost manual order after compaction without losing membership/date', () => {
    const before = evidence(D, true),
      compacted = evidence(D, false);
    const old = projectLegacyPlanning(before).state,
      migrated = projectLegacyPlanning(compacted).state;
    expect(old.entities['X']?.placement?.target).toEqual(
      migrated.entities['X']?.placement?.target,
    );
    expect(old.ids).toEqual(migrated.ids);
    expect(migrated.entities['X']?.placement?.orderKey).toBe('dV');
    expect(projectLegacyPlanning(compacted).state).toEqual(migrated);
  });
  it('preserves existing canonical state on relabel/repeated migration and fails closed', () => {
    const legacy = evidence(D, true);
    const once = PlanningMigration_v4v5.migrateState(legacy);
    expect(PlanningMigration_v4v5.migrateState(once)).toBe(once);
    const removed = { ...legacy, planning: { ids: [], entities: {} } };
    expect(PlanningMigration_v4v5.migrateState(removed)).toBe(removed);
    expect(() =>
      PlanningMigration_v4v5.migrateState({ ...legacy, planning: null }),
    ).toThrow();
    expect(
      isPlanningState({
        ids: ['X'],
        entities: {
          X: { id: 'X', target: { type: 'DAY', key: '2026-02-30' }, orderKey: 'V' },
        },
      }),
    ).toBe(false);
  });
});
describe('Planning deterministic register', () => {
  const record = (
    counter: number,
    clientId = 'A',
    opId = 'a',
    placement: PlanningRecord['placement'] = {
      target: { type: 'DAY', key: '2026-10-05' },
      orderKey: 'F',
    },
  ): PlanningRecord => ({ id: 'X', placement, revision: { counter, clientId, opId } });
  it('compares counter, clientId and opId in that order', () => {
    expect(
      comparePlanningRevision(record(2).revision, record(1, 'Z').revision),
    ).toBeGreaterThan(0);
    expect(
      comparePlanningRevision(record(2, 'B').revision, record(2, 'A', 'z').revision),
    ).toBeGreaterThan(0);
    expect(
      comparePlanningRevision(record(2, 'A', 'b').revision, record(2).revision),
    ).toBeGreaterThan(0);
  });
  it('rejects malformed counters without coercion', () => {
    for (const counter of [
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      '1',
      null,
    ])
      expect(
        isPlanningRecord({ ...record(1), revision: { ...record(1).revision, counter } }),
      ).toBe(false);
    expect(isPlanningRecord(record(0))).toBe(true);
    expect(isPlanningRecord(record(Number.MAX_SAFE_INTEGER))).toBe(true);
  });
  it('is commutative, associative and idempotent for placements and tombstones', () => {
    const values = [
      record(1),
      record(2),
      record(2, 'B'),
      record(2, 'B', 'b', null),
      record(3, 'A', 'c'),
    ];
    for (const a of values) {
      expect(mergePlanningRecord(a, a)).toBe(a);
      for (const b of values) {
        expect(mergePlanningRecord(a, b)).toEqual(mergePlanningRecord(b, a));
        for (const c of values)
          expect(mergePlanningRecord(mergePlanningRecord(a, b), c)).toEqual(
            mergePlanningRecord(a, mergePlanningRecord(b, c)),
          );
      }
    }
  });
  it('fails closed for conflicting payloads with identical revisions in both orders', () => {
    const a = record(2),
      b = record(2, 'A', 'a', null);
    expect(() => mergePlanningRecord(a, b)).toThrow();
    expect(() => mergePlanningRecord(b, a)).toThrow();
    expect(mergePlanningRecord(a, JSON.parse(JSON.stringify(a)))).toBe(a);
  });
  it('retains snapshot placement and tombstone against stale operations after JSON round trip', () => {
    for (const placement of [record(10).placement, null]) {
      const winner = record(10, 'A', 'winner', placement);
      expect(mergePlanningRecord(JSON.parse(JSON.stringify(winner)), record(9))).toEqual(
        winner,
      );
      expect(
        mergePlanningState(
          { ids: ['X'], entities: { X: winner } },
          { ids: ['X'], entities: { X: record(9) } },
        ).entities.X,
      ).toEqual(winner);
    }
  });
  it('uses reserved migration counter zero and rejects revisionless development records', () => {
    const baseline = legacyPlanningRecord({
      id: 'X',
      target: { type: 'DAY', key: '2026-10-05' },
      orderKey: 'F',
    });
    expect(baseline.revision.counter).toBe(0);
    expect(mergePlanningRecord(baseline, record(1))).toEqual(record(1));
    expect(
      isPlanningRecord({ id: 'X', target: baseline.placement!.target, orderKey: 'F' }),
    ).toBe(false);
  });
});
