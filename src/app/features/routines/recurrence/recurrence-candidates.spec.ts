import {
  getRecurrenceCandidates,
  RecurrenceDateRange,
  RecurrenceSpec,
} from './recurrence-candidates';

describe('recurrence candidates', () => {
  const range = (fromDate: string, toDateExclusive: string): RecurrenceDateRange => ({
    fromDate,
    toDateExclusive,
  });
  const daily = (interval = 1): Extract<RecurrenceSpec, { frequency: 'daily' }> => ({
    frequency: 'daily',
    startDate: '2024-02-27',
    interval,
  });
  const weekly = (interval = 1): Extract<RecurrenceSpec, { frequency: 'weekly' }> => ({
    frequency: 'weekly',
    startDate: '2024-12-25', // Wednesday
    weekdays: [7, 1, 3],
    interval,
  });

  it('enumerates daily interval 1 across leap day, excluding the query end', () => {
    expect(getRecurrenceCandidates(daily(), range('2024-02-26', '2024-03-02'))).toEqual([
      { date: '2024-02-27', slot: 0 },
      { date: '2024-02-28', slot: 1 },
      { date: '2024-02-29', slot: 2 },
      { date: '2024-03-01', slot: 3 },
    ]);
  });

  it('seeks daily interval 2 without restarting slots at the query boundary', () => {
    expect(getRecurrenceCandidates(daily(2), range('2024-02-28', '2024-03-04'))).toEqual([
      { date: '2024-02-29', slot: 1 },
      { date: '2024-03-02', slot: 2 },
    ]);
  });

  it('supports larger daily intervals across years', () => {
    expect(
      getRecurrenceCandidates(
        { ...daily(366), startDate: '2023-01-01' },
        range('2023-01-01', '2025-01-03'),
      ),
    ).toEqual([
      { date: '2023-01-01', slot: 0 },
      { date: '2024-01-02', slot: 1 },
      { date: '2025-01-02', slot: 2 },
    ]);
  });

  it('sorts selected weekdays and excludes weekdays before a partial first week', () => {
    const spec = weekly();
    expect(getRecurrenceCandidates(spec, range('2024-12-01', '2025-01-06'))).toEqual([
      { date: '2024-12-25', slot: 0 },
      { date: '2024-12-29', slot: 1 },
      { date: '2024-12-30', slot: 2 },
      { date: '2025-01-01', slot: 3 },
      { date: '2025-01-05', slot: 4 },
    ]);
    expect(spec).toEqual(weekly());
  });

  it('anchors every-two-week phase to the start week Monday', () => {
    expect(getRecurrenceCandidates(weekly(2), range('2024-12-25', '2025-01-13'))).toEqual(
      [
        { date: '2024-12-25', slot: 0 },
        { date: '2024-12-29', slot: 1 },
        { date: '2025-01-06', slot: 2 },
        { date: '2025-01-08', slot: 3 },
        { date: '2025-01-12', slot: 4 },
      ],
    );
  });

  it('starts at slot zero when all selected days precede the start weekday', () => {
    expect(
      getRecurrenceCandidates(
        { ...weekly(3), weekdays: [1, 2] },
        range('2024-12-25', '2025-01-15'),
      ),
    ).toEqual([
      { date: '2025-01-13', slot: 0 },
      { date: '2025-01-14', slot: 1 },
    ]);
  });

  it('handles Monday and Sunday start boundaries', () => {
    for (const startDate of ['2024-12-23', '2024-12-29']) {
      const result = getRecurrenceCandidates(
        { ...weekly(), startDate },
        range(startDate, '2024-12-31'),
      );
      expect(result[0]).toEqual({ date: startDate, slot: 0 });
    }
  });

  it('includes the recurrence end date for daily and weekly rules', () => {
    expect(
      getRecurrenceCandidates(
        { ...daily(), endDate: '2024-02-29' },
        range('2024-02-29', '2024-03-10'),
      ),
    ).toEqual([{ date: '2024-02-29', slot: 2 }]);
    expect(
      getRecurrenceCandidates(
        { ...weekly(), endDate: '2024-12-29' },
        range('2024-12-29', '2025-02-01'),
      ),
    ).toEqual([{ date: '2024-12-29', slot: 1 }]);
  });

  it('supports a single-day series', () => {
    expect(
      getRecurrenceCandidates(
        { ...daily(), endDate: '2024-02-27' },
        range('2024-01-01', '2025-01-01'),
      ),
    ).toEqual([{ date: '2024-02-27', slot: 0 }]);
  });

  it('includes leap day in a weekly schedule and excludes an off-pattern end date', () => {
    expect(
      getRecurrenceCandidates(
        { ...weekly(), startDate: '2024-02-22', weekdays: [4] },
        range('2024-02-23', '2024-03-01'),
      ),
    ).toEqual([{ date: '2024-02-29', slot: 1 }]);
    expect(
      getRecurrenceCandidates(
        { ...daily(2), endDate: '2024-02-28' },
        range('2024-02-27', '2024-03-01'),
      ),
    ).toEqual([{ date: '2024-02-27', slot: 0 }]);
  });

  it('returns empty for empty, out-of-bounds and inactive-week queries', () => {
    expect(getRecurrenceCandidates(daily(), range('2024-02-29', '2024-02-29'))).toEqual(
      [],
    );
    expect(getRecurrenceCandidates(daily(), range('2024-01-01', '2024-02-27'))).toEqual(
      [],
    );
    expect(
      getRecurrenceCandidates(
        { ...daily(), endDate: '2024-03-01' },
        range('2024-03-02', '2024-04-01'),
      ),
    ).toEqual([]);
    expect(getRecurrenceCandidates(weekly(2), range('2024-12-30', '2025-01-06'))).toEqual(
      [],
    );
  });

  it('preserves identities across overlapping and disjoint windows', () => {
    for (const spec of [daily(2), weekly(2)]) {
      const whole = getRecurrenceCandidates(spec, range('2024-01-01', '2025-02-01'));
      const left = getRecurrenceCandidates(spec, range('2024-01-01', '2025-01-01'));
      const right = getRecurrenceCandidates(spec, range('2025-01-01', '2025-02-01'));
      expect([...left, ...right]).toEqual(whole);
      expect(getRecurrenceCandidates(spec, range('2024-12-28', '2025-01-10'))).toEqual(
        whole.filter(({ date }) => date >= '2024-12-28' && date < '2025-01-10'),
      );
    }
  });

  it('handles Gregorian century rules and years below 100', () => {
    for (const [startDate, nextDate, toDate] of [
      ['0000-02-28', '0000-02-29', '0000-03-01'],
      ['0099-12-31', '0100-01-01', '0100-01-02'],
      ['1900-02-28', '1900-03-01', '1900-03-02'],
      ['2000-02-28', '2000-02-29', '2000-03-01'],
    ]) {
      expect(
        getRecurrenceCandidates(
          { ...daily(), startDate },
          range(startDate, toDate),
        ).slice(0, 2),
      ).toEqual([
        { date: startDate, slot: 0 },
        { date: nextDate, slot: 1 },
      ]);
    }
  });

  it('uses no local timezone APIs or Intl services', () => {
    for (const method of [
      'getFullYear',
      'getMonth',
      'getDate',
      'getDay',
      'getTimezoneOffset',
    ] as const) {
      spyOn(Date.prototype, method).and.throwError('Local timezone access');
    }
    spyOn(Intl, 'DateTimeFormat').and.throwError('Timezone access');
    expect(getRecurrenceCandidates(weekly(), range('2024-12-25', '2024-12-30'))).toEqual([
      { date: '2024-12-25', slot: 0 },
      { date: '2024-12-29', slot: 1 },
    ]);
    expect(getRecurrenceCandidates(daily(), range('2024-02-29', '2024-03-01'))).toEqual([
      { date: '2024-02-29', slot: 2 },
    ]);
  });

  it('seeks millennia-old unbounded series with constant date-conversion work', () => {
    const conversions = spyOn(Date.prototype, 'setUTCFullYear').and.callThrough();
    const spec = { ...daily(), startDate: '0000-01-01' };
    const result = getRecurrenceCandidates(spec, range('9999-12-29', '9999-12-31'));
    expect(result.map(({ date }) => date)).toEqual(['9999-12-29', '9999-12-30']);
    expect(result[0].slot).toBe(3652422);
    expect(conversions.calls.count()).toBe(3);
    conversions.calls.reset();
    expect(
      getRecurrenceCandidates(
        { ...weekly(), startDate: '0000-01-01', weekdays: [1, 2, 3, 4, 5, 6, 7] },
        range('9999-12-29', '9999-12-31'),
      ),
    ).toEqual(result);
    expect(conversions.calls.count()).toBe(3);
  });

  it('supports very large safe integer intervals without overflowing date conversion', () => {
    for (const spec of [
      daily(Number.MAX_SAFE_INTEGER),
      weekly(Number.MAX_SAFE_INTEGER),
    ]) {
      expect(getRecurrenceCandidates(spec, range('9999-01-01', '9999-12-31'))).toEqual(
        [],
      );
    }
  });

  const invalidSpecs: unknown[] = [
    null,
    {},
    { ...daily(), frequency: 'monthly' },
    ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2'].map((interval) => ({
      ...daily(),
      interval,
    })),
    ...[
      '2024-2-01',
      '2023-02-29',
      '1900-02-29',
      '2024-04-31',
      '2024-00-01',
      '2024-13-01',
      '2024-01-00',
      '2024-01-01T00:00:00Z',
      '10000-01-01',
      '',
    ].map((startDate) => ({ ...daily(), startDate })),
    { ...daily(), endDate: null },
    { ...daily(), endDate: '2024-02-26' },
    { ...daily(), endDate: '2024-02-30' },
    ...[[], [0], [8], [1.5], [1, 1], ['1'], new Array(1), null, undefined].map(
      (weekdays) => ({
        ...weekly(),
        weekdays,
      }),
    ),
  ];
  invalidSpecs.forEach((spec, index) => {
    it(`rejects invalid recurrence specification ${index} even for an empty query`, () => {
      expect(() =>
        getRecurrenceCandidates(
          spec as RecurrenceSpec,
          range('2024-01-01', '2024-01-01'),
        ),
      ).toThrowError(RangeError);
    });
  });

  [
    null,
    {},
    range('2024-02-30', '2024-03-01'),
    range('2024-03-01', '2024-02-29'),
    range('2024-01-01', '2024-2-01'),
  ].forEach((query, index) => {
    it(`rejects invalid query ${index}`, () => {
      expect(() =>
        getRecurrenceCandidates(daily(), query as RecurrenceDateRange),
      ).toThrowError(RangeError);
    });
  });
});
