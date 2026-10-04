import { RootState } from '../../root-store/root-state';
import { eventIntegrityMetaReducer } from '../../root-store/meta/event-integrity.meta-reducer';
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { buildReplacementOperation } from '../../op-log/sync/build-replacement-operation';
import { CURRENT_SCHEMA_VERSION } from '../../op-log/persistence/schema-migration.service';
import { TestBed } from '@angular/core/testing';
import { provideStore, Store } from '@ngrx/store';
import { EventService } from './event.service';
import { LocalEvent } from './event.model';
import { addEvent, updateEvent, removeEvent } from './store/event.actions';
import {
  eventReducer,
  initialEventState,
  isValidEvent,
  isValidEventState,
} from './store/event.reducer';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';
import { withDefaultModelSlices } from '../../op-log/model/model-config';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { extractEntityKeysFromState } from '../../op-log/persistence/extract-entity-keys';
import {
  getFullStateRequiredEntityTypes,
  supportsRequiredEntityTypes,
  SUPER_SYNC_OPERATION_CAPABILITIES,
} from '@sp/shared-schema';
import {
  PLANSTRAND_REQUIRED_FILE_OP_TYPES,
  assertPlanstrandFileEnvelope,
} from '../../op-log/sync-providers/file-based/planstrand-file-protocol';
import { zonedDateTimeFields, zonedDateTimeToTimestamp } from '../../util/iana-time-zone';
import { validateFull } from '../../op-log/validation/validation-fn';
import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';

