import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CurrentDateService } from './current-date.service';
import { DateService } from './date.service';
import { calendarDayStart } from '../../util/calendar-date';

describe('CurrentDateService', () => {
  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 9, 6, 23, 59, 59));
    TestBed.configureTestingModule({ teardown: { destroyAfterEach: true } });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    jasmine.clock().uninstall();
  });
  it('rolls over at local midnight and stays reactive over multiple days', () => {
    const dates = TestBed.inject(CurrentDateService);
    const seen: string[] = [];
    dates.today$.subscribe((date) => seen.push(date));
    expect(dates.today()).toBe('2026-10-06');
    jasmine.clock().tick(1000);
    expect(dates.today()).toBe('2026-10-07');
    expect(TestBed.inject(DateService).todayStr()).toBe('2026-10-07');
    jasmine.clock().tick(48 * 3600000);
    expect(dates.today()).toBe('2026-10-09');
    expect(seen).toEqual(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  });
  it('recovers immediately on focus after sleeping across midnight', () => {
    const dates = TestBed.inject(CurrentDateService);
    jasmine.clock().mockDate(new Date(2026, 9, 8, 8));
    window.dispatchEvent(new Event('focus'));
    expect(dates.today()).toBe('2026-10-08');
    jasmine.clock().tick(16 * 3600000);
    expect(dates.today()).toBe('2026-10-09');
  });
  it('recovers on visibility and resolves user intent before a delayed timer runs', () => {
    const dates = TestBed.inject(CurrentDateService);
    jasmine.clock().mockDate(new Date(2026, 9, 7, 0, 1));
    expect(dates.resolveToday()).toBe('2026-10-07');
    jasmine.clock().mockDate(new Date(2026, 9, 8, 8));
    spyOnProperty(document, 'hidden', 'get').and.returnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(dates.today()).toBe('2026-10-08');
  });
  it('updates configured Calendar zones at their midnight and when the zone changes', () => {
    jasmine.clock().mockDate(new Date('2026-10-07T03:59:59Z'));
    const dates = TestBed.inject(CurrentDateService);
    const zone = signal('America/New_York');
    const today = TestBed.runInInjectionContext(() => dates.dateInZone(zone));
    TestBed.flushEffects();
    expect(today()).toBe('2026-10-06');
    jasmine.clock().tick(1000);
    expect(today()).toBe('2026-10-07');
    zone.set('Pacific/Honolulu');
    TestBed.flushEffects();
    expect(today()).toBe('2026-10-06');
  });
  it('uses civil midnight through 23-hour, 25-hour and skipped-midnight days', () => {
    expect(
      calendarDayStart('2026-03-09', 'America/New_York') -
        calendarDayStart('2026-03-08', 'America/New_York'),
    ).toBe(23 * 3600000);
    expect(
      calendarDayStart('2026-11-02', 'America/New_York') -
        calendarDayStart('2026-11-01', 'America/New_York'),
    ).toBe(25 * 3600000);
    expect(calendarDayStart('2018-11-04', 'America/Sao_Paulo')).toBe(
      Date.parse('2018-11-04T03:00:00Z'),
    );
  });
  it('re-reads system-local date fields on focus even when the instant is unchanged', () => {
    const dates = TestBed.inject(CurrentDateService);
    const instant = dates.now();
    // Simulate the OS changing its local date mapping, independently of UTC.
    const localDay = spyOn(Date.prototype, 'getDate').and.returnValue(7);
    window.dispatchEvent(new Event('focus'));
    expect(dates.now()).toBe(instant);
    expect(dates.today()).toBe('2026-10-07');
    localDay.and.returnValue(6);
    window.dispatchEvent(new Event('focus'));
    expect(dates.today()).toBe('2026-10-06');
  });

  it('cancels its timeout and activation subscriptions on destruction', () => {
    const dates = TestBed.inject(CurrentDateService);
    const refresh = spyOn(dates, 'refresh').and.callThrough();
    TestBed.resetTestingModule();
    refresh.calls.reset();
    window.dispatchEvent(new Event('focus'));
    jasmine.clock().tick(2 * 86400000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
