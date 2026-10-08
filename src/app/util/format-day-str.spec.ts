import { formatDayStr } from './format-day-str';

describe('formatDayStr', () => {
  describe('standard tests', () => {
    it('should format Monday correctly', () => {
      const result = formatDayStr('2024-01-15', 'en-US');
      expect(result).toBe('Mon');
    });

    it('should format Sunday correctly', () => {
      const result = formatDayStr('2024-01-14', 'en-US');
      expect(result).toBe('Sun');
    });

    it('should respect locale for German', () => {
      const result = formatDayStr('2024-01-15', 'de-DE');
      expect(result).toBe('Mo');
    });

    it('should respect locale for French', () => {
      const result = formatDayStr('2024-01-15', 'fr-FR');
      expect(result).toBe('lun.');
    });
  });

  describe('timezone edge cases', () => {
    // These tests verify that the day of week is correct regardless of timezone
    const testCases = [
      { date: '2024-01-01', expectedDay: 'Mon', description: 'New Year 2024' },
      { date: '2024-12-31', expectedDay: 'Tue', description: 'New Year Eve 2024' },
      { date: '2024-02-29', expectedDay: 'Thu', description: 'Leap year day' },
      { date: '2024-03-10', expectedDay: 'Sun', description: 'DST start in US' },
      { date: '2024-11-03', expectedDay: 'Sun', description: 'DST end in US' },
      { date: '2024-06-21', expectedDay: 'Fri', description: 'Summer solstice' },
      { date: '2024-12-21', expectedDay: 'Sat', description: 'Winter solstice' },
      // Historical dates that previously failed in negative UTC offset timezones
      { date: '2025-06-26', expectedDay: 'Thu', description: 'Issue #4653 example' },
      { date: '2023-01-01', expectedDay: 'Sun', description: 'Past New Year' },
      { date: '2023-07-04', expectedDay: 'Tue', description: 'US Independence Day 2023' },
    ];

    testCases.forEach(({ date, expectedDay, description }) => {
      it(`should return ${expectedDay} for ${date} (${description})`, () => {
        const result = formatDayStr(date, 'en-US');
        expect(result).toBe(expectedDay);
      });
    });

    // Test dates at month boundaries
    const monthBoundaries = [
      { date: '2024-01-31', expectedDay: 'Wed' },
      { date: '2024-02-01', expectedDay: 'Thu' },
      { date: '2024-04-30', expectedDay: 'Tue' },
      { date: '2024-05-01', expectedDay: 'Wed' },
      { date: '2024-08-31', expectedDay: 'Sat' },
      { date: '2024-09-01', expectedDay: 'Sun' },
    ];

    monthBoundaries.forEach(({ date, expectedDay }) => {
      it(`should handle month boundary ${date} correctly`, () => {
        const result = formatDayStr(date, 'en-US');
        expect(result).toBe(expectedDay);
      });
    });
  });

  describe('error handling', () => {
    it('should handle invalid date strings gracefully', () => {
      (window.confirm as jasmine.Spy).and.returnValue(false);
      const result = formatDayStr('invalid-date', 'en-US');
      expect(result).toBe('Invalid Date');
    });

    it('should handle empty string', () => {
      const result = formatDayStr('', 'en-US');
      // Empty string creates current date
      expect(result).toBeTruthy();
    });
  });

  describe('named timezone day boundaries', () => {
    it('formats each calendar day when the same instant falls on different local days', () => {
      const instant = Date.parse('2024-01-15T00:30:00Z');
      for (const [timeZone, dateKey, weekday] of [
        ['Europe/Berlin', '2024-01-15', 'Mon'],
        ['America/Vancouver', '2024-01-14', 'Sun'],
      ]) {
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        expect(formatter.resolvedOptions().timeZone).toBe(timeZone);
        const parts = formatter.formatToParts(instant);
        const part = (type: string): string => parts.find((p) => p.type === type)!.value;
        const date = `${part('year')}-${part('month')}-${part('day')}`;
        expect(date).toBe(dateKey);
        expect(formatDayStr(date, 'en-US')).toBe(weekday);
      }
    });
  });
});
