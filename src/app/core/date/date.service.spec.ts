import { DateService } from './date.service';

describe('DateService', () => {
  let service: DateService;

  beforeEach(() => {
    service = new DateService();
  });

  describe('isToday', () => {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    afterEach(() => jasmine.clock().uninstall());

    it('should return true for a date today (Date input)', () => {
      expect(service.isToday(new Date())).toBe(true);
    });

    it('should return true for a timestamp today (number input)', () => {
      expect(service.isToday(Date.now())).toBe(true);
    });

    it('should return false for yesterday', () => {
      const yesterday = Date.now() - ONE_DAY_MS;
      expect(service.isToday(yesterday)).toBe(false);
    });

    it('should return false for tomorrow', () => {
      const tomorrow = Date.now() + ONE_DAY_MS;
      expect(service.isToday(tomorrow)).toBe(false);
    });

    it('uses the local calendar day even with an inherited workday offset', () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 9, 7, 0, 30));
      service.setStartOfNextDayDiff(4);
      expect(service.isToday(new Date(2026, 9, 7, 0, 5))).toBeTrue();
      expect(service.isToday(new Date(2026, 9, 6, 23, 55))).toBeFalse();
      expect(service.isYesterday(new Date(2026, 9, 6, 23, 55))).toBeTrue();
    });

    it('should treat late-night time as still today when offset is set', () => {
      service.setStartOfNextDayDiff(2);

      const lateNight = new Date();
      lateNight.setHours(23, 0, 0, 0);

      const afternoon = new Date();
      afternoon.setHours(14, 0, 0, 0);

      // 23:00 and 14:00 same calendar day with offset should both be "today"
      expect(service.isToday(lateNight)).toBe(service.isToday(afternoon));
    });

    it('should return true at start of day (midnight, no offset)', () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      expect(service.isToday(startOfDay)).toBe(true);
    });

    it('should return true at end of day (23:59:59, no offset)', () => {
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      expect(service.isToday(endOfDay)).toBe(true);
    });
  });

  describe('todayStr', () => {
    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('without args should match the calendar day when offset is 0', () => {
      jasmine.clock().install();
      const fixed = new Date(2026, 2, 27, 2, 30, 0);
      jasmine.clock().mockDate(fixed);
      service.setStartOfNextDayDiff(0);
      expect(service.todayStr()).toBe('2026-03-27');
    });

    it('without args ignores the legacy workday boundary', () => {
      jasmine.clock().install();
      const fixed = new Date(2026, 2, 27, 2, 30, 0);
      jasmine.clock().mockDate(fixed);
      service.setStartOfNextDayDiff(3);
      expect(service.todayStr()).toBe('2026-03-27');
    });

    it('without args should use the new calendar day from start-of-next-day hour onward', () => {
      jasmine.clock().install();
      const fixed = new Date(2026, 2, 27, 3, 0, 0);
      jasmine.clock().mockDate(fixed);
      service.setStartOfNextDayDiff(3);
      expect(service.todayStr()).toBe('2026-03-27');
    });

    it('with explicit date should not apply start-of-next-day offset', () => {
      service.setStartOfNextDayDiff(3);
      const d = new Date(2026, 2, 27, 2, 30, 0);
      expect(service.todayStr(d)).toBe('2026-03-27');
    });
  });

  describe('setStartOfNextDayDiff', () => {
    it('should clamp negative values to 0', () => {
      service.setStartOfNextDayDiff(-5);
      expect(service.getStartOfNextDayDiffMs()).toBe(0);
    });

    it('should treat out-of-range hour values as 0', () => {
      service.setStartOfNextDayDiff(99);
      expect(service.getStartOfNextDayDiffMs()).toBe(0);
    });

    it('should treat undefined as 0', () => {
      service.setStartOfNextDayDiff(undefined as unknown as number);
      expect(service.getStartOfNextDayDiffMs()).toBe(0);
    });
  });
});
