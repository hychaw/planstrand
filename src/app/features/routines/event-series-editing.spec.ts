import { TestBed } from '@angular/core/testing';
import { provideStore } from '@ngrx/store';
import { EventSeriesService } from './event-series.service';
import { EventSeries, EventSeriesInput, EventSeriesPlan } from './event-series.model';
import { eventSeriesReducer } from './store/event-series.reducer';
import { occurrenceExceptionReducer } from './store/occurrence-exception.reducer';
import { OccurrenceExceptionService } from './occurrence-exception.service';
import { projectEventOccurrences } from '../schedule/project-event-occurrences';
import { resolveEventOccurrence } from './resolve-event-occurrence';
import { isValidEventSeriesPlan, isValidEventSeries } from './event-series.validation';
import {
  addEventSeries,
  deleteEventSeries,
  replaceEventSeriesPlan,
  updateEventSeries,
} from './store/event-series.actions';
import { occurrenceExceptionId } from './occurrence-exception.validation';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';
import {
  protectFullStateBackup,
  readFullStateBackup,
} from '../../op-log/backup/full-state-backup-envelope';
import { validateFull } from '../../op-log/validation/validation-fn';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { validateOperationPayload } from '../../op-log/validation/validate-operation-payload';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';

const input: EventSeriesInput = {
  title: 'Original',
  recurrence: { frequency: 'daily', startDate: '2026-01-01', interval: 1 },
  timing: { kind: 'allDay' },
};
const weekly: EventSeriesInput['recurrence'] = {
  frequency: 'weekly',
  startDate: '2026-01-05',
  interval: 2,
  weekdays: [1, 5],
};
const monthly: EventSeriesInput['recurrence'] = {
  frequency: 'monthly',
  startDate: '2026-01-31',
  interval: 1,
};

