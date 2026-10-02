import { Store } from '@ngrx/store';
import { PlanningRecord, PlanningState } from '@sp/shared-schema';
import { configurePlanningWrites, planningCommands } from './planning-commands';
import { planningReducer } from './store/planning.reducer';
import { setPlacement, removePlacement } from './store/planning.actions';
import { selectAllPlacements } from './store/planning.selectors';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';
import { dataRepair } from '../../op-log/validation/data-repair';
import { RootState } from '../../root-store/root-state';

describe('Planning write preparation and metadata retention', () => {
  const placement: PlanningRecord['placement'] = {
    target: { type: 'DAY', key: '2026-10-05' },
    orderKey: 'F',
  };
  let state: PlanningState;
  let dispatched: Array<
    ReturnType<typeof setPlacement> | ReturnType<typeof removePlacement>
  >;
  let store: Store;
  beforeEach(() => {
    state = { ids: [], entities: {} };
    dispatched = [];
    store = {
      selectSignal: () => () => state,
      dispatch: (
        action: ReturnType<typeof setPlacement> | ReturnType<typeof removePlacement>,
      ) => {
        dispatched.push(action);
        state = planningReducer(state, action);
      },
    } as unknown as Store;
    configurePlanningWrites({ getOrGenerateClientId: async () => 'client-a' });
  });
  it('allocates before dispatch, increments repeated writes and retains unplanning', async () => {
    const writes = planningCommands(store);
    await writes.preparePlanningWrite('X', placement);
    await writes.preparePlanningWrite('X', null);
    expect(dispatched.map((a) => a.record.revision.counter)).toEqual([1, 2]);
    expect(dispatched[0].record.revision.opId).not.toBe(
      dispatched[1].record.revision.opId,
    );
    expect(state.ids).toEqual(['X']);
    expect(state.entities.X!.placement).toBeNull();
  });
  it('observes its previous write when two commands are issued without awaiting', async () => {
    const writes = planningCommands(store);
    await Promise.all([
      writes.preparePlanningWrite('X', placement),
      writes.preparePlanningWrite('X', null),
    ]);
    expect(dispatched.map((a) => a.record.revision.counter)).toEqual([1, 2]);
    expect(state.entities.X!.placement).toBeNull();
  });
  it('waits for delayed identity before reading the current counter and dispatching', async () => {
    let resolve!: (id: string) => void;
    configurePlanningWrites({
      getOrGenerateClientId: () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    });
    const pending = planningCommands(store).preparePlanningWrite('X', placement);
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatched.length).toBe(0);
    state = {
      ids: ['X'],
      entities: {
        X: {
          id: 'X',
          placement: null,
          revision: { counter: 7, clientId: 'peer', opId: 'peer-op' },
        },
      },
    };
    resolve('client-a');
    await pending;
    expect(state.entities.X!.revision.counter).toBe(8);
  });
  it('uses rotated identity on subsequent writes and resets from the actual current state', async () => {
    let identity = 'client-a';
    configurePlanningWrites({ getOrGenerateClientId: async () => identity });
    const writes = planningCommands(store);
    await writes.preparePlanningWrite('X', placement);
    identity = 'rotated-client';
    state = { ids: [], entities: {} };
    await writes.preparePlanningWrite('X', placement);
    expect(state.entities.X!.revision).toEqual(
      jasmine.objectContaining({ clientId: identity, counter: 1 }),
    );
  });
  it('stops at the maximum safe counter without mutation', async () => {
    state = {
      ids: ['X'],
      entities: {
        X: {
          id: 'X',
          placement: null,
          revision: {
            counter: Number.MAX_SAFE_INTEGER,
            clientId: 'client-a',
            opId: 'max',
          },
        },
      },
    };
    await expectAsync(
      planningCommands(store).preparePlanningWrite('X', placement),
    ).toBeRejectedWithError(/counter exhausted/);
    expect(dispatched).toEqual([]);
  });
  it('repair retains active records and tombstones for absent Tasks', () => {
    for (const value of [placement, null]) {
      const data = createValidAppData();
      const record: PlanningRecord = {
        id: 'absent',
        placement: value,
        revision: { counter: 10, clientId: 'client-a', opId: 'retained' },
      };
      data.planning = { ids: ['absent'], entities: { absent: record } };
      expect(dataRepair(data).data.planning).toEqual(data.planning);
    }
  });
  it('selectors hide retained absent-Task metadata', () => {
    const record: PlanningRecord = {
      id: 'absent',
      placement,
      revision: { counter: 10, clientId: 'client-a', opId: 'retained' },
    };
    const root = {
      tasks: { ids: [], entities: {} },
      planning: { ids: ['absent'], entities: { absent: record } },
    } as unknown as RootState;
    expect(selectAllPlacements(root)).toEqual([]);
  });
});