const timed: LocalEvent = {
  id: 'event-1',
  title: 'Meeting',
  isAllDay: false,
  start: 100000,
  end: 200000,
  timeZone: 'America/Vancouver',
  created: 50,
  modified: 50,
};
const allDay: LocalEvent = {
  id: 'event-2',
  title: 'Day off',
  isAllDay: true,
  date: '2026-10-04',
  created: 50,
  modified: 50,
};
describe('local Events domain and persistence', () => {
  [timed, allDay].forEach((event) => {
    it(`creates, edits, hydrates and deletes ${event.isAllDay ? 'all-day' : 'timed'} Events`, () => {
      const added = eventReducer(undefined, addEvent({ event }));
      const id = event.id;
      const input = event.isAllDay
        ? { title: event.title, isAllDay: true as const, date: event.date }
        : {
            title: event.title,
            isAllDay: false as const,
            start: event.start,
            end: event.end,
            timeZone: event.timeZone,
          };
      const edited = eventReducer(
        added,
        updateEvent({ id, changes: { ...input, title: 'Edited' }, modified: 100 }),
      );
      const data = createValidAppData({ event: edited });
      expect(validateFull(data).isValid).toBeTrue();
      const hydrated = eventReducer(
        undefined,
        loadAllData({ appDataComplete: JSON.parse(JSON.stringify(data)) }),
      );
      expect(hydrated.entities[id]?.title).toBe('Edited');
      expect(eventReducer(hydrated, removeEvent({ id })).ids).toEqual([]);
    });
  });
  it('validates generic conflict replacements and keeps conversion fields authoritative', () => {
    const initial = {
      event: eventReducer(undefined, addEvent({ event: timed })),
    } as unknown as RootState;
    const reducer = eventIntegrityMetaReducer(lwwUpdateMetaReducer((state) => state!));
    const converted = { ...allDay, id: timed.id };
    const op = buildReplacementOperation(
      'EVENT',
      timed.id,
      converted,
      'sender',
      { sender: 1 },
      Date.now(),
    );
    const next = reducer(initial, convertOpToAction(op));
    expect(next.event?.entities[timed.id]).toEqual(
      jasmine.objectContaining({ isAllDay: true, date: allDay.date }),
    );
    expect(isValidEvent(next.event?.entities[timed.id])).toBeTrue();
    const malformed = buildReplacementOperation(
      'EVENT',
      timed.id,
      { ...timed, timeZone: 'Invalid/Zone' },
      'sender',
      { sender: 2 },
      Date.now(),
    );
    expect(() => reducer(initial, convertOpToAction(malformed))).toThrowError(
      'Invalid Event state',
    );
  });
  it('defaults old backups without an Event slice without changing them', () => {
    const old = createValidAppData();
    delete old.event;
    const filled = withDefaultModelSlices(old);
    expect(filled.event).toEqual(initialEventState);
    expect(eventReducer(undefined, loadAllData({ appDataComplete: old }))).toEqual(
      initialEventState,
    );
    expect(Object.hasOwn(old, 'event')).toBeFalse();
  });
  it('converts timed/all-day atomically without stale fields surviving JSON replay', () => {
    let state = eventReducer(undefined, addEvent({ event: timed }));
    const action = updateEvent({
      id: timed.id,
      changes: { title: timed.title, isAllDay: true, date: allDay.date },
      modified: 100,
    });
    const { type, meta, ...actionPayload } = action;
    const op = new TestClient('sender').createOperation({
      actionType: type,
      entityType: 'EVENT',
      entityId: timed.id,
      opType: meta.opType,
      payload: { actionPayload, entityChanges: [] },
    });
    state = eventReducer(state, convertOpToAction(JSON.parse(JSON.stringify(op))));
    expect(state.entities[timed.id]).toEqual({
      id: timed.id,
      title: timed.title,
      isAllDay: true,
      date: allDay.date,
      created: timed.created,
      modified: 100,
    });
    expect(isValidEventState(state)).toBeTrue();
  });
  [
    { ...timed, end: 100000 },
    { ...timed, end: 99999 },
    { ...timed, timeZone: 'Invalid/Zone' },
    { ...timed, timeZone: '+08:00' },
    { ...allDay, date: '2026-02-30' },
    { ...allDay, date: '2026-10-04T00:00:00Z' },
  ].forEach((event) => {
    it('rejects invalid range/zone/date at the reducer boundary', () => {
      expect(isValidEvent(event)).toBeFalse();
      expect(() => eventReducer(undefined, addEvent({ event }))).toThrow();
    });
  });
  it('keeps all-day source date independent of timezone and validates DST gaps', () => {
    expect(JSON.parse(JSON.stringify(allDay)).date).toBe('2026-10-04');
    const instant = zonedDateTimeToTimestamp('2026-10-04', '09:00', 'Asia/Tokyo');
    expect(instant).toBe(Date.UTC(2026, 9, 4, 0));
    expect(zonedDateTimeFields(instant!, 'Asia/Tokyo')).toEqual({
      date: '2026-10-04',
      time: '09:00',
    });
    expect(
      zonedDateTimeToTimestamp('2026-03-08', '02:30', 'America/Los_Angeles'),
    ).toBeNull();
  });
  it('advertises EVENT and blocks unaware state/file readers', () => {
    const state = { event: { ids: [timed.id], entities: { [timed.id]: timed } } };
    const required = getFullStateRequiredEntityTypes(state);
    expect(required).toContain('EVENT');
    expect(supportsRequiredEntityTypes(required, ['TASK'])).toBeFalse();
    expect(supportsRequiredEntityTypes(required, ['TASK', 'EVENT'])).toBeTrue();
    expect(SUPER_SYNC_OPERATION_CAPABILITIES.supportedEntityTypes).toContain('EVENT');
    expect(PLANSTRAND_REQUIRED_FILE_OP_TYPES).toContain('ENTITY:EVENT');
    const envelope = {
      product: 'planstrand',
      version: 4,
      compatibility: { requiredOpTypes: ['ENTITY:EVENT'] },
    };
    expect(() =>
      assertPlanstrandFileEnvelope(envelope, new Set(['ENTITY:TASK'])),
    ).toThrow();
    expect(() =>
      assertPlanstrandFileEnvelope(envelope, new Set(['ENTITY:EVENT'])),
    ).not.toThrow();
    expect(getFullStateRequiredEntityTypes({ event: initialEventState })).not.toContain(
      'EVENT',
    );
    expect(hasMeaningfulStateData(state)).toBeTrue();
  });
  it('persists IndexedDB operations and snapshots, then replays Event CRUD', async () => {
    TestBed.configureTestingModule({
      providers: [provideStore({ event: eventReducer })],
    });
    const log = TestBed.inject(OperationLogStoreService);
    await log.init();
    await log._clearAllDataForTesting();
    try {
      const actions = [
        addEvent({ event: timed }),
        updateEvent({
          id: timed.id,
          changes: {
            title: 'Moved',
            isAllDay: false,
            start: 300000,
            end: 400000,
            timeZone: timed.timeZone,
          },
          modified: 200,
        }),
      ];
      const client = new TestClient('sender');
      for (const action of actions) {
        const { type, meta, ...actionPayload } = action;
        await log.append(
          client.createOperation({
            actionType: type,
            entityType: 'EVENT',
            entityId: timed.id,
            opType: meta.opType,
            payload: { actionPayload, entityChanges: [] },
          }),
          'local',
        );
      }
      let state = initialEventState;
      for (const op of await log.getUnsynced())
        state = eventReducer(state, convertOpToAction(op.op));
      expect(state.entities[timed.id]?.title).toBe('Moved');
      const data = createValidAppData({ event: state });
      await log.saveStateCache({
        state: data,
        lastAppliedOpSeq: 2,
        vectorClock: { sender: 2 },
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      const cached = await log.loadStateCache();
      expect(
        eventReducer(
          undefined,
          loadAllData({ appDataComplete: cached!.state as typeof data }),
        ).entities[timed.id]?.title,
      ).toBe('Moved');
      expect(extractEntityKeysFromState(createValidAppData({ event: state }))).toContain(
        `EVENT:${timed.id}`,
      );
    } finally {
      await log._clearAllDataForTesting();
    }
  });
});

describe('Event commands', () => {
  let service: EventService;
  let dispatch: jasmine.Spy;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideStore({ event: eventReducer })],
    });
    service = TestBed.inject(EventService);
    dispatch = spyOn(TestBed.inject(Store), 'dispatch').and.callThrough();
  });
  it('creates, moves, resizes, edits, converts and deletes with one operation per intent', () => {
    const id = service.create({
      title: 'Event',
      isAllDay: false,
      start: 100000,
      end: 200000,
      timeZone: 'UTC',
    })!;
    expect(service.move(id, 300000)).toBeTrue();
    expect(service.entities()[id]).toEqual(
      jasmine.objectContaining({ start: 300000, end: 400000 }),
    );
    expect(service.resize(id, 500000)).toBeTrue();
    expect(
      service.update(id, { title: 'All day', isAllDay: true, date: '2026-10-04' }),
    ).toBeTrue();
    expect(service.remove(id)).toBeTrue();
    expect(dispatch).toHaveBeenCalledTimes(5);
    expect(service.entities()[id]).toBeUndefined();
  });
  it('rejects invalid writes before dispatch', () => {
    expect(
      service.create({
        title: 'Event',
        isAllDay: false,
        start: 2,
        end: 1,
        timeZone: 'UTC',
      }),
    ).toBeNull();
    expect(service.create({ title: '', isAllDay: true, date: '2026-10-04' })).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
