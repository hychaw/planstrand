import { TestBed } from '@angular/core/testing';
import { provideStore, Store, Action } from '@ngrx/store';
import {
  CURRENT_SCHEMA_VERSION,
  ENTITY_TYPES,
  ROUTINES_V1,
  CLIENT_SYNC_READER_CAPABILITIES,
  getFullStateRequiredCapabilities,
  getFullStateRequiredEntityTypes,
} from '@sp/shared-schema';
import { EventSeries, EventSeriesInput, EventSeriesState } from './event-series.model';
import {
  isValidEventSeries,
  isValidEventSeriesInput,
  isValidEventSeriesState,
} from './event-series.validation';
import { EventSeriesService } from './event-series.service';
import { addEventSeries, updateEventSeries } from './store/event-series.actions';
import {
  eventSeriesReducer,
  initialEventSeriesState,
} from './store/event-series.reducer';
import {
  selectAllEventSeries,
  selectEventSeriesById,
} from './store/event-series.selectors';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';
import { withDefaultModelSlices } from '../../op-log/model/model-config';
import {
  validateAllData,
  validateFull,
  appDataValidators,
} from '../../op-log/validation/validation-fn';
import { hasRecoverableData } from '../../op-log/backup/has-recoverable-data.util';
import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { extractEntityKeysFromState } from '../../op-log/persistence/extract-entity-keys';
import {
  protectFullStateBackup,
  readFullStateBackup,
} from '../../op-log/backup/full-state-backup-envelope';
import {
  getOperationCapabilityRequirement,
  getOperationRequiredCapabilities,
} from '../../op-log/sync/sync-capability.util';
import { getRemoteOpBlockReason } from '../../op-log/sync/remote-op-block.util';
import { buildReplacementOperation } from '../../op-log/sync/build-replacement-operation';
import { validateOperationPayload } from '../../op-log/validation/validate-operation-payload';
import { RootState } from '../../root-store/root-state';
import { OpType, Operation } from '../../op-log/core/operation.types';
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { eventSeriesIntegrityMetaReducer } from '../../root-store/meta/event-series-integrity.meta-reducer';

const input: EventSeriesInput = {
  title: 'Daily meeting',
  recurrence: {
    frequency: 'daily',
    interval: 1,
    startDate: '2026-10-10',
    endDate: '2026-12-31',
  },
  timing: {
    kind: 'timed',
    localTime: '09:00',
    timeZone: 'America/Vancouver',
    durationMs: 3600000,
  },
};
const series: EventSeries = {
  id: 'series-1',
  title: input.title,
  created: 50,
  modified: 50,
  segments: [{ id: 'segment-1', recurrence: input.recurrence, timing: input.timing }],
};
const operation = (
  action: ReturnType<typeof addEventSeries> | ReturnType<typeof updateEventSeries>,
): Operation => {
  const { type, meta, ...actionPayload } = action;
  return {
    ...new TestClient('sender').createOperation({
      actionType: type,
      entityType: meta.entityType,
      entityId: meta.entityId,
      opType: meta.opType,
      payload: { actionPayload, entityChanges: [] },
    }),
    requiredCapabilities: [ROUTINES_V1],
    requiredEntityTypes: ['EVENT_SERIES'],
  };
};
const fullOperation = (payload: unknown): Operation =>
  new TestClient('sender').createOperation({
    actionType: '[SP_ALL] Load(import) all data',
    opType: OpType.SyncImport,
    entityType: 'ALL',
    entityId: '*',
    payload,
  });
const state = (): EventSeriesState =>
  eventSeriesReducer(undefined, addEventSeries({ eventSeries: series }));

