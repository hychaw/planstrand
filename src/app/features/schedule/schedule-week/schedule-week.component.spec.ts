import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeSv from '@angular/common/locales/sv';
import { TranslateModule } from '@ngx-translate/core';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { selectLocalizationConfig } from '../../config/store/global-config.reducer';
import { ScheduleWeekDragService } from './schedule-week-drag.service';
import { calculateTimeFromYPosition } from '../schedule-utils';
import { calendarTimeRow, calendarClock } from '../calendar-time';
import { FH } from '../schedule.const';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ScheduleWeekComponent } from './schedule-week.component';
import { ScheduleEventComponent } from '../schedule-event/schedule-event.component';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { ScheduleEvent } from '../schedule.model';
import { SVEType } from '../schedule.const';
import { CalendarEventActionsService } from '../../calendar-integration/calendar-event-actions.service';
import { By } from '@angular/platform-browser';
import { projectWorkSession } from '../calendar-display-item';

describe('ScheduleWeekComponent', () => {
  let fixture: ComponentFixture<ScheduleWeekComponent>;

  beforeEach(async () => {
    registerLocaleData(localeSv, 'sv');

    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, ScheduleWeekComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        {
          provide: DateTimeFormatService,
          useValue: {
            is24HourFormat: signal(true),
            currentLocale: signal('sv'),
            isoTextLocale: signal('en-US'),
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal(DEFAULT_GLOBAL_CONFIG),
          },
        },
        {
          provide: CalendarEventActionsService,
          useValue: jasmine.createSpyObj<CalendarEventActionsService>(
            'CalendarEventActionsService',
            ['canMoveEvent'],
          ),
        },
      ],
    })
      .overrideComponent(ScheduleWeekComponent, {
        remove: { imports: [ScheduleEventComponent] },
        add: { imports: [ScheduleEventStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ScheduleWeekComponent);
  });

  afterEach(() => TestBed.inject(MockStore).resetSelectors());

  it('clears idle creation previews on exit but preserves an open editor', () => {
    const component = fixture.componentInstance;
    const preview = { style: '', time: '09:00', date: '2026-05-11' };
    component.newTaskPlaceholder.set(preview);
    component.onGridLeave();
    expect(component.newTaskPlaceholder()).toBeNull();
    component.newTaskPlaceholder.set(preview);
    component.isCreateTaskActive.set(true);
    component.onGridLeave();
    expect(component.newTaskPlaceholder()).toEqual(preview);
    component.isCreateTaskActive.set(false);
    component.onGridLeave();
  });

  it('keeps Vancouver DST grid, pointer timestamp and drag labels aligned despite implicit renderer time', () => {
    const zone = 'America/Vancouver';
    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectLocalizationConfig, { timeZone: zone });
    store.refreshState();
    const format = TestBed.inject(DateTimeFormatService);
    (format.currentLocale as ReturnType<typeof signal<string>>).set('en-US');
    (format.is24HourFormat as ReturnType<typeof signal<boolean>>).set(false);
    // The baseline Electron renderer formats this instant as 4 PM (fixed UTC-8).
    // No implicit DateTimeFormatService formatter should be used for grid instants.
    const implicit = jasmine.createSpy('formatTime').and.returnValue('4:00 PM');
    Object.assign(format, { formatTime: implicit });
    fixture.componentRef.setInput('daysToShow', ['2026-10-07']);
    fixture.detectChanges();
    const drag = fixture.debugElement.injector.get(ScheduleWeekDragService);
    const rect = { top: -400, height: 2880 } as DOMRect;
    for (const hour of [17, 18]) {
      const offset = hour * FH * 10;
      const row = hour * FH;
      const instant = calculateTimeFromYPosition(
        rect.top + offset,
        rect,
        '2026-10-07',
        zone,
      )!;
      expect(instant).toBe(
        Date.parse(hour === 17 ? '2026-10-08T00:00:00Z' : '2026-10-08T01:00:00Z'),
      );
      expect(calendarTimeRow(instant, zone, FH)).toBe(row + 1);
      drag.showExternalPreview(
        { ...createTaskEvent('task', '2026-10-07', false), timeLeftInHours: 1 },
        '',
        instant,
      );
      expect(fixture.componentInstance.dragPreviewLabel()).toBe(
        `${hour - 12}:00 PM - ${hour - 11}:00 PM (1h)`,
      );
      expect(fixture.componentInstance.times()[hour]).toBe(`${hour - 12}:00 PM`);
    }
    // Historical winter standard time differs from October's daylight time.
    expect(calendarClock('2025-12-07', '17:00', zone)).toBe(
      Date.parse('2025-12-08T01:00:00Z'),
    );
    expect(implicit).not.toHaveBeenCalled();
    drag.hideExternalPreview();
  });

  it('does not resurrect a queued hover after the pointer leaves', fakeAsync(() => {
    fixture.componentRef.setInput('daysToShow', ['2026-10-05']);
    fixture.detectChanges();
    const grid = fixture.nativeElement.querySelector('.grid-container') as HTMLElement;
    const col = grid.querySelector('.col') as HTMLElement;
    const move = (): void => {
      const event = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(event, 'offsetY', { value: 100 });
      col.dispatchEvent(event);
    };
    move();
    expect(fixture.componentInstance.newTaskPlaceholder()).not.toBeNull();
    move();
    grid.dispatchEvent(new MouseEvent('mouseleave'));
    tick(40);
    expect(fixture.componentInstance.newTaskPlaceholder()).toBeNull();
  }));

  it('clears hover state on scroll, changed days, task drag and teardown', () => {
    fixture.componentRef.setInput('daysToShow', ['2026-10-05']);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const preview = { style: '', time: '09:00', date: '2026-10-05' };
    component.newTaskPlaceholder.set(preview);
    document.dispatchEvent(new Event('scroll'));
    expect(component.newTaskPlaceholder()).toBeNull();
    component.newTaskPlaceholder.set(preview);
    fixture.componentRef.setInput('daysToShow', ['2026-10-06']);
    fixture.detectChanges();
    expect(component.newTaskPlaceholder()).toBeNull();
    component.newTaskPlaceholder.set(preview);
    fixture.componentRef.setInput('isTaskDragActive', true);
    fixture.detectChanges();
    expect(component.newTaskPlaceholder()).toBeNull();
    component.newTaskPlaceholder.set(preview);
    fixture.destroy();
    expect(component.newTaskPlaceholder()).toBeNull();
  });

  it('uses the UI language for weekday headers with ISO formatting enabled', () => {
    fixture.componentRef.setInput('daysToShow', ['2026-05-11']);

    expect(fixture.componentInstance.dayHeaderLabels()['2026-05-11']).toEqual({
      num: '11',
      day: 'Mon',
    });
  });

  it('enables existing timezone-aware WorkSessions while retaining legacy Task dragging', () => {
    const item = projectWorkSession(
      {
        id: 'session',
        taskId: 'task',
        start: 1000,
        end: 3601000,
        created: 1000,
        modified: 1000,
        timeZone: 'America/Vancouver',
      },
      { title: 'Current Task title' },
    );
    const event: ScheduleEvent = {
      id: item.id,
      type: SVEType.WorkSession,
      data: item,
      startHours: 10,
      timeLeftInHours: 1,
      style: '',
      plannedForDay: '2026-05-11',
    };
    fixture.componentRef.setInput('daysToShow', ['2026-05-11']);
    fixture.componentRef.setInput('events', [
      event,
      { ...event, id: 'workSession:second' },
    ]);
    fixture.componentRef.setInput('beyondBudget', [[]]);
    fixture.detectChanges();
    const blocks = fixture.debugElement
      .queryAll(By.directive(ScheduleEventStubComponent))
      .map((element) => element.componentInstance as ScheduleEventStubComponent);
    expect(blocks.length).toBe(2);
    expect(blocks.every((block) => !block.cdkDragDisabled)).toBeTrue();
    expect(blocks[0].event).toEqual(event);
    expect(fixture.componentInstance.canDragEvent(event)).toBeTrue();
    expect(
      fixture.componentInstance.canDragEvent({
        ...event,
        data: { ...item, timeZone: undefined },
      }),
    ).toBeFalse();
    expect(
      fixture.componentInstance.canDragEvent(
        createTaskEvent('legacy', '2026-05-11', false),
      ),
    ).toBeTrue();
  });

  it('should dedupe visible and hidden beyond-budget tasks in the day badge', () => {
    fixture.componentRef.setInput('daysToShow', ['2026-05-11']);
    fixture.componentRef.setInput('events', [
      createTaskEvent('task-1', '2026-05-11', true),
    ]);
    fixture.componentRef.setInput('beyondBudget', [
      [
        createTaskEvent('task-1', '2026-05-11', true),
        createTaskEvent('task-2', '2026-05-11', true),
      ],
    ]);

    expect(fixture.componentInstance.beyondBudgetStats()[0].count).toBe(2);
  });

  it('should render the hidden beyond-budget task count in the day badge', () => {
    fixture.componentRef.setInput('daysToShow', ['2026-05-11']);
    fixture.componentRef.setInput('events', []);
    fixture.componentRef.setInput('beyondBudget', [
      [
        createTaskEvent('task-1', '2026-05-11', true),
        createTaskEvent('task-2', '2026-05-11', true),
      ],
    ]);

    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.over-budget-count')?.textContent.trim(),
    ).toBe('2');
  });
});

@Component({
  selector: 'schedule-event',
  standalone: true,
  template: '',
})
class ScheduleEventStubComponent {
  @Input() event?: ScheduleEvent;
  @Input() isDragPreview?: boolean;
  @Input() cdkDragData?: ScheduleEvent;
  @Input() cdkDragDisabled?: boolean;
  @Input() cdkDragStartDelay?: number;
  @Output() cdkDragMoved = new EventEmitter<unknown>();
  @Output() cdkDragStarted = new EventEmitter<unknown>();
  @Output() cdkDragReleased = new EventEmitter<unknown>();
}

const createTaskEvent = (
  id: string,
  plannedForDay: string,
  isBeyondBudget: boolean,
): ScheduleEvent => ({
  id,
  type: SVEType.TaskPlannedForDay,
  style: '',
  startHours: 10,
  timeLeftInHours: 1,
  data: {
    id,
  } as ScheduleEvent['data'],
  plannedForDay,
  isBeyondBudget,
});
