import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ScheduleYearComponent } from './schedule-year.component';
import { CalendarDisplayService } from '../calendar-display.service';
import { CalendarDisplayItem } from '../calendar-display-item.model';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';

describe('ScheduleYearComponent', () => {
  const items = signal<CalendarDisplayItem[]>([]);
  const zone = signal('America/Los_Angeles');
  const setup = (year = 2028): ComponentFixture<ScheduleYearComponent> => {
    const fixture = TestBed.createComponent(ScheduleYearComponent);
    fixture.componentRef.setInput('year', year);
    return fixture;
  };
  beforeEach(() => {
    items.set([]);
    zone.set('America/Los_Angeles');
    TestBed.configureTestingModule({
      imports: [ScheduleYearComponent, TranslateModule.forRoot()],
      providers: [
        { provide: DateTimeFormatService, useValue: { textLocale: () => 'en-US' } },
        { provide: CalendarDisplayService, useValue: { items, displayTimeZone: zone } },
      ],
    });
  });

  it('renders twelve months and all leap-year dates', () => {
    const fixture = setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('section').length).toBe(12);
    expect(fixture.nativeElement.querySelectorAll('.day').length).toBe(366);
    expect(fixture.componentInstance.months()[1].days.at(-1)?.number).toBe(29);
  });

  it('keeps all-day source dates and projects timed spans in the display zone', () => {
    const base = { canMove: false, canResize: false, canDelete: false, isReadOnly: true };
    items.set([
      {
        ...base,
        id: 'all-day',
        sourceId: 'all-day',
        sourceType: 'event',
        isAllDay: true,
        date: '2028-02-29',
        start: Date.UTC(2028, 1, 29),
        end: Date.UTC(2028, 1, 29),
      },
      {
        ...base,
        id: 'work',
        sourceId: 'work',
        sourceType: 'workSession',
        start: Date.UTC(2028, 1, 29, 7),
        end: Date.UTC(2028, 1, 29, 9),
      },
    ]);
    const fixture = setup();
    const february = fixture.componentInstance.months()[1];
    expect(february.days[27].count).toBe(1);
    expect(february.days[27].hasWork).toBeTrue();
    expect(february.days[28].count).toBe(2);
    expect(february.days[28].hasWork).toBeTrue();
  });

  it('treats midnight end as exclusive and responds to projection changes', () => {
    zone.set('UTC');
    const fixture = setup();
    items.set([
      {
        id: 'event',
        sourceId: 'event',
        sourceType: 'event',
        start: Date.UTC(2028, 0, 1, 23),
        end: Date.UTC(2028, 0, 2),
        canMove: true,
        canResize: true,
        canDelete: true,
        isReadOnly: false,
      },
    ]);
    expect(fixture.componentInstance.months()[0].days[0].count).toBe(1);
    expect(fixture.componentInstance.months()[0].days[1].count).toBe(0);
    items.set([]);
    expect(fixture.componentInstance.months()[0].days[0].count).toBe(0);
  });

  it('honors week start and emits separate month and date navigation', () => {
    const fixture = setup(2026);
    fixture.componentRef.setInput('firstDayOfWeek', 0);
    fixture.componentRef.setInput('today', '2026-01-01');
    const month = spyOn(fixture.componentInstance.monthSelected, 'emit');
    const date = spyOn(fixture.componentInstance.dateSelected, 'emit');
    fixture.detectChanges();
    expect(fixture.componentInstance.months()[0].padding.length).toBe(4);
    fixture.nativeElement.querySelector('.month-title').click();
    fixture.nativeElement.querySelector('.day').click();
    expect(month).toHaveBeenCalledWith(new Date(2026, 0, 1, 12));
    expect(date).toHaveBeenCalledWith(new Date(2026, 0, 1, 12));
    expect(
      fixture.nativeElement.querySelector('[aria-current="date"]').textContent,
    ).toContain('1');
  });
});