describe('EventSeries domain and replay', () => {
  it('updates whole schedules, clears end dates and preserves lineage and creation metadata', () => {
    const changes: EventSeriesInput = {
      title: 'Monthly day',
      recurrence: { frequency: 'monthly', startDate: '2026-10-31', interval: 2 },
      timing: { kind: 'allDay' },
    };
    const updated = eventSeriesReducer(
      state(),
      convertOpToAction(
        JSON.parse(
          JSON.stringify(
            operation(updateEventSeries({ id: series.id, changes, modified: 100 })),
          ),
        ),
      ),
    );
    expect(updated.entities[series.id]).toEqual({
      ...series,
      title: changes.title,
      modified: 100,
      segments: [
        { id: 'segment-1', recurrence: changes.recurrence, timing: changes.timing },
      ],
    });
    expect(selectAllEventSeries({ eventSeries: updated })).toEqual([
      updated.entities[series.id]!,
    ]);
    expect(selectEventSeriesById({ eventSeries: updated }, { id: series.id })).toEqual(
      updated.entities[series.id],
    );
  });
  it('makes duplicate creation harmless after a later update', () => {
    const update = updateEventSeries({
      id: series.id,
      changes: { ...input, title: 'Edited' },
      modified: 100,
    });
    const edited = eventSeriesReducer(state(), update);
    expect(eventSeriesReducer(edited, addEventSeries({ eventSeries: series }))).toBe(
      edited,
    );
    expect(eventSeriesReducer(edited, update)).toEqual(edited);
    expect(eventSeriesReducer(undefined, update)).toEqual(initialEventSeriesState);
  });
  it('only compensates existing series, retaining deterministic metadata and unrelated state', () => {
    const reducer = eventSeriesIntegrityMetaReducer(
      lwwUpdateMetaReducer((s: RootState | undefined, a: Action) => ({
        ...s!,
        eventSeries: eventSeriesReducer(s?.eventSeries, a),
      })),
    );
    const data = createValidAppData();
    const initial = {
      ...data,
      tasks: data.task,
      eventSeries: state(),
    } as unknown as RootState;
    const replacement = buildReplacementOperation(
      'EVENT_SERIES',
      series.id,
      { ...series, title: 'Winner', modified: 100 },
      'sender',
      { sender: 2 },
      100,
    );
    const next = reducer(initial, convertOpToAction(replacement));
    expect(next.eventSeries?.entities[series.id]).toEqual({
      ...series,
      title: 'Winner',
      modified: 100,
    });
    expect(next.tasks).toBe(initial.tasks);
    expect(next.workSession).toBe(initial.workSession);
    expect(next.event).toBe(initial.event);
    expect(replacement.requiredCapabilities).toEqual([ROUTINES_V1]);
    for (const corrupted of [
      { ...series, created: 25 },
      { ...series, segments: [{ ...series.segments[0], id: 'other' }] },
    ]) {
      const op = buildReplacementOperation(
        'EVENT_SERIES',
        series.id,
        corrupted,
        'sender',
        {},
        100,
      );
      expect(() => reducer(initial, convertOpToAction(op))).toThrow();
    }
    expect(
      reducer(
        { ...initial, eventSeries: initialEventSeriesState },
        convertOpToAction(replacement),
      ).eventSeries,
    ).toEqual(initialEventSeriesState);
  });
  it('accepts all recurrence families and leaves DST gap and monthly skip policies to the engine', () => {
    for (const recurrence of [
      input.recurrence,
      {
        frequency: 'weekly' as const,
        startDate: '2026-10-10',
        interval: 2,
        weekdays: [1, 5],
      },
      { frequency: 'monthly' as const, startDate: '2026-10-31', interval: 1 },
    ]) {
      expect(isValidEventSeriesInput({ ...input, recurrence })).toBeTrue();
      expect(
        isValidEventSeriesInput({ ...input, recurrence, timing: { kind: 'allDay' } }),
      ).toBeTrue();
    }
    expect(
      isValidEventSeriesInput({
        ...input,
        recurrence: { ...input.recurrence, startDate: '2026-03-08' },
        timing: {
          kind: 'timed',
          localTime: '02:30',
          timeZone: 'America/Los_Angeles',
          durationMs: 3600000,
        },
      }),
    ).toBeTrue();
  });
  const malformed: unknown[] = [
    {
      ...input,
      recurrence: { ...input.recurrence, startDate: '2026-03-08' },
      timing: {
        kind: 'timed',
        localTime: '02:30',
        timeZone: 'America/Los_Angeles',
        durationMs: Number.MAX_VALUE,
      },
    },
    { ...input, title: '' },
    { ...input, id: 'injected' },
    { ...input, created: 0 },
    ...[
      { frequency: 'yearly' },
      { interval: 0 },
      { interval: 1.5 },
      { startDate: '2026-02-30' },
      { endDate: '2026-01-01' },
      { weekdays: [1] },
      { frequency: 'weekly', weekdays: [] },
      { frequency: 'weekly', weekdays: [1, 1] },
      { frequency: 'weekly', weekdays: [0, 8] },
      { frequency: 'weekly' },
    ].map((change) => ({ ...input, recurrence: { ...input.recurrence, ...change } })),
    ...[
      {},
      { kind: 'timed', localTime: '09:00', durationMs: 10 },
      { ...input.timing, timeZone: '' },
      { ...input.timing, timeZone: 'Invalid/Zone' },
      { ...input.timing, timeZone: '+08:00' },
      { ...input.timing, durationMs: 0 },
      { ...input.timing, durationMs: Infinity },
      { ...input.timing, localTime: '24:00' },
      { kind: 'allDay', timeZone: 'UTC' },
    ].map((timing) => ({ ...input, timing })),
  ];
  malformed.forEach((definition, index) => {
    it(`rejects malformed definition ${index} before dispatch and at replay validation`, () => {
      expect(isValidEventSeriesInput(definition)).toBeFalse();
      const bad = definition as EventSeriesInput;
      const op = operation(
        updateEventSeries({ id: series.id, changes: bad, modified: 100 }),
      );
      expect(validateOperationPayload(op).success).toBeFalse();
      expect(() => eventSeriesReducer(state(), convertOpToAction(op))).toThrow();
    });
  });
  it('rejects malformed persisted slices and extra segments without repairing definitions away', () => {
    for (const value of [
      null,
      undefined,
      [],
      { ids: [], entities: { hidden: series } },
      { ids: [series.id, series.id], entities: { [series.id]: series } },
      { ids: [series.id], entities: { [series.id]: { ...series, segments: [] } } },
      {
        ids: [series.id],
        entities: {
          [series.id]: { ...series, segments: [series.segments[0], series.segments[0]] },
        },
      },
    ]) {
      const data = { ...createValidAppData(), eventSeries: value };
      expect(isValidEventSeriesState(value)).toBeFalse();
      expect(appDataValidators.eventSeries(value).success).toBeFalse();
      expect(validateAllData(data).success).toBeFalse();
      expect(() =>
        eventSeriesReducer(undefined, loadAllData({ appDataComplete: data as never })),
      ).toThrow();
      expect(withDefaultModelSlices(data).eventSeries).toBe(value as never);
    }
    expect(isValidEventSeries({ ...series, modified: 49 })).toBeFalse();
  });
  it('loads V1.1 without a slice, protects recurrence-only data, and round-trips protected backups', () => {
    const old = createValidAppData();
    delete old.eventSeries;
    expect(validateFull(old).isValid).toBeTrue();
    expect(eventSeriesReducer(undefined, loadAllData({ appDataComplete: old }))).toEqual(
      initialEventSeriesState,
    );
    expect(withDefaultModelSlices(old).eventSeries).toEqual(initialEventSeriesState);
    expect(Object.hasOwn(old, 'eventSeries')).toBeFalse();
    const data = { ...old, eventSeries: state() };
    expect(validateFull(data).isValid).toBeTrue();
    expect(hasRecoverableData({ eventSeries: state() })).toBeTrue();
    expect(hasMeaningfulStateData({ eventSeries: state() })).toBeTrue();
    expect(
      readFullStateBackup(JSON.parse(JSON.stringify(protectFullStateBackup(data)))),
    ).toEqual(
      JSON.parse(JSON.stringify({ ...data, requiredCapabilities: [ROUTINES_V1] })),
    );
    expect(extractEntityKeysFromState(data)).toContain('EVENT_SERIES:series-1');
  });
  it('fences only activated routines for snapshots and operation readers', () => {
    const plain = { eventSeries: initialEventSeriesState };
    const full = fullOperation(plain);
    expect(CLIENT_SYNC_READER_CAPABILITIES).toContain(ROUTINES_V1);
    expect(getFullStateRequiredCapabilities(plain)).toEqual([]);
    expect(getFullStateRequiredEntityTypes(plain)).not.toContain('EVENT_SERIES');
    expect(getOperationCapabilityRequirement(full).entityTypes).not.toContain(
      'EVENT_SERIES',
    );
    const oldEntities = ENTITY_TYPES.filter((v) => v !== 'EVENT_SERIES');
    const oldCapabilities = CLIENT_SYNC_READER_CAPABILITIES.filter(
      (v) => v !== ROUTINES_V1,
    );
    expect(
      getRemoteOpBlockReason(full, CURRENT_SCHEMA_VERSION, oldEntities, oldCapabilities),
    ).toBeNull();
    full.payload = { eventSeries: state() };
    expect(getFullStateRequiredCapabilities(full.payload)).toEqual([ROUTINES_V1]);
    expect(getOperationCapabilityRequirement(full).entityTypes).toContain('EVENT_SERIES');
    expect(
      getRemoteOpBlockReason(full, CURRENT_SCHEMA_VERSION, oldEntities, oldCapabilities),
    ).toBe('ENTITY_SUPPORT_REQUIRED');
    expect(
      getOperationRequiredCapabilities(
        operation(addEventSeries({ eventSeries: series })),
      ),
    ).toEqual([ROUTINES_V1]);
  });
});