describe('EventSeries editing and lifecycle', () => {
  let service: EventSeriesService;
  let exceptions: OccurrenceExceptionService;
  let id: string;
  const current = (): EventSeries => service.entities()[id]!;
  const items = (
    fromDate = '2026-01-01',
    toDateExclusive = '2027-01-01',
  ): ReturnType<typeof projectEventOccurrences> =>
    projectEventOccurrences(
      [current()],
      { fromDate, toDateExclusive },
      'UTC',
      Object.values(exceptions.entities()).filter((v) => !!v),
    );
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideStore({
          eventSeries: eventSeriesReducer,
          occurrenceException: occurrenceExceptionReducer,
        }),
      ],
    });
    service = TestBed.inject(EventSeriesService);
    exceptions = TestBed.inject(OccurrenceExceptionService);
    id = service.create(input)!;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('preserves earlier slots through multiple daily/weekly/monthly splits and bounded windows', () => {
    const before = items('2026-01-01', '2026-01-05');
    expect(
      service.editThisAndFuture(id, 4, { title: 'Weekly', recurrence: weekly }).ok,
    ).toBeTrue();
    expect(
      service.editThisAndFuture(id, 7, { title: 'Monthly', recurrence: monthly }).ok,
    ).toBeTrue();
    expect(current().segments.map((s) => s.logicalSlotOffset ?? 0)).toEqual([0, 4, 7]);
    expect(items('2026-01-01', '2026-01-05')).toEqual(before);
    const all = items();
    expect(all.slice(0, 9).map((i) => [i.occurrence.slot, i.date, i.title])).toEqual([
      [0, '2026-01-01', 'Original'],
      [1, '2026-01-02', 'Original'],
      [2, '2026-01-03', 'Original'],
      [3, '2026-01-04', 'Original'],
      [4, '2026-01-05', 'Weekly'],
      [5, '2026-01-09', 'Weekly'],
      [6, '2026-01-19', 'Weekly'],
      [7, '2026-01-31', 'Monthly'],
      [9, '2026-03-31', 'Monthly'],
    ]);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    for (const occurrence of all) {
      expect(
        resolveEventOccurrence(current(), {
          seriesId: id,
          slot: occurrence.occurrence.slot,
        })?.scheduledDate,
      ).toBe(occurrence.occurrence.scheduledDate);
    }
    expect(items('2026-03-01', '2026-04-01')).toEqual(
      all.filter((i) => i.date! >= '2026-03-01' && i.date! < '2026-04-01'),
    );
    // A later split uses the existing global slot, including reserved monthly holes.
    expect(
      service.editThisAndFuture(id, 11, {
        recurrence: {
          frequency: 'daily',
          startDate: '2026-05-31',
          interval: 3,
        },
      }).ok,
    ).toBeTrue();
    expect(current().segments.map((s) => s.logicalSlotOffset ?? 0)).toEqual([
      0, 4, 7, 11,
    ]);
    expect(items('2026-05-31', '2026-06-05').map((i) => i.occurrence.slot)).toEqual([
      11, 12,
    ]);
  });
  for (const slot of [0, 1, 20]) {
    it(`splits at slot ${slot} without duplicating the selected occurrence`, () => {
      const original = items();
      expect(
        service.editThisAndFuture(id, slot, {
          title: 'New',
          timing: {
            kind: 'timed',
            localTime: '09:00',
            timeZone: 'Asia/Tokyo',
            durationMs: 7200000,
          },
        }).ok,
      ).toBeTrue();
      const after = items();
      expect(after.filter((i) => i.occurrence.slot < slot)).toEqual(
        original.filter((i) => i.occurrence.slot < slot),
      );
      expect(after.filter((i) => i.occurrence.slot === slot).length).toBe(1);
      expect(after.find((i) => i.occurrence.slot === slot)?.id).toBe(original[slot].id);
      expect(current().segments[0].logicalSlotOffset ?? 0).toBe(0);
    });
  }
  it('preserves schedule plans for metadata edits and preserves future rule changes for future title edits', () => {
    service.editThisAndFuture(id, 4, { recurrence: weekly, title: 'Weekly' });
    const schedules = current().segments.map((s) => ({
      recurrence: s.recurrence,
      timing: s.timing,
    }));
    expect(service.editThisAndFuture(id, 2, { title: 'Future' }).ok).toBeTrue();
    expect(
      items()
        .filter((i) => i.occurrence.slot >= 2)
        .every((i) => i.title === 'Future'),
    ).toBeTrue();
    expect(current().segments[2].recurrence).toEqual(weekly);
    expect(service.editEntire(id, { title: 'Entire' }).ok).toBeTrue();
    expect(items().every((i) => i.title === 'Entire')).toBeTrue();
    expect(current().segments[0].recurrence).toEqual(schedules[0].recurrence);
    expect(current().segments[2].recurrence).toEqual(schedules[1].recurrence);
  });
  it('replaces an entire multi-segment schedule at global zero with explicit timezone, shape and bounds', () => {
    service.editThisAndFuture(id, 4, { recurrence: weekly });
    const firstId = current().segments[0].id;
    expect(
      service.editEntire(id, {
        recurrence: monthly,
        timing: {
          kind: 'timed',
          localTime: '10:30',
          timeZone: 'Europe/Berlin',
          durationMs: 3600000,
        },
      }).ok,
    ).toBeTrue();
    expect(current().segments.length).toBe(1);
    expect(current().segments[0].id).toBe(firstId);
    expect(items()[0].occurrence.slot).toBe(0);
    expect(
      service.editEntire(id, { recurrence: { ...monthly, endDate: '2026-03-31' } }).ok,
    ).toBeTrue();
    expect(items().map((i) => i.occurrence.slot)).toEqual([0, 2]);
    expect(
      service.editEntire(id, { recurrence: monthly, timing: { kind: 'allDay' } }).ok,
    ).toBeTrue();
    expect(items().length).toBeGreaterThan(2);
    expect(items()[0].isAllDay).toBeTrue();
  });
  it('keeps DST gaps reserved after splitting and applies timezone and duration per segment', () => {
    expect(
      service.editThisAndFuture(id, 2, {
        recurrence: {
          frequency: 'daily',
          startDate: '2026-03-07',
          interval: 1,
        },
        timing: {
          kind: 'timed',
          localTime: '02:30',
          timeZone: 'America/Los_Angeles',
          durationMs: 3600000,
        },
      }).ok,
    ).toBeTrue();
    const march = items('2026-03-07', '2026-03-10');
    expect(march.map((i) => i.occurrence.slot)).toEqual([2, 4]);
    expect(march.map((i) => i.start)).toEqual([
      Date.parse('2026-03-07T10:30Z'),
      Date.parse('2026-03-09T09:30Z'),
    ]);
    expect(
      service.editThisAndFuture(id, 4, {
        timing: {
          kind: 'timed',
          localTime: '09:00',
          timeZone: 'Asia/Tokyo',
          durationMs: 7200000,
        },
      }).ok,
    ).toBeTrue();
    expect(items('2026-03-09', '2026-03-10')[0].start).toBe(
      Date.parse('2026-03-09T00:00Z'),
    );
    expect(items('2026-03-09', '2026-03-10')[0].end).toBe(
      Date.parse('2026-03-09T02:00Z'),
    );
  });
  it('retains canonical slots at a DST fold after a timed split', () => {
    service.editThisAndFuture(id, 2, {
      recurrence: {
        frequency: 'daily',
        startDate: '2026-10-31',
        interval: 1,
      },
      timing: {
        kind: 'timed',
        localTime: '01:30',
        timeZone: 'America/Los_Angeles',
        durationMs: 3600000,
      },
    });
    const fold = items('2026-10-31', '2026-11-03');
    expect(fold.map((i) => i.occurrence.slot)).toEqual([2, 3, 4]);
    expect(fold.map((i) => i.start)).toEqual([
      Date.parse('2026-10-31T08:30Z'),
      Date.parse('2026-11-01T08:30Z'),
      Date.parse('2026-11-02T09:30Z'),
    ]);
  });
  it('shortens and extends the final segment without deleting its now-inert exceptions', () => {
    service.editThisAndFuture(id, 4, { recurrence: weekly });
    const key = { seriesId: id, slot: 8 };
    exceptions.cancel(key);
    const stored = exceptions.entities()[occurrenceExceptionId(key)];
    expect(
      service.editThisAndFuture(id, 4, {
        recurrence: { ...weekly, endDate: '2026-01-09' },
      }),
    ).toEqual({ ok: false, reason: 'exception-decision-required' });
    expect(
      service.editThisAndFuture(
        id,
        4,
        { recurrence: { ...weekly, endDate: '2026-01-09' } },
        'retain',
      ).ok,
    ).toBeTrue();
    expect(items().map((i) => i.occurrence.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(exceptions.entities()[occurrenceExceptionId(key)]).toBe(stored);
    expect(
      service.editThisAndFuture(id, 4, { recurrence: weekly }, 'retain').ok,
    ).toBeTrue();
    expect(items().some((i) => i.occurrence.slot === 8)).toBeFalse();
    expect(items().some((i) => i.occurrence.slot === 9)).toBeTrue();
    expect(exceptions.entities()[occurrenceExceptionId(key)]).toBe(stored);
  });
  it('requires retain for affected meaningful exceptions and safely rejects atomic clearing', () => {
    exceptions.cancel({ seriesId: id, slot: 4 });
    exceptions.restore({ seriesId: id, slot: 5 });
    const before = current();
    const exceptionState = structuredClone(exceptions.entities());
    expect(service.editThisAndFuture(id, 4, { recurrence: monthly })).toEqual({
      ok: false,
      reason: 'exception-decision-required',
    });
    expect(current()).toBe(before);
    expect(service.editThisAndFuture(id, 4, { recurrence: monthly }, 'clear')).toEqual({
      ok: false,
      reason: 'atomic-clear-unsupported',
    });
    expect(current()).toBe(before);
    expect(
      service.editThisAndFuture(id, 4, { recurrence: monthly }, 'retain').ok,
    ).toBeTrue();
    expect(exceptions.entities()).toEqual(exceptionState);
    expect(items().some((i) => i.occurrence.slot === 4)).toBeFalse();
  });
  it('needs no clearing transaction when affected slots have no meaningful exceptions', () => {
    exceptions.restore({ seriesId: id, slot: 4 });
    expect(
      service.editThisAndFuture(id, 4, { recurrence: weekly }, 'clear').ok,
    ).toBeTrue();
  });
  it('allows inheritance-only edits and leaves earlier exceptions unchanged', () => {
    exceptions.cancel({ seriesId: id, slot: 1 });
    exceptions.restore({ seriesId: id, slot: 4 });
    expect(service.editThisAndFuture(id, 4, { recurrence: weekly }).ok).toBeTrue();
    expect(items().some((i) => i.occurrence.slot === 1)).toBeFalse();
  });
  it('uses the original slot of a moved exception and finds moved-in/out overrides after rule edits', () => {
    const key = { seriesId: id, slot: 4 };
    exceptions.edit(key, { title: 'Moved', isAllDay: true, date: '2027-05-01' });
    const exception = exceptions.entities()[occurrenceExceptionId(key)]!;
    expect(
      service.editThisAndFuture(id, 4, { recurrence: weekly }, 'retain').ok,
    ).toBeTrue();
    expect(items('2026-01-05', '2026-01-06')).toEqual([]);
    const moved = items('2027-05-01', '2027-05-02');
    expect(moved.length).toBe(1);
    expect(moved[0].occurrence.slot).toBe(4);
    expect(moved[0].occurrence.scheduledDate).toBe('2026-01-05');
    expect(exceptions.entities()[exception.id]).toEqual(exception);
    // Title-only split must use January 5, never the override's May date.
    expect(service.editThisAndFuture(id, 4, { title: 'Later' }).ok).toBeTrue();
    expect(current().segments[1].recurrence.startDate).toBe('2026-01-05');
    expect(
      service.editEntire(
        id,
        { recurrence: { ...input.recurrence, endDate: '2026-01-02' } },
        'retain',
      ).ok,
    ).toBeTrue();
    expect(items('2027-05-01', '2027-05-02')).toEqual([]);
    expect(exceptions.entities()[exception.id]).toEqual(exception);
    service.editEntire(id, { recurrence: input.recurrence }, 'retain');
    expect(
      items('2027-05-01', '2027-05-02').filter((i) => i.occurrence.slot === 4).length,
    ).toBe(1);
  });
  it('suppresses tombstones and all late exceptions and updates, including delete-before-create replay', () => {
    const original = current();
    exceptions.edit(
      { seriesId: id, slot: 4 },
      { title: 'Override', isAllDay: true, date: '2027-05-01' },
    );
    expect(service.deleteEntire(id)).toBeTrue();
    expect(service.deleteEntire(id)).toBeTrue();
    exceptions.edit(
      { seriesId: id, slot: 4 },
      { title: 'Late', isAllDay: true, date: '2027-05-01' },
    );
    expect(items()).toEqual([]);
    expect(items('2027-05-01', '2027-05-02')).toEqual([]);
    expect(resolveEventOccurrence(current(), { seriesId: id, slot: 4 })).toBeNull();
    expect(service.editEntire(id, input)).toEqual({ ok: false, reason: 'unavailable' });
    const tombstone = deleteEventSeries({ eventSeries: current() });
    const deleted = eventSeriesReducer(undefined, tombstone);
    expect(
      eventSeriesReducer(deleted, addEventSeries({ eventSeries: original })),
    ).toEqual(deleted);
    expect(
      eventSeriesReducer(
        deleted,
        updateEventSeries({ id, changes: input, modified: Date.now() + 10000 }),
      ),
    ).toEqual(deleted);
    expect(
      eventSeriesReducer(deleted, { ...original, type: '[EVENT_SERIES] LWW Update' }),
    ).toEqual(deleted);
    expect(service.create(input)).not.toBe(id);
  });
  it('validates offset ownership, IDs, timing, title and tombstone consistency', () => {
    service.editThisAndFuture(id, 4, { recurrence: weekly });
    const valid = current();
    expect(isValidEventSeries(valid)).toBeTrue();
    const [a, b] = valid.segments;
    for (const segments of [
      [],
      [b],
      [a, { ...b, logicalSlotOffset: 0 }],
      [a, { ...b, logicalSlotOffset: -1 }],
      [a, { ...b, logicalSlotOffset: 1.5 }],
      [a, { ...b, logicalSlotOffset: Number.MAX_SAFE_INTEGER }],
      [a, { ...b, logicalSlotOffset: Number.MAX_SAFE_INTEGER + 1 }],
      [a, { ...b, id: a.id }],
      [a, { ...b, title: '' }],
      [a, { ...b, unexpected: true }],
      [b, a],
    ]) {
      expect(isValidEventSeriesPlan({ title: valid.title, segments })).toBeFalse();
    }
    expect(isValidEventSeries({ ...valid, deletedAt: valid.modified + 1 })).toBeFalse();
    expect(service.editThisAndFuture(id, -1, input).ok).toBeFalse();
    expect(
      service.editThisAndFuture(id, 0, { timing: { kind: 'timed' } } as never).ok,
    ).toBeFalse();
  });
  it('round-trips complete multi-segment plans and tombstones through backups and IndexedDB reload', async () => {
    service.editThisAndFuture(id, 4, { recurrence: weekly });
    service.editThisAndFuture(id, 7, { recurrence: monthly });
    const plan: EventSeriesPlan = {
      title: current().title,
      segments: current().segments,
    };
    const action = replaceEventSeriesPlan({ id, plan, modified: current().modified });
    const { type, meta, ...actionPayload } = action;
    const op = new TestClient('sender').createOperation({
      actionType: type,
      entityType: meta.entityType,
      entityId: id,
      opType: meta.opType,
      payload: { actionPayload, entityChanges: [] },
    });
    expect(validateOperationPayload(op).success).toBeTrue();
    const state = eventSeriesReducer(
      undefined,
      addEventSeries({ eventSeries: current() }),
    );
    expect(eventSeriesReducer(state, convertOpToAction(op))).toEqual(state);
    const before = items();
    const log = TestBed.inject(OperationLogStoreService);
    await log.init();
    await log._clearAllDataForTesting();
    try {
      await log.append(op, 'local');
      await log.appendBatchSkipDuplicates([op, op], 'remote');
      service.deleteEntire(id);
      const data = createValidAppData({
        eventSeries: {
          ids: [id],
          entities: { [id]: current() },
        },
      });
      expect(validateFull(data).isValid).toBeTrue();
      const restored = readFullStateBackup(
        JSON.parse(JSON.stringify(protectFullStateBackup(data))),
      );
      expect(restored.eventSeries).toEqual(data.eventSeries);
      await log.saveStateCache({
        state: data,
        lastAppliedOpSeq: 1,
        vectorClock: { sender: 1 },
        compactedAt: 100,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideStore({ eventSeries: eventSeriesReducer })],
      });
      const reopened = TestBed.inject(OperationLogStoreService);
      await reopened.init();
      const cache = (await reopened.loadStateCache())!;
      const reloaded = eventSeriesReducer(
        undefined,
        loadAllData({ appDataComplete: cache.state as typeof data }),
      );
      expect(reloaded).toEqual(data.eventSeries!);
      expect(
        projectEventOccurrences(
          [reloaded.entities[id]!],
          { fromDate: '2026-01-01', toDateExclusive: '2027-01-01' },
          'UTC',
        ),
      ).toEqual([]);
      const rows = await reopened.getOpsAfterSeq(0);
      expect(rows.length).toBe(1);
      const replayed = eventSeriesReducer(state, convertOpToAction(rows[0].op));
      expect(
        projectEventOccurrences(
          [replayed.entities[id]!],
          { fromDate: '2026-01-01', toDateExclusive: '2027-01-01' },
          'UTC',
        ),
      ).toEqual(before);
      await reopened._clearAllDataForTesting();
    } finally {
      await log._clearAllDataForTesting();
    }
  });
});
