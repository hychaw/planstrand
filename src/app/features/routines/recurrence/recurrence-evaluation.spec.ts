import { getRecurrenceCandidates, RecurrenceCandidate } from './recurrence-candidates';
import {
  evaluateRecurrenceCandidate,
  RecurrenceOccurrence,
  RecurrenceTiming,
} from './recurrence-evaluation';

describe('recurrence occurrence evaluation', () => {
  const timed = (
    localTime = '09:00',
    timeZone = 'America/Vancouver',
    durationMs = 3600000,
  ): Extract<RecurrenceTiming, { kind: 'timed' }> => ({
    kind: 'timed',
    localTime,
    timeZone,
    durationMs,
  });
  const evaluate = (
    date: string,
    timing = timed(),
    slot = 0,
  ): RecurrenceOccurrence | null => evaluateRecurrenceCandidate({ date, slot }, timing);
  const starts = (
    fromDate: string,
    toDateExclusive: string,
    timing: RecurrenceTiming,
  ): unknown[] =>
    getRecurrenceCandidates(
      { frequency: 'daily', startDate: fromDate, interval: 1 },
      { fromDate, toDateExclusive },
    ).map((candidate) => {
      const occurrence = evaluateRecurrenceCandidate(candidate, timing);
      return occurrence?.kind === 'timed'
        ? { date: occurrence.date, slot: occurrence.slot, start: occurrence.start }
        : occurrence;
    });

  it('returns explicit scheduled identity, zone and elapsed timestamps', () => {
    expect(evaluate('2026-01-15', timed(), 7)).toEqual({
      kind: 'timed',
      date: '2026-01-15',
      slot: 7,
      localTime: '09:00',
      timeZone: 'America/Vancouver',
      start: Date.parse('2026-01-15T17:00:00Z'),
      end: Date.parse('2026-01-15T18:00:00Z'),
    });
  });

  it('skips Vancouver spring gaps and preserves the subsequent slot', () => {
    expect(starts('2026-03-07', '2026-03-10', timed('02:30'))).toEqual([
      { date: '2026-03-07', slot: 0, start: Date.parse('2026-03-07T10:30:00Z') },
      null,
      { date: '2026-03-09', slot: 2, start: Date.parse('2026-03-09T09:30:00Z') },
    ]);
  });

  it('chooses exactly the earlier Vancouver fold instant in 2025', () => {
    expect(starts('2025-11-01', '2025-11-04', timed('01:30'))).toEqual([
      { date: '2025-11-01', slot: 0, start: Date.parse('2025-11-01T08:30:00Z') },
      { date: '2025-11-02', slot: 1, start: Date.parse('2025-11-02T08:30:00Z') },
      { date: '2025-11-03', slot: 2, start: Date.parse('2025-11-03T09:30:00Z') },
    ]);
  });

  it('evaluates Vancouver November 1, 2026 without assuming an obsolete fold', () => {
    // B.C. now stays on UTC-7 after March 2026. Older tzdb predicts a fold here;
    // both versions resolve 01:30 to 08:30Z under the earlier-instant policy.
    expect(evaluate('2026-11-01', timed('01:30'))).toEqual(
      jasmine.objectContaining({ start: Date.parse('2026-11-01T08:30:00Z') }),
    );
  });

  it('chooses exactly the earlier Los Angeles fold instant in 2026', () => {
    expect(
      starts('2026-10-31', '2026-11-03', timed('01:30', 'America/Los_Angeles')),
    ).toEqual([
      { date: '2026-10-31', slot: 0, start: Date.parse('2026-10-31T08:30:00Z') },
      { date: '2026-11-01', slot: 1, start: Date.parse('2026-11-01T08:30:00Z') },
      { date: '2026-11-02', slot: 2, start: Date.parse('2026-11-02T09:30:00Z') },
    ]);
  });

  it('chooses the earlier fold in positive-offset zones as well', () => {
    expect(evaluate('2026-10-25', timed('02:30', 'Europe/Berlin'))).toEqual(
      jasmine.objectContaining({
        start: Date.parse('2026-10-25T00:30:00Z'),
      }),
    );
  });

  it('maintains local start clocks rather than adding fixed UTC days', () => {
    expect(starts('2026-03-07', '2026-03-10', timed())).toEqual([
      { date: '2026-03-07', slot: 0, start: Date.parse('2026-03-07T17:00:00Z') },
      { date: '2026-03-08', slot: 1, start: Date.parse('2026-03-08T16:00:00Z') },
      { date: '2026-03-09', slot: 2, start: Date.parse('2026-03-09T16:00:00Z') },
    ]);
  });

  it('supports overnight elapsed durations', () => {
    expect(evaluate('2026-01-15', timed('23:30', 'America/Vancouver', 7200000))).toEqual(
      jasmine.objectContaining({
        date: '2026-01-15',
        start: Date.parse('2026-01-16T07:30:00Z'),
        end: Date.parse('2026-01-16T09:30:00Z'),
      }),
    );
  });

  it('preserves elapsed duration across spring and fall transitions', () => {
    expect(evaluate('2026-03-08', timed('01:30', 'America/Vancouver', 7200000))).toEqual(
      jasmine.objectContaining({
        start: Date.parse('2026-03-08T09:30:00Z'),
        end: Date.parse('2026-03-08T11:30:00Z'),
      }),
    );
    expect(evaluate('2025-11-02', timed('01:30', 'America/Vancouver', 7200000))).toEqual(
      jasmine.objectContaining({
        start: Date.parse('2025-11-02T08:30:00Z'),
        end: Date.parse('2025-11-02T10:30:00Z'),
      }),
    );
  });

  it('supports non-hour offsets', () => {
    expect(evaluate('2026-01-15', timed('09:15', 'Asia/Kathmandu'))).toEqual(
      jasmine.objectContaining({
        start: Date.parse('2026-01-15T03:30:00Z'),
      }),
    );
  });

  it('preserves historical offset seconds', () => {
    expect(evaluate('1900-01-01', timed('09:00', 'Europe/Paris'))).toEqual(
      jasmine.objectContaining({ start: Date.parse('1900-01-01T08:50:39Z') }),
    );
  });

  it('accepts finite positive fractional elapsed milliseconds', () => {
    expect(evaluate('2026-01-15', timed('09:00', 'UTC', 1.5))).toEqual(
      jasmine.objectContaining({
        start: Date.parse('2026-01-15T09:00:00Z'),
        end: Date.parse('2026-01-15T09:00:00Z') + 1.5,
      }),
    );
  });

  it('supports Lord Howe half-hour folds and gaps', () => {
    expect(evaluate('2026-04-05', timed('01:45', 'Australia/Lord_Howe'))).toEqual(
      jasmine.objectContaining({
        start: Date.parse('2026-04-04T14:45:00Z'),
      }),
    );
    expect(evaluate('2026-10-04', timed('02:15', 'Australia/Lord_Howe'))).toBeNull();
    expect(evaluate('2026-10-04', timed('02:30', 'Australia/Lord_Howe'))).toEqual(
      jasmine.objectContaining({
        start: Date.parse('2026-10-03T15:30:00Z'),
      }),
    );
  });

  it('skips an entire date removed by a date-line transition', () => {
    expect(evaluate('2011-12-30', timed('12:00', 'Pacific/Apia'))).toBeNull();
    expect(evaluate('2011-12-31', timed('12:00', 'Pacific/Apia'))).toEqual(
      jasmine.objectContaining({
        start: Date.parse('2011-12-30T22:00:00Z'),
      }),
    );
  });

  it('handles UTC midnight and years 0000–0099', () => {
    for (const date of ['0000-01-01', '0099-12-31', '2026-01-01', '9999-12-30']) {
      expect(evaluate(date, timed('00:00', 'UTC'))).toEqual(
        jasmine.objectContaining({
          start: Date.parse(`${date}T00:00:00Z`),
        }),
      );
    }
  });

  it('ignores system/display timezone and does not mutate inputs', () => {
    spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').and.throwError(
      'System zone access',
    );
    for (const method of [
      'getFullYear',
      'getMonth',
      'getDate',
      'getDay',
      'getTimezoneOffset',
    ] as const) {
      spyOn(Date.prototype, method).and.throwError('Local timezone access');
    }
    const candidate = Object.freeze({ date: '2026-11-01', slot: 9 });
    const timing = Object.freeze(timed('01:30'));
    expect(evaluateRecurrenceCandidate(candidate, timing)).toEqual(
      jasmine.objectContaining({
        date: '2026-11-01',
        slot: 9,
        start: Date.parse('2026-11-01T08:30:00Z'),
      }),
    );
    expect(candidate).toEqual({ date: '2026-11-01', slot: 9 });
    expect(timing).toEqual(timed('01:30'));
  });

  it('leaves all-day dates floating, including dates with nonexistent local times', () => {
    spyOn(Intl, 'DateTimeFormat').and.throwError('All-day must not use timezones');
    for (const date of ['2026-03-08', '2026-11-01', '2011-12-30']) {
      expect(evaluateRecurrenceCandidate({ date, slot: 4 }, { kind: 'allDay' })).toEqual({
        kind: 'allDay',
        date,
        slot: 4,
      });
    }
  });

  it('retains monthly reserved slots through timed evaluation', () => {
    const candidates = getRecurrenceCandidates(
      { frequency: 'monthly', startDate: '2026-01-31', interval: 1 },
      { fromDate: '2026-01-01', toDateExclusive: '2026-04-01' },
    );
    expect(
      candidates.map((candidate) => evaluateRecurrenceCandidate(candidate, timed())),
    ).toEqual([
      jasmine.objectContaining({
        slot: 0,
        date: '2026-01-31',
        start: Date.parse('2026-01-31T17:00:00Z'),
      }),
      jasmine.objectContaining({
        slot: 2,
        date: '2026-03-31',
        start: Date.parse('2026-03-31T16:00:00Z'),
      }),
    ]);
  });

  const invalidTimings: unknown[] = [
    null,
    {},
    { kind: 'floating' },
    ...['', 'Invalid/Zone', '+05:45', '-08:00', undefined, null].map((timeZone) => ({
      ...timed(),
      timeZone,
    })),
    ...['9:00', '24:00', '09:60', '09:00:00', '09:00\n', '', undefined, null].map(
      (localTime) => ({
        ...timed(),
        localTime,
      }),
    ),
    ...[0, -1, NaN, Infinity, '3600000', undefined, null, 1e20, Number.MIN_VALUE].map(
      (durationMs) => ({ ...timed(), durationMs }),
    ),
  ];
  invalidTimings.forEach((timing, index) => {
    it(`rejects invalid timing ${index} with RangeError`, () => {
      expect(() =>
        evaluateRecurrenceCandidate(
          { date: '2026-01-15', slot: 0 },
          timing as RecurrenceTiming,
        ),
      ).toThrowError(RangeError);
    });
  });

  [
    null,
    {},
    { date: '2026-02-30', slot: 0 },
    { date: '2026-1-15', slot: 0 },
    ...[-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1].map((slot) => ({
      date: '2026-01-15',
      slot,
    })),
  ].forEach((candidate, index) => {
    it(`rejects invalid candidate ${index} for timed and all-day evaluation`, () => {
      for (const timing of [timed(), { kind: 'allDay' } as const]) {
        expect(() =>
          evaluateRecurrenceCandidate(candidate as RecurrenceCandidate, timing),
        ).toThrowError(RangeError);
      }
    });
  });
});
