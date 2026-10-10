import { TestBed } from '@angular/core/testing';
import { Store, provideStore } from '@ngrx/store';
import {
  CLIENT_SYNC_READER_CAPABILITIES,
  CURRENT_SCHEMA_VERSION,
  ENTITY_TYPES,
  ROUTINES_V1,
  getFullStateRequiredCapabilities,
  getFullStateRequiredEntityTypes,
} from '@sp/shared-schema';
import {
  OccurrenceException,
  OccurrenceExceptionState,
  OccurrenceExceptionValue,
} from './occurrence-exception.model';
import {
  occurrenceExceptionId,
  isValidOccurrenceException,
  isValidOccurrenceExceptionState,
  isValidOccurrenceExceptionValue,
} from './occurrence-exception.validation';
import { OccurrenceExceptionService } from './occurrence-exception.service';
import {
  occurrenceKey,
  isValidOccurrenceKey,
  logicalOccurrenceSlot,
} from './occurrence-key';
import { setOccurrenceException } from './store/occurrence-exception.actions';
import {
  occurrenceExceptionReducer,
  initialOccurrenceExceptionState,
} from './store/occurrence-exception.reducer';
import { selectOccurrenceExceptionById } from './store/occurrence-exception.selectors';
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
import { getOperationRequiredCapabilities } from '../../op-log/sync/sync-capability.util';
import { getRemoteOpBlockReason } from '../../op-log/sync/remote-op-block.util';
import { buildReplacementOperation } from '../../op-log/sync/build-replacement-operation';
import { validateOperationPayload } from '../../op-log/validation/validate-operation-payload';
import { OpType, Operation } from '../../op-log/core/operation.types';
import { EventInput } from '../event/event.model';
import { EventSeries } from './event-series.model';
import { projectEventOccurrences } from '../schedule/project-event-occurrences';

const key = { seriesId: 'series', slot: 3 };
const allDay: EventInput = { title: 'Moved', isAllDay: true, date: '2028-01-01' };
const timed: EventInput = {
  title: 'Timed',
  isAllDay: false,
  start: 1000,
  end: 2000,
  timeZone: 'Asia/Tokyo',
};
const exception = (
  value: OccurrenceExceptionValue = { kind: 'override', event: allDay },
  slot = key.slot,
): OccurrenceException => ({
  id: occurrenceExceptionId({ ...key, slot }),
  seriesId: key.seriesId,
  slot,
  value,
  modified: 100,
});
const action = (
  value?: OccurrenceExceptionValue,
  slot?: number,
): ReturnType<typeof setOccurrenceException> =>
  setOccurrenceException({ occurrenceException: exception(value, slot) });
const operation = (a = action()): Operation => {
  const { type, meta, ...actionPayload } = a;
  return {
    ...new TestClient('sender').createOperation({
      actionType: type,
      entityType: meta.entityType,
      entityId: meta.entityId,
      opType: meta.opType,
      payload: { actionPayload, entityChanges: [] },
    }),
    requiredEntityTypes: ['OCCURRENCE_EXCEPTION'],
    requiredCapabilities: [ROUTINES_V1],
  };
};
const state = (): OccurrenceExceptionState =>
  occurrenceExceptionReducer(undefined, action());

