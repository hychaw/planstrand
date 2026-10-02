import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeSv from '@angular/common/locales/sv';
import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
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

  it('uses the UI language for weekday headers with ISO formatting enabled', () => {
    fixture.componentRef.setInput('daysToShow', ['2026-05-11']);

    expect(fixture.componentInstance.dayHeaderLabels()['2026-05-11']).toEqual({
      num: '11',
      day: 'Mon',
    });
  });

  it('passes distinct WorkSessions to timed blocks with dragging disabled', () => {
    const item = projectWorkSession(
      {
        id: 'session',
        taskId: 'task',
        start: 1000,
        end: 3601000,
        created: 1000,
        modified: 1000,
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
    expect(blocks.every((block) => block.cdkDragDisabled === true)).toBeTrue();
    expect(blocks[0].event).toEqual(event);
    expect(fixture.componentInstance.canDragEvent(event)).toBeFalse();
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