describe('EventSeries commands and durable persistence', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideStore({ eventSeries: eventSeriesReducer })],
    }),
  );
  it('validates commands before persistent dispatch and assigns stable independent ids', () => {
    const service = TestBed.inject(EventSeriesService);
    const store = TestBed.inject(Store);
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    expect(service.create({ ...input, title: '' })).toBeNull();
    expect(service.update('missing', input)).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
    const id = service.create(input)!;
    const first = structuredClone(service.entities()[id]!);
    expect(service.create(input)).not.toBe(id);
    expect(service.update(id, { ...input, title: 'Edited' })).toBeTrue();
    expect(
      service.update(id, { ...input, timing: { kind: 'timed' } } as never),
    ).toBeFalse();
    expect(service.entities()[id]).toEqual({
      ...first,
      title: 'Edited',
      modified: jasmine.any(Number),
    });
  });
  it('reopens IndexedDB, restores snapshots and retains activation after history removal and full-state replacement', async () => {
    let log = TestBed.inject(OperationLogStoreService);
    await log.init();
    await log._clearAllDataForTesting();
    try {
      expect(await log.getRequiredCapabilities()).toEqual([]);
      const op = operation(addEventSeries({ eventSeries: series }));
      await log.append(op, 'local');
      await log.appendBatchSkipDuplicates([op], 'remote');
      expect((await log.getOpsAfterSeq(0)).length).toBe(1);
      expect(await log.getRequiredCapabilities()).toEqual([ROUTINES_V1]);
      const data = createValidAppData({ eventSeries: state() });
      await log.saveStateCache({
        state: data,
        lastAppliedOpSeq: 1,
        vectorClock: { sender: 1 },
        compactedAt: 100,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      // Close and instantiate a new service/connection: exercise actual reopen.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideStore({ eventSeries: eventSeriesReducer })],
      });
      log = TestBed.inject(OperationLogStoreService);
      await log.init();
      const cached = (await log.loadStateCache())!;
      expect(
        eventSeriesReducer(
          undefined,
          loadAllData({ appDataComplete: cached.state as typeof data }),
        ),
      ).toEqual(state());
      expect(
        eventSeriesReducer(
          undefined,
          convertOpToAction((await log.getOpsAfterSeq(0))[0].op),
        ),
      ).toEqual(state());
      await log.deleteOpsWhere(() => true);
      expect(await log.getRequiredCapabilities()).toEqual([ROUTINES_V1]);
      const replacement = fullOperation(createValidAppData());
      await log.runDestructiveStateReplacement({
        syncImportOp: replacement,
        snapshotEntityKeys: [],
      });
      expect((await log.getOpsAfterSeq(0))[0].op.requiredCapabilities).toEqual([
        ROUTINES_V1,
      ]);
      await log.clearAllOperations();
      await log.clearImportBackup();
      expect(await log.getRequiredCapabilities()).toEqual([ROUTINES_V1]);
    } finally {
      await log._clearAllDataForTesting();
    }
  });
});
