import { EventInput } from '../event/event.model';
import { EventSeries } from '../routines/event-series.model';
import {
  OccurrenceException,
  OccurrenceExceptionValue,
} from '../routines/occurrence-exception.model';
import { occurrenceExceptionId } from '../routines/occurrence-exception.validation';
import { occurrenceExceptionReducer } from '../routines/store/occurrence-exception.reducer';
import { setOccurrenceException } from '../routines/store/occurrence-exception.actions';
import { projectEventOccurrences } from './project-event-occurrences';
import { EventOccurrenceDisplayItem } from './calendar-display-item.model';

describe('exception-aware Event occurrence projection', () => {
  const series: EventSeries = {
    id: 'series',
    title: 'Original',
    created: 1,
    modified: 1,
    segments: [
      {
        id: 'segment',
        recurrence: {
          frequency: 'daily',
          startDate: '2026-01-05',
          endDate: '2026-01-07',
          interval: 1,
        },
        timing: { kind: 'allDay' },
      },
    ],
  };
  const exception = (
    slot: number,
    value: OccurrenceExceptionValue,
    seriesId = series.id,
  ): OccurrenceException => ({
    id: occurrenceExceptionId({ seriesId, slot }),
    seriesId,
    slot,
    value,
    modified: 2,
  });
  const allDay = (date: string, title = 'Edited'): EventInput => ({
    title,
    isAllDay: true,
    date,
  });
  const timed = (start: string, end: string, timeZone = 'UTC'): EventInput => ({
    title: 'Timed edit',
    isAllDay: false,
    start: Date.parse(start),
    end: Date.parse(end),
    timeZone,
  });
  const project = (
    exceptions: readonly OccurrenceException[] = [],
    fromDate = '2026-01-01',
    toDateExclusive = '2026-02-01',
    sources: readonly EventSeries[] = [series],
    zone = 'UTC',
  ): EventOccurrenceDisplayItem[] =>
    projectEventOccurrences(sources, { fromDate, toDateExclusive }, zone, exceptions);

  it('keeps no-exception and inherit originals, suppresses cancellation, and replaces overrides', () => {
    const original = project();
    expect(project([exception(0, { kind: 'inherit' })])).toEqual(original);
    expect(
      project([exception(0, { kind: 'cancelled' })]).map((item) => item.occurrence.slot),
    ).toEqual([1, 2]);
    const edited = project([
      exception(0, { kind: 'override', event: allDay('2026-01-07') }),
    ]);
    expect(edited.length).toBe(3);
    const item = edited.find((value) => value.occurrence.slot === 0)!;
    expect(item.title).toBe('Edited');
    expect(item.date).toBe('2026-01-07');
    expect(item.id).toBe(original[0].id);
    expect(item.occurrence).toEqual(original[0].occurrence);
    expect(edited.filter((value) => value.date === '2026-01-05')).toEqual([]);
    expect(new Set(edited.map((value) => value.id)).size).toBe(3);
  });

  it('projects repeated complete edits, cancellation and restoration under one identity', () => {
    let state = occurrenceExceptionReducer(undefined, { type: 'init' });
    const original = project()[0];
    for (const event of [
      allDay('2026-02-10'),
      timed('2026-02-11T23:00:00Z', '2026-02-13T00:00:00Z', 'Europe/Berlin'),
      allDay('2026-01-06', 'Back to all-day'),
    ]) {
      const entry = exception(0, { kind: 'override', event });
      state = occurrenceExceptionReducer(
        state,
        setOccurrenceException({ occurrenceException: entry }),
      );
      expect(state.ids.length).toBe(1);
      const items = project(
        Object.values(state.entities) as OccurrenceException[],
        '2026-01-01',
        '2026-03-01',
      );
      const item = items.find((value) => value.occurrence.slot === 0)!;
      expect(item.id).toBe(original.id);
      expect(item.occurrence).toEqual(original.occurrence);
      expect(item.isAllDay).toBe(event.isAllDay);
      if (event.isAllDay) {
        expect(item.date).toBe(event.date);
        expect(item.timeZone).toBeUndefined();
      } else {
        expect(item.start).toBe(event.start);
        expect(item.end).toBe(event.end);
        expect(item.timeZone).toBe(event.timeZone);
        expect(item.date).toBeUndefined();
      }
    }
    state = occurrenceExceptionReducer(
      state,
      setOccurrenceException({
        occurrenceException: exception(0, { kind: 'cancelled' }),
      }),
    );
    expect(project(Object.values(state.entities) as OccurrenceException[]).length).toBe(
      2,
    );
    state = occurrenceExceptionReducer(
      state,
      setOccurrenceException({ occurrenceException: exception(0, { kind: 'inherit' }) }),
    );
    expect(project(Object.values(state.entities) as OccurrenceException[])).toEqual(
      project(),
    );
  });

  it('finds moved-in overrides outside recurrence bounds and removes moved-out originals', () => {
    for (const event of [
      allDay('2028-06-01'),
      timed('2028-06-01T09:00:00Z', '2028-06-01T10:00:00Z'),
    ]) {
      const exceptions = [exception(0, { kind: 'override', event })];
      const before = JSON.stringify([series, exceptions]);
      expect(project(exceptions).map((item) => item.occurrence.slot)).toEqual([1, 2]);
      const moved = project(exceptions, '2028-01-01', '2029-01-01');
      expect(moved.length).toBe(1);
      expect(moved[0].id).toBe(project()[0].id);
      expect(moved[0].occurrence.scheduledDate).toBe('2026-01-05');
      expect(JSON.stringify([series, exceptions])).toBe(before);
    }
    const future = {
      ...series,
      segments: [
        {
          ...series.segments[0],
          recurrence: {
            frequency: 'daily' as const,
            startDate: '2029-01-01',
            endDate: '2029-01-01',
            interval: 1,
          },
        },
      ],
    } as EventSeries;
    expect(
      project(
        [exception(0, { kind: 'override', event: allDay('2026-01-10') })],
        '2026-01-01',
        '2027-01-01',
        [future],
      )[0].occurrence.scheduledDate,
    ).toBe('2029-01-01');
  });

  it('keeps floating all-day overrides invariant across display timezones', () => {
    const exceptions = [exception(0, { kind: 'override', event: allDay('2026-02-01') })];
    const utc = project(exceptions, '2026-02-01', '2026-02-02');
    for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
      expect(project(exceptions, '2026-02-01', '2026-02-02', [series], zone)).toEqual(
        utc,
      );
      expect(project(exceptions, '2026-01-31', '2026-02-01', [series], zone)).toEqual([]);
    }
  });

  it('uses actual override instants through DST, overnight overlaps and display-zone changes', () => {
    const exceptions = [
      exception(0, {
        kind: 'override',
        event: timed('2026-03-08T07:30:00Z', '2026-03-10T00:00:00Z', 'America/New_York'),
      }),
    ];
    const whole = project(exceptions, '2026-03-01', '2026-04-01');
    for (const day of ['2026-03-08', '2026-03-09']) {
      expect(
        project(exceptions, day, day === '2026-03-08' ? '2026-03-09' : '2026-03-10'),
      ).toEqual(whole);
    }
    expect(project(exceptions, '2026-03-10', '2026-03-11')).toEqual([]);
    expect(
      project(exceptions, '2026-03-07', '2026-03-08', [series], 'America/Los_Angeles'),
    ).toEqual(whole);
    expect(whole[0].start).toBe(Date.parse('2026-03-08T07:30:00Z'));
    expect(whole[0].timeZone).toBe('America/New_York');
    const fold = [
      exception(0, {
        kind: 'override',
        event: timed('2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z', 'America/New_York'),
      }),
    ];
    expect(project(fold, '2026-11-01', '2026-11-02')[0].start).toBe(
      Date.parse('2026-11-01T06:30:00Z'),
    );
  });

  it('leaves orphan, out-of-bound, monthly missing-date and DST-gap exceptions unprojected', () => {
    const value: OccurrenceExceptionValue = {
      kind: 'override',
      event: allDay('2026-06-01'),
    };
    const orphan = exception(0, value, 'missing');
    const invalidSlot = exception(3, value);
    const snapshot = JSON.stringify([orphan, invalidSlot]);
    expect(project([orphan, invalidSlot], '2026-06-01', '2026-06-02')).toEqual([]);
    expect(JSON.stringify([orphan, invalidSlot])).toBe(snapshot);
    const monthly = {
      ...series,
      segments: [
        {
          ...series.segments[0],
          recurrence: {
            frequency: 'monthly' as const,
            startDate: '2026-01-31',
            interval: 1,
          },
        },
      ],
    } as EventSeries;
    expect(project([exception(1, value)], '2026-06-01', '2026-06-02', [monthly])).toEqual(
      [],
    );
    const gap = {
      ...series,
      segments: [
        {
          ...series.segments[0],
          recurrence: {
            frequency: 'daily' as const,
            startDate: '2026-03-08',
            endDate: '2026-03-08',
            interval: 1,
          },
          timing: {
            kind: 'timed' as const,
            localTime: '02:30',
            timeZone: 'America/New_York',
            durationMs: 3600000,
          },
        },
      ],
    } as EventSeries;
    expect(project([exception(0, value)], '2026-06-01', '2026-06-02', [gap])).toEqual([]);
  });

  it('resolves moved-in global slots with segment provenance and read-only permissions', () => {
    const offset = {
      ...series,
      segments: [{ ...series.segments[0], logicalSlotOffset: 40 }],
    } as EventSeries;
    const exceptions = [
      exception(40, { kind: 'override', event: allDay('2028-01-01') }),
      exception(39, { kind: 'override', event: allDay('2028-01-01') }),
    ];
    const items = project(exceptions, '2028-01-01', '2028-01-02', [offset]);
    expect(items.length).toBe(1);
    expect(items[0].occurrence).toEqual({
      slot: 40,
      segmentId: 'segment',
      scheduledDate: '2026-01-05',
      key: '["series",40]',
    });
    expect(items[0].isReadOnly).toBeTrue();
    expect(items[0].canMove || items[0].canResize || items[0].canDelete).toBeFalse();
  });

  it('projects stored orphans when the parent arrives without scanning historical recurrence', () => {
    const ancient: EventSeries = {
      ...series,
      segments: [
        {
          ...series.segments[0],
          recurrence: {
            frequency: 'daily',
            startDate: '0000-01-01',
            endDate: '0000-01-01',
            interval: 1,
          },
        },
      ],
    };
    const exceptions = [exception(0, { kind: 'override', event: allDay('2026-06-01') })];
    expect(project(exceptions, '2026-06-01', '2026-06-02', [])).toEqual([]);
    const conversions = spyOn(Date.prototype, 'setUTCFullYear').and.callThrough();
    const items = project(exceptions, '2026-06-01', '2026-06-02', [ancient]);
    expect(items.length).toBe(1);
    expect(items[0].occurrence.scheduledDate).toBe('0000-01-01');
    expect(conversions.calls.count()).toBeLessThan(12);
  });
});
