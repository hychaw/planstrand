import {
  getRecurrenceCandidates,
  RecurrenceCandidate,
  RecurrenceSpec,
} from './recurrence-candidates';

describe('monthly recurrence candidates', () => {
  const monthly = (
    startDate: string,
    interval = 1,
    endDate?: string,
  ): RecurrenceSpec => ({ frequency: 'monthly', startDate, interval, endDate });
  const query = (
    spec: RecurrenceSpec,
    fromDate: string,
    toDateExclusive: string,
  ): RecurrenceCandidate[] =>
    getRecurrenceCandidates(spec, { fromDate, toDateExclusive });

  it('skips invalid months for the 31st while reserving their slots', () => {
    expect(query(monthly('2026-01-31'), '2026-01-01', '2026-06-01')).toEqual([
      { date: '2026-01-31', slot: 0 },
      { date: '2026-03-31', slot: 2 },
      { date: '2026-05-31', slot: 4 },
    ]);
  });

  it('supports interval 2 across year boundaries, including invalid interval months', () => {
    expect(query(monthly('2023-12-30', 2), '2023-12-01', '2024-07-01')).toEqual([
      { date: '2023-12-30', slot: 0 },
      { date: '2024-04-30', slot: 2 },
      { date: '2024-06-30', slot: 3 },
    ]);
  });

  it('supports larger intervals without shifting the original day', () => {
    expect(query(monthly('2023-01-31', 13), '2023-01-01', '2026-05-01')).toEqual([
      { date: '2023-01-31', slot: 0 },
      { date: '2025-03-31', slot: 2 },
    ]);
  });

  it('supports the 28th in every month', () => {
    expect(query(monthly('2025-01-28'), '2025-01-01', '2025-04-01')).toEqual([
      { date: '2025-01-28', slot: 0 },
      { date: '2025-02-28', slot: 1 },
      { date: '2025-03-28', slot: 2 },
    ]);
  });

  it('supports the 29th in leap February and skips non-leap February', () => {
    const spec = monthly('2023-01-29');
    expect(query(spec, '2023-02-01', '2023-04-01')).toEqual([
      { date: '2023-03-29', slot: 2 },
    ]);
    expect(query(spec, '2024-02-01', '2024-04-01')).toEqual([
      { date: '2024-02-29', slot: 13 },
      { date: '2024-03-29', slot: 14 },
    ]);
  });

  it('supports the 30th without clamping to February 28 or 29', () => {
    for (const year of ['2023', '2024']) {
      expect(query(monthly(`${year}-01-30`), `${year}-02-01`, `${year}-04-01`)).toEqual([
        { date: `${year}-03-30`, slot: 2 },
      ]);
    }
  });

  it('preserves a February 29 anchor across leap and non-leap centuries', () => {
    const spec = monthly('1896-02-29', 12);
    expect(query(spec, '1900-01-01', '1901-01-01')).toEqual([]);
    expect(query(spec, '2000-01-01', '2001-01-01')).toEqual([
      { date: '2000-02-29', slot: 104 },
    ]);
  });

  it('handles year zero and years below 100', () => {
    expect(query(monthly('0000-01-29'), '0000-02-01', '0000-03-01')).toEqual([
      { date: '0000-02-29', slot: 1 },
    ]);
    expect(query(monthly('0099-12-31'), '0100-01-01', '0100-04-01')).toEqual([
      { date: '0100-01-31', slot: 1 },
      { date: '0100-03-31', slot: 3 },
    ]);
  });

  it('keeps inclusive series bounds and an exclusive query end', () => {
    const spec = monthly('2026-01-31', 1, '2026-03-31');
    expect(query(spec, '2025-01-01', '2027-01-01')).toEqual([
      { date: '2026-01-31', slot: 0 },
      { date: '2026-03-31', slot: 2 },
    ]);
    expect(query(spec, '2026-03-31', '2026-04-01')).toEqual([
      { date: '2026-03-31', slot: 2 },
    ]);
    expect(query(spec, '2026-02-01', '2026-03-31')).toEqual([]);
    expect(
      query(monthly('2026-01-31', 1, '2026-03-30'), '2026-02-01', '2026-05-01'),
    ).toEqual([]);
  });

  it('returns empty for empty, before-start, after-end and skipped-month queries', () => {
    const spec = monthly('2026-01-31', 1, '2026-05-31');
    for (const [from, to] of [
      ['2026-03-31', '2026-03-31'],
      ['2025-01-01', '2026-01-31'],
      ['2026-06-01', '2027-01-01'],
      ['2026-02-01', '2026-03-01'],
    ]) {
      expect(query(spec, from, to)).toEqual([]);
    }
  });

  it('preserves slots across overlapping and disjoint windows', () => {
    for (const interval of [1, 2, 5]) {
      const spec = monthly('2020-01-31', interval);
      const whole = query(spec, '2025-01-01', '2027-01-01');
      expect([
        ...query(spec, '2025-01-01', '2026-03-15'),
        ...query(spec, '2026-03-15', '2027-01-01'),
      ]).toEqual(whole);
      expect(query(spec, '2025-03-10', '2026-07-01')).toEqual(
        whole.filter(({ date }) => date >= '2025-03-10' && date < '2026-07-01'),
      );
    }
  });

  it('seeks an unbounded series while formatting only the requested months', () => {
    const formatting = spyOn(String.prototype, 'padStart').and.callThrough();
    expect(query(monthly('0000-01-31'), '9999-10-01', '9999-12-31')).toEqual([
      { date: '9999-10-31', slot: 119997 },
    ]);
    expect(formatting.calls.count()).toBeLessThanOrEqual(12);
  });

  it('handles large intervals without date overflow', () => {
    expect(
      query(monthly('2026-01-31', Number.MAX_SAFE_INTEGER), '2026-01-01', '9999-12-31'),
    ).toEqual([{ date: '2026-01-31', slot: 0 }]);
  });

  [0, -1, 1.5, Infinity, NaN].forEach((interval) => {
    it(`rejects invalid monthly interval ${interval}`, () => {
      expect(() =>
        query(monthly('2026-01-31', interval), '2026-01-01', '2026-02-01'),
      ).toThrowError(RangeError);
    });
  });
});
