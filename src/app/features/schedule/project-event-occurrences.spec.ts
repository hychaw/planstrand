import { EventSeries } from '../routines/event-series.model';
import { RecurrenceSpec } from '../routines/recurrence/recurrence-candidates';
import { RecurrenceTiming } from '../routines/recurrence/recurrence-evaluation';
import { projectEventOccurrences } from './project-event-occurrences';
import { EventOccurrenceDisplayItem } from './calendar-display-item.model';

describe('bounded Event occurrence projection', () => {
  const hour = 3600000;
  const makeSeries = (
    recurrence: RecurrenceSpec = {
      frequency: 'daily',
      startDate: '2026-01-01',
      interval: 1,
    },
    timing: RecurrenceTiming = { kind: 'allDay' },
    id = 'series',
  ): EventSeries => ({
    id,
    title: 'Routine',
    created: 1,
    modified: 1,
    segments: [{ id: 'segment', recurrence, timing }],
  });
  const timed = (
    timeZone = 'UTC',
    localTime = '09:00',
    durationMs = hour,
  ): RecurrenceTiming => ({ kind: 'timed', localTime, timeZone, durationMs });
  const project = (
    series: EventSeries[],
    fromDate: string,
    toDateExclusive: string,
    zone = 'UTC',
  ): EventOccurrenceDisplayItem[] =>
    projectEventOccurrences(series, { fromDate, toDateExclusive }, zone);

  it('seeks daily intervals and keeps floating dates and stable lineage/slot identities', () => {
    const series = makeSeries({
      frequency: 'daily',
      startDate: '2026-01-01',
      interval: 2,
    });
    const items = project([series], '2026-01-05', '2026-01-10');
    expect(items.map((item) => [item.date, item.occurrence.slot])).toEqual([
      ['2026-01-05', 2],
      ['2026-01-07', 3],
      ['2026-01-09', 4],
    ]);
    expect(items[0].sourceType).toBe('eventOccurrence');
    expect(items[0].sourceId).toBe(series.id);
    expect(items[0].title).toBe(series.title);
    expect(items[0].occurrence.segmentId).toBe('segment');
    expect(
      items.every((item) => item.isAllDay && item.timeZone === undefined),
    ).toBeTrue();
    const narrow = project([series], '2026-01-07', '2026-01-08', 'Pacific/Auckland');
    expect(narrow[0]).toEqual(items[1]);
    const renamed = project(
      [{ ...series, title: 'Renamed' }],
      '2026-01-07',
      '2026-01-08',
    );
    expect(renamed[0].id).toBe(items[1].id);
    expect(renamed[0].occurrence.key).toBe(items[1].occurrence.key);
  });

  it('uses the weekly engine phase and weekday order', () => {
    const series = makeSeries({
      frequency: 'weekly',
      startDate: '2026-01-07',
      interval: 2,
      weekdays: [5, 1, 3],
    });
    expect(
      project([series], '2026-01-01', '2026-01-24').map((item) => [
        item.date,
        item.occurrence.slot,
      ]),
    ).toEqual([
      ['2026-01-07', 0],
      ['2026-01-09', 1],
      ['2026-01-19', 2],
      ['2026-01-21', 3],
      ['2026-01-23', 4],
    ]);
  });

  it('keeps monthly missing-date slots reserved', () => {
    const series = makeSeries({
      frequency: 'monthly',
      startDate: '2024-01-31',
      interval: 1,
    });
    expect(
      project([series], '2024-01-01', '2024-06-01').map((item) => [
        item.date,
        item.occurrence.slot,
      ]),
    ).toEqual([
      ['2024-01-31', 0],
      ['2024-03-31', 2],
      ['2024-05-31', 4],
    ]);
  });

  it('honors inclusive series ends, half-open ranges, and empty or disjoint windows', () => {
    const series = makeSeries({
      frequency: 'daily',
      startDate: '2026-01-03',
      endDate: '2026-01-05',
      interval: 1,
    });
    expect(
      project([series], '2026-01-01', '2026-01-10').map((item) => item.date),
    ).toEqual(['2026-01-03', '2026-01-04', '2026-01-05']);
    for (const [from, to] of [
      ['2026-01-01', '2026-01-03'],
      ['2026-01-06', '2026-01-08'],
      ['2026-01-04', '2026-01-04'],
    ]) {
      expect(project([series], from, to)).toEqual([]);
    }
  });

  it('projects timed daily, weekly, and monthly rules in their scheduling zone', () => {
    for (const recurrence of [
      { frequency: 'daily', startDate: '2026-01-10', interval: 1 },
      { frequency: 'weekly', startDate: '2026-01-10', interval: 1, weekdays: [6] },
      { frequency: 'monthly', startDate: '2026-01-10', interval: 1 },
    ] as RecurrenceSpec[]) {
      const item = project(
        [makeSeries(recurrence, timed('Asia/Tokyo'))],
        '2026-01-10',
        '2026-01-11',
      )[0];
      expect(item.start).toBe(Date.parse('2026-01-10T00:00:00Z'));
      expect(item.end).toBe(item.start + hour);
      expect(item.timeZone).toBe('Asia/Tokyo');
      expect(item.date).toBeUndefined();
      expect(item.isAllDay).toBeFalse();
      expect(item.occurrence.scheduledDate).toBe('2026-01-10');
    }
  });

  it('includes starts before the window with overnight and multi-day elapsed durations', () => {
    const series = makeSeries(
      { frequency: 'daily', startDate: '2026-01-01', endDate: '2026-01-01', interval: 1 },
      timed('UTC', '23:00', 50 * hour),
    );
    for (const day of ['2026-01-01', '2026-01-02', '2026-01-03']) {
      const item = project(
        [series],
        day,
        `${day.slice(0, 8)}${String(Number(day.slice(8)) + 1).padStart(2, '0')}`,
      )[0];
      expect(item.start).toBe(Date.parse('2026-01-01T23:00:00Z'));
      expect(item.end).toBe(Date.parse('2026-01-04T01:00:00Z'));
      expect(item.occurrence.slot).toBe(0);
      expect(item.id).toBe(project([series], '2026-01-01', '2026-01-05')[0].id);
    }
    expect(project([series], '2026-01-05', '2026-01-06')).toEqual([]);
  });

  it('excludes ends at the window start and starts at its exclusive end', () => {
    const recurrence: RecurrenceSpec = {
      frequency: 'daily',
      startDate: '2026-01-01',
      interval: 1,
    };
    const items = project(
      [makeSeries(recurrence, timed('UTC', '23:00'))],
      '2026-01-02',
      '2026-01-03',
    );
    expect(items.length).toBe(1);
    expect(items[0].occurrence.scheduledDate).toBe('2026-01-02');
    const midnight = project(
      [makeSeries(recurrence, timed('UTC', '00:00'))],
      '2026-01-02',
      '2026-01-03',
    );
    expect(midnight.length).toBe(1);
    expect(midnight[0].occurrence.slot).toBe(1);
  });

  it('retains every overlapping occurrence when duration exceeds the recurrence interval', () => {
    const items = project(
      [makeSeries(undefined, timed('UTC', '12:00', 72 * hour))],
      '2026-01-10',
      '2026-01-11',
    );
    expect(items.map((item) => item.occurrence.scheduledDate)).toEqual([
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
      '2026-01-10',
    ]);
  });

  it('preserves engine gap skipping and earliest-fold policies without renumbering', () => {
    const gap = project(
      [
        makeSeries(
          { frequency: 'daily', startDate: '2026-03-07', interval: 1 },
          timed('America/Vancouver', '02:30'),
        ),
      ],
      '2026-03-07',
      '2026-03-10',
    );
    expect(gap.map((item) => item.occurrence.slot)).toEqual([0, 2]);
    expect(gap.map((item) => item.start)).toEqual([
      Date.parse('2026-03-07T10:30:00Z'),
      Date.parse('2026-03-09T09:30:00Z'),
    ]);
    const fold = project(
      [
        makeSeries(
          {
            frequency: 'daily',
            startDate: '2026-11-01',
            endDate: '2026-11-01',
            interval: 1,
          },
          timed('America/Vancouver', '01:30', 2 * hour),
        ),
      ],
      '2026-11-01',
      '2026-11-02',
    )[0];
    expect(fold.start).toBe(Date.parse('2026-11-01T08:30:00Z'));
    expect(fold.end).toBe(Date.parse('2026-11-01T10:30:00Z'));
  });

  it('changes display dates without changing source identity or instants', () => {
    const series = makeSeries(
      { frequency: 'daily', startDate: '2026-01-10', endDate: '2026-01-10', interval: 1 },
      timed('Asia/Tokyo'),
    );
    const utc = project([series], '2026-01-10', '2026-01-11')[0];
    const la = project([series], '2026-01-09', '2026-01-10', 'America/Los_Angeles')[0];
    expect(utc).toEqual(la);
    expect(project([series], '2026-01-10', '2026-01-11', 'America/Los_Angeles')).toEqual(
      [],
    );
  });

  it('seeks into old unbounded rules for a small window', () => {
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      const recurrence = {
        frequency,
        startDate: '1900-01-01',
        interval: 1,
        ...(frequency === 'weekly' ? { weekdays: [1, 2, 3, 4, 5, 6, 7] } : {}),
      } as RecurrenceSpec;
      const items = project(
        [makeSeries(recurrence, timed())],
        '2026-01-01',
        '2026-01-02',
      );
      expect(items.length).toBe(1);
      expect(items[0].occurrence.slot).toBeGreaterThan(1000);
      expect(items[0].occurrence.scheduledDate).toBe('2026-01-01');
    }
  });

  it('does not silently cap larger valid ranges', () => {
    const items = project(
      [makeSeries({ frequency: 'daily', startDate: '1900-01-01', interval: 1 })],
      '2024-01-01',
      '2027-01-01',
    );
    expect(items.length).toBe(1096);
    expect(items.at(-1)?.date).toBe('2026-12-31');
  });

  it('orders deterministically, deduplicates identities and separates series/segments', () => {
    const a = makeSeries(undefined, timed(), 'a');
    const b = makeSeries(undefined, timed(), 'b');
    const items = project([b, a, b], '2026-01-01', '2026-01-03');
    expect(items).toEqual(project([a, b], '2026-01-01', '2026-01-03'));
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
    const changedSegment = {
      ...a,
      segments: [{ ...a.segments[0], id: 'other' }],
    } as EventSeries;
    expect(project([a, changedSegment], '2026-01-01', '2026-01-02').length).toBe(2);
  });

  it('sets read-only permissions and leaves persisted definitions untouched', () => {
    const series = makeSeries(undefined, timed());
    const snapshot = JSON.stringify(series);
    const items = project([series], '2026-01-01', '2026-01-08');
    expect(JSON.stringify(series)).toBe(snapshot);
    expect(
      items.every(
        (item) => !item.canMove && !item.canResize && !item.canDelete && item.isReadOnly,
      ),
    ).toBeTrue();
  });

  it('rejects invalid windows and explicit invalid zones', () => {
    for (const [from, to, zone] of [
      ['2026-01-02', '2026-01-01', 'UTC'],
      ['2026-02-30', '2026-03-01', 'UTC'],
      ['2026-01-01', '2026-01-02', 'Missing/Zone'],
      ['2026-01-01', '2026-01-02', '+01:00'],
    ])
      expect(() => project([], from, to, zone)).toThrowError(RangeError);
  });

  it('refuses an unsupported upper candidate bound explicitly instead of truncating', () => {
    expect(() =>
      project([makeSeries(undefined, timed())], '9999-12-30', '9999-12-31'),
    ).toThrowError(RangeError, /supported civil-date range/);
  });
});