describe('Occurrence exception identity and validation', () => {
  it('encodes collision-safe lineage/global slots independent of segment, dates and windows', () => {
    const ids = ['a:b', 'a', 'a,3', 'a"', '日本', '["a",3]'].flatMap((seriesId) =>
      [0, 3, Number.MAX_SAFE_INTEGER].map((slot) =>
        occurrenceExceptionId({ seriesId, slot }),
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(occurrenceExceptionId(key)).toBe(`occurrenceException:${occurrenceKey(key)}`);
    const series: EventSeries = {
      id: key.seriesId,
      title: 'Daily',
      created: 0,
      modified: 0,
      segments: [
        {
          id: 'old',
          recurrence: { frequency: 'daily', interval: 1, startDate: '2026-01-01' },
          timing: { kind: 'allDay' },
        },
      ],
    };
    const first = projectEventOccurrences(
      [series],
      { fromDate: '2026-01-01', toDateExclusive: '2026-01-06' },
      'UTC',
    )[3];
    const restarted = JSON.parse(JSON.stringify(series)) as EventSeries;
    restarted.segments[0].id = 'new';
    const next = projectEventOccurrences(
      [restarted],
      { fromDate: '2026-01-04', toDateExclusive: '2026-01-05' },
      'Asia/Tokyo',
    )[0];
    expect(next.id).toBe(first.id);
    expect(first.occurrence.key).toBe(occurrenceKey(key));
    restarted.segments[0].recurrence = {
      ...restarted.segments[0].recurrence,
      startDate: '2026-01-04',
    };
    restarted.segments[0].logicalSlotOffset = 3;
    expect(
      projectEventOccurrences(
        [restarted],
        { fromDate: '2026-01-04', toDateExclusive: '2026-01-05' },
        'UTC',
      )[0].id,
    ).toBe(first.id);
    expect(logicalOccurrenceSlot(2, 3)).toBe(5);
    expect(() => logicalOccurrenceSlot(1, Number.MAX_SAFE_INTEGER)).toThrow();
  });
  for (const badKey of [
    null,
    {},
    { seriesId: '', slot: 0 },
    { seriesId: '__proto__', slot: 0 },
    { ...key, slot: -1 },
    { ...key, slot: -0 },
    { ...key, slot: 1.5 },
    { ...key, slot: '3' },
    { ...key, slot: Infinity },
    { ...key, slot: Number.MAX_SAFE_INTEGER + 1 },
    { ...key, segmentId: 's' },
  ]) {
    it(`rejects malformed occurrence key ${JSON.stringify(badKey)}`, () =>
      expect(isValidOccurrenceKey(badKey)).toBeFalse());
  }
  for (const value of [
    { kind: 'inherit' },
    { kind: 'cancelled' },
    { kind: 'override', event: allDay },
    { kind: 'override', event: timed },
  ]) {
    it(`accepts complete ${JSON.stringify(value)} values`, () =>
      expect(isValidOccurrenceExceptionValue(value)).toBeTrue());
  }
  for (const value of [
    null,
    {},
    { kind: 'other' },
    { kind: 'cancelled', event: allDay },
    { kind: 'inherit', event: undefined },
    { kind: 'override' },
    { kind: 'override', event: { ...allDay, date: '2026-02-30' } },
    { kind: 'override', event: { ...allDay, start: 100 } },
    { kind: 'override', event: { ...allDay, title: '' } },
    { kind: 'override', event: { ...timed, timeZone: '' } },
    { kind: 'override', event: { ...timed, timeZone: '+08:00' } },
    { kind: 'override', event: { ...timed, end: 1000 } },
    { kind: 'override', event: { ...timed, id: 'injected' } },
  ]) {
    it(`rejects malformed value ${JSON.stringify(value)}`, () => {
      expect(isValidOccurrenceExceptionValue(value)).toBeFalse();
      const op = operation(action(value as never));
      expect(validateOperationPayload(op).success).toBeFalse();
      expect(() =>
        occurrenceExceptionReducer(undefined, convertOpToAction(op)),
      ).toThrow();
    });
  }
  it('rejects mismatched identity, metadata and malformed slices without repair to empty', () => {
    for (const bad of [
      { ...exception(), id: 'other' },
      { ...exception(), seriesId: 'other' },
      { ...exception(), slot: 4 },
      { ...exception(), modified: NaN },
      { ...exception(), extra: true },
    ])
      expect(isValidOccurrenceException(bad)).toBeFalse();
    for (const slice of [
      null,
      undefined,
      [],
      { ids: [], entities: { hidden: exception() } },
      {
        ids: [exception().id, exception().id],
        entities: { [exception().id]: exception() },
      },
    ]) {
      const data = { ...createValidAppData(), occurrenceException: slice };
      expect(isValidOccurrenceExceptionState(slice)).toBeFalse();
      expect(appDataValidators.occurrenceException!(slice).success).toBeFalse();
      expect(validateAllData(data).success).toBeFalse();
      expect(withDefaultModelSlices(data).occurrenceException).toBe(slice as never);
      expect(() =>
        occurrenceExceptionReducer(
          undefined,
          loadAllData({ appDataComplete: data as never }),
        ),
      ).toThrow();
    }
  });
});

describe('Occurrence exception persistence and commands', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideStore({ occurrenceException: occurrenceExceptionReducer })],
    }),
  );
  it('edits, re-edits, cancels and restores with one complete durable intent each', () => {
    const service = TestBed.inject(OccurrenceExceptionService);
    const store = TestBed.inject(Store);
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    expect(service.edit({ ...key, slot: -1 }, allDay)).toBeFalse();
    expect(service.updateOverride(key, allDay)).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
    expect(service.edit(key, allDay)).toBeTrue();
    expect(service.updateOverride(key, timed)).toBeTrue();
    expect(service.entities()[exception().id]?.value).toEqual({
      kind: 'override',
      event: timed,
    });
    expect(service.edit(key, allDay)).toBeTrue();
    expect(service.cancel(key)).toBeTrue();
    expect(service.entities()[exception().id]?.value).toEqual({ kind: 'cancelled' });
    expect(service.restore(key)).toBeTrue();
    expect(service.entities()[exception().id]?.value).toEqual({ kind: 'inherit' });
    expect(Object.keys(service.entities()).length).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(5);
    const first = dispatch.calls.first().args[0] as unknown as ReturnType<
      typeof setOccurrenceException
    >;
    expect(first.occurrenceException.value).toEqual({ kind: 'override', event: allDay });
    expect(first.occurrenceException.slot).toBe(key.slot);
    expect(first.meta.entityId).toBe(exception().id);
  });
  it('replays duplicate and reordered independent slots without materializing other entities or pruning missing parents', () => {
    const a = convertOpToAction(operation());
    const b = convertOpToAction(operation(action({ kind: 'cancelled' }, 4)));
    const ab = occurrenceExceptionReducer(occurrenceExceptionReducer(undefined, a), b);
    const ba = occurrenceExceptionReducer(occurrenceExceptionReducer(undefined, b), a);
    expect(ab.entities).toEqual(ba.entities);
    expect(occurrenceExceptionReducer(ab, a)).toEqual(ab);
    const data = createValidAppData({ occurrenceException: ab });
    expect(validateFull(data).isValid).toBeTrue();
    expect(data.eventSeries?.ids ?? []).toEqual([]);
    expect(
      selectOccurrenceExceptionById({ occurrenceException: ab }, { id: exception().id }),
    ).toEqual(exception());
    const restored = occurrenceExceptionReducer(
      ab,
      convertOpToAction(operation(action({ kind: 'inherit' }))),
    );
    expect(restored.entities[exception().id]?.value).toEqual({ kind: 'inherit' });
    expect(restored.ids.length).toBe(2);
  });
  it('replaces compensation atomically and rejects attempts to change ownership', () => {
    const op = buildReplacementOperation(
      'OCCURRENCE_EXCEPTION',
      exception().id,
      exception({ kind: 'cancelled' }),
      'sender',
      {},
      200,
    );
    expect(op.requiredCapabilities).toEqual([ROUTINES_V1]);
    expect(validateOperationPayload(op).success).toBeTrue();
    expect(
      occurrenceExceptionReducer(state(), convertOpToAction(op)).entities[exception().id]
        ?.value,
    ).toEqual({ kind: 'cancelled' });
    expect(occurrenceExceptionReducer(undefined, convertOpToAction(op)).ids.length).toBe(
      1,
    );
    const bad = buildReplacementOperation(
      'OCCURRENCE_EXCEPTION',
      exception().id,
      { ...exception(), seriesId: 'other' },
      'sender',
      {},
      200,
    );
    expect(validateOperationPayload(bad).success).toBeFalse();
    expect(() => occurrenceExceptionReducer(state(), convertOpToAction(bad))).toThrow();
  });
  it('round-trips backups/imports, defaults V1.1 and protects exception-only recovery', () => {
    const old = createValidAppData();
    delete old.occurrenceException;
    expect(validateFull(old).isValid).toBeTrue();
    expect(withDefaultModelSlices(old).occurrenceException).toEqual(
      initialOccurrenceExceptionState,
    );
    expect(
      occurrenceExceptionReducer(undefined, loadAllData({ appDataComplete: old })),
    ).toEqual(initialOccurrenceExceptionState);
    const data = { ...old, occurrenceException: state() };
    const backup = readFullStateBackup(
      JSON.parse(JSON.stringify(protectFullStateBackup(data))),
    )!;
    expect(
      occurrenceExceptionReducer(
        undefined,
        loadAllData({ appDataComplete: backup as never }),
      ),
    ).toEqual(state());
    expect(hasRecoverableData({ occurrenceException: state() })).toBeTrue();
    expect(hasMeaningfulStateData({ occurrenceException: state() })).toBeTrue();
    expect(extractEntityKeysFromState(data)).toContain(
      `OCCURRENCE_EXCEPTION:${exception().id}`,
    );
  });
  it('requires ROUTINES_V1 for every write and rejects unaware readers without fencing unactivated state', () => {
    const oldEntities = ENTITY_TYPES.filter((v) => v !== 'OCCURRENCE_EXCEPTION');
    const oldCaps = CLIENT_SYNC_READER_CAPABILITIES.filter((v) => v !== ROUTINES_V1);
    for (const value of [
      { kind: 'inherit' },
      { kind: 'cancelled' },
      { kind: 'override', event: timed },
    ] as OccurrenceExceptionValue[]) {
      const op = operation(action(value));
      expect(getOperationRequiredCapabilities(op)).toEqual([ROUTINES_V1]);
      expect(
        getRemoteOpBlockReason(op, CURRENT_SCHEMA_VERSION, oldEntities, oldCaps),
      ).toBe('ENTITY_SUPPORT_REQUIRED');
      expect(
        getRemoteOpBlockReason(op, CURRENT_SCHEMA_VERSION, ENTITY_TYPES, oldCaps),
      ).toBe('ENTITY_SUPPORT_REQUIRED');
    }
    const plain = { occurrenceException: initialOccurrenceExceptionState };
    expect(getFullStateRequiredCapabilities(plain)).toEqual([]);
    expect(getFullStateRequiredEntityTypes(plain)).not.toContain('OCCURRENCE_EXCEPTION');
    const full = new TestClient('sender').createOperation({
      actionType: '[SP_ALL] Load(import) all data',
      entityType: 'ALL',
      entityId: '*',
      opType: OpType.SyncImport,
      payload: plain,
    });
    expect(
      getRemoteOpBlockReason(full, CURRENT_SCHEMA_VERSION, oldEntities, oldCaps),
    ).toBeNull();
    full.payload = { occurrenceException: state() };
    expect(
      getRemoteOpBlockReason(full, CURRENT_SCHEMA_VERSION, oldEntities, oldCaps),
    ).toBe('ENTITY_SUPPORT_REQUIRED');
  });
  it('reopens IndexedDB and restores compact operations and snapshots, retaining activation across replacement', async () => {
    let log = TestBed.inject(OperationLogStoreService);
    await log.init();
    await log._clearAllDataForTesting();
    try {
      const op = operation();
      await log.append(op, 'local');
      await log.appendBatchSkipDuplicates([op], 'remote');
      expect((await log.getOpsAfterSeq(0)).length).toBe(1);
      expect(await log.getRequiredCapabilities()).toEqual([ROUTINES_V1]);
      const data = createValidAppData({ occurrenceException: state() });
      await log.saveStateCache({
        state: data,
        lastAppliedOpSeq: 1,
        vectorClock: { sender: 1 },
        compactedAt: 100,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideStore({ occurrenceException: occurrenceExceptionReducer })],
      });
      log = TestBed.inject(OperationLogStoreService);
      await log.init();
      expect(
        occurrenceExceptionReducer(
          undefined,
          loadAllData({
            appDataComplete: (await log.loadStateCache())!.state as typeof data,
          }),
        ),
      ).toEqual(state());
      expect(
        occurrenceExceptionReducer(
          undefined,
          convertOpToAction((await log.getOpsAfterSeq(0))[0].op),
        ),
      ).toEqual(state());
      await log.deleteOpsWhere(() => true);
      expect(await log.getRequiredCapabilities()).toEqual([ROUTINES_V1]);
      const full = new TestClient('sender').createOperation({
        actionType: '[SP_ALL] Load(import) all data',
        entityType: 'ALL',
        entityId: '*',
        opType: OpType.SyncImport,
        payload: createValidAppData(),
      });
      await log.runDestructiveStateReplacement({
        syncImportOp: full,
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
