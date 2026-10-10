import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CdkDrag, CdkDragRelease, CdkDragStart } from '@angular/cdk/drag-drop';
import { MatDialog } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import { CalendarEventActionsService } from '../calendar-integration/calendar-event-actions.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { GlobalConfigService } from '../config/global-config.service';
import {
  selectLocalizationConfig,
  selectTimelineConfig,
} from '../config/store/global-config.reducer';
import { EventService } from '../event/event.service';
import { TaskService } from '../tasks/task.service';
import { DEFAULT_TASK } from '../tasks/task.model';
import { WorkSessionService } from '../work-session/work-session.service';
import { selectTimelineTasks } from '../work-context/store/work-context.selectors';
import { selectPlannerDayMap } from '../planner/store/planner.selectors';
import { selectTaskRepeatCfgsWithAndWithoutStartTime } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { EventSeries } from '../routines/event-series.model';
import { selectAllEventSeries } from '../routines/store/event-series.selectors';
import { CalendarDisplayService } from './calendar-display.service';
import { selectPersistedCalendarDisplayItems } from './calendar-display-item.selectors';
import { projectEvent, projectWorkSession } from './calendar-display-item';
import { mapScheduleDaysToScheduleEvents } from './map-schedule-data/map-schedule-days-to-schedule-events';
import { ScheduleService } from './schedule.service';
import { ScheduleWeekComponent } from './schedule-week/schedule-week.component';
import { ScheduleMonthComponent } from './schedule-month/schedule-month.component';
import { ScheduleYearComponent } from './schedule-year/schedule-year.component';
import { ScheduleEventComponent } from './schedule-event/schedule-event.component';
import { ScheduleWeekDragService } from './schedule-week/schedule-week-drag.service';
import { editableLocalEvent, editableWorkSession, ScheduleEvent } from './schedule.model';
import { FH, SVEType } from './schedule.const';
import { calendarDayStart } from './calendar-time';

describe('recurring Event Calendar integration (real projection and mapping)', () => {
  const hour = 3600000;
  const allDay: EventSeries = {
    id: 'all-day-series',
    title: 'Daily routine',
    created: 1,
    modified: 1,
    segments: [
      {
        id: 'all-day-segment',
        recurrence: { frequency: 'daily', startDate: '2025-01-01', interval: 1 },
        timing: { kind: 'allDay' },
      },
    ],
  };
  const overnight: EventSeries = {
    id: 'timed-series',
    title: 'Overnight routine',
    created: 1,
    modified: 1,
    segments: [
      {
        id: 'timed-segment',
        recurrence: {
          frequency: 'daily',
          startDate: '2026-01-14',
          endDate: '2026-01-14',
          interval: 1,
        },
        timing: {
          kind: 'timed',
          localTime: '23:00',
          timeZone: 'UTC',
          durationMs: 26 * hour,
        },
      },
    ],
  };
  const local = projectEvent({
    id: 'one-off',
    title: 'One-off',
    isAllDay: false,
    start: Date.parse('2026-01-15T10:00:00Z'),
    end: Date.parse('2026-01-15T11:00:00Z'),
    timeZone: 'UTC',
    created: 1,
    modified: 1,
  });
  const session = projectWorkSession(
    {
      id: 'session',
      taskId: 'task',
      start: Date.parse('2026-01-15T12:00:00Z'),
      end: Date.parse('2026-01-15T13:00:00Z'),
      timeZone: 'UTC',
      created: 1,
      modified: 1,
    },
    { title: 'Work' },
  );
  let store: MockStore;
  let service: ScheduleService;
  let dispatch: jasmine.Spy;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ScheduleWeekComponent,
        ScheduleMonthComponent,
        ScheduleYearComponent,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectLocalizationConfig, value: { timeZone: 'UTC' } },
            { selector: selectAllEventSeries, value: [allDay, overnight] },
            { selector: selectPersistedCalendarDisplayItems, value: [local, session] },
            {
              selector: selectTimelineTasks,
              value: {
                planned: [],
                unPlanned: [{ ...DEFAULT_TASK, id: 'task', subTasks: [] }],
              },
            },
            {
              selector: selectTaskRepeatCfgsWithAndWithoutStartTime,
              value: { withStartTime: [], withoutStartTime: [] },
            },
            {
              selector: selectPlannerDayMap,
              value: { ['2026-01-15']: [{ ...DEFAULT_TASK, id: 'task' }] },
            },
            {
              selector: selectTimelineConfig,
              value: { isWorkStartEndEnabled: false, isLunchBreakEnabled: false },
            },
          ],
        }),
        { provide: CalendarIntegrationService, useValue: { calendarEvents$: of([]) } },
        {
          provide: HiddenCalendarProvidersService,
          useValue: { hiddenProviderIds: signal([]) },
        },
        {
          provide: GlobalConfigService,
          useValue: { cfg: signal(DEFAULT_GLOBAL_CONFIG) },
        },
        {
          provide: DateTimeFormatService,
          useValue: {
            textLocale: () => 'en-US',
            currentLocale: () => 'en-US',
            isoTextLocale: () => 'en-US',
            is24HourFormat: () => true,
          },
        },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
        {
          provide: TaskService,
          useValue: {
            currentTaskId: signal(null),
            setSelectedId: jasmine.createSpy('setSelectedId'),
            remove: jasmine.createSpy('remove'),
          },
        },
        {
          provide: EventService,
          useValue: jasmine.createSpyObj('events', [
            'update',
            'move',
            'resize',
            'remove',
          ]),
        },
        {
          provide: WorkSessionService,
          useValue: jasmine.createSpyObj('sessions', [
            'update',
            'remove',
            'complete',
            'uncomplete',
          ]),
        },
        {
          provide: CalendarEventActionsService,
          useValue: jasmine.createSpyObj('providers', [
            'canMoveEvent',
            'hasEventUrl',
            'isPluginEvent',
            'createAsTask',
            'hideForever',
            'openEventLink',
            'reschedule',
            'deleteEvent',
            'moveToStartTime',
          ]),
        },
      ],
    }).compileComponents();
    store = TestBed.inject(MockStore);
    service = TestBed.inject(ScheduleService);
    dispatch = spyOn(store, 'dispatch');
  });
  afterEach(() => {
    expect(dispatch).not.toHaveBeenCalled();
    store.resetSelectors();
  });

  const eventsFor = (days: string[]): ScheduleEvent[] => {
    const start = calendarDayStart(days[0], service.displayTimeZone());
    return mapScheduleDaysToScheduleEvents(
      service.createScheduleDaysWithContext({
        daysToShow: days,
        contextNow: start,
        realNow: start,
        currentTaskId: null,
      }),
      FH,
      service.displayTimeZone(),
    ).eventsFlat;
  };
  const titleOf = (event: ScheduleEvent): string | undefined =>
    event.data && 'title' in event.data ? (event.data.title ?? undefined) : undefined;
  const renderWeek = (
    days: string[],
    events = eventsFor(days),
  ): ComponentFixture<ScheduleWeekComponent> => {
    const fixture = TestBed.createComponent(ScheduleWeekComponent);
    fixture.componentRef.setInput('daysToShow', days);
    fixture.componentRef.setInput('events', events);
    fixture.detectChanges();
    return fixture;
  };

  it('shows all-day and overlapping timed occurrences in Day without hiding Events or WorkSessions', () => {
    const events = eventsFor(['2026-01-15']);
    expect(events.map((event) => event.type)).toEqual([
      SVEType.EventOccurrence,
      SVEType.LocalEvent,
      SVEType.WorkSession,
      SVEType.EventOccurrence,
    ]);
    const timed = events.find((event) => titleOf(event) === overnight.title)!;
    expect(timed.startHours).toBe(0);
    expect(timed.timeLeftInHours).toBe(24);
    expect((timed.data as { start: number }).start).toBe(
      Date.parse('2026-01-14T23:00:00Z'),
    );
    const fixture = renderWeek(['2026-01-15'], events);
    expect(fixture.nativeElement.querySelector('.week-header').textContent).toContain(
      allDay.title,
    );
    expect(fixture.nativeElement.querySelector('.grid-container').textContent).toContain(
      overnight.title,
    );
    expect(fixture.componentInstance.canDragEvent(timed)).toBeFalse();
    const headers = fixture.componentInstance.allDayEvents('2026-01-15');
    expect(headers.length).toBe(1);
    expect(fixture.componentInstance.timedEvents()).not.toContain(headers[0]);
  });

  it('splits overnight/multi-day occurrences in Week while preserving their display/source identities', () => {
    const days = service.getDaysToShow(7, new Date(2026, 0, 12));
    const events = eventsFor(days);
    const slices = events.filter((event) => titleOf(event) === overnight.title);
    expect(
      slices.map((event) => [
        event.plannedForDay,
        event.startHours,
        event.timeLeftInHours,
      ]),
    ).toEqual([
      ['2026-01-14', 23, 1],
      ['2026-01-15', 0, 24],
      ['2026-01-16', 0, 1],
    ]);
    expect(new Set(slices.map((event) => event.id)).size).toBe(1);
    expect(new Set(slices.map((event) => event.data)).size).toBe(1);
    expect(slices.every((event) => event.type === SVEType.EventOccurrence)).toBeTrue();
    const fixture = renderWeek(days, events);
    expect(
      fixture.nativeElement.querySelectorAll('.week-header schedule-event').length,
    ).toBe(7);
    expect(
      fixture.nativeElement.querySelectorAll('schedule-event.EventOccurrence').length,
    ).toBe(10);
    const clipped = eventsFor(['2026-01-15']).find(
      (event) => titleOf(event) === overnight.title,
    )!;
    expect(clipped.id).toBe(slices[0].id);
  });

  it('uses the full padded Month grid, including previous/next-month dates', () => {
    const date = new Date(2026, 7, 1);
    const weeks = service.getMonthWeeksToShow(1, date);
    const days = service.getMonthDaysToShow(weeks, 1, date);
    expect(days[0]).toBe('2026-07-27');
    expect(days.at(-1)).toBe('2026-09-06');
    const events = eventsFor(days);
    const fixture = TestBed.createComponent(ScheduleMonthComponent);
    fixture.componentRef.setInput('daysToShow', days);
    fixture.componentRef.setInput('weeksToShow', weeks);
    fixture.componentRef.setInput('events', events);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('schedule-event.EventOccurrence').length,
    ).toBe(42);
    expect(
      fixture.nativeElement.querySelector('[data-day="2026-07-27"]').textContent,
    ).toContain(allDay.title);
    expect(
      fixture.nativeElement.querySelector('[data-day="2026-09-06"]').textContent,
    ).toContain(allDay.title);
    expect(events.every((event) => event.timeLeftInHours === 0)).toBeTrue();
  });

  it('counts recurring activity once per covered Year date, with existing items and midnight-exclusive ends', () => {
    const fixture = TestBed.createComponent(ScheduleYearComponent);
    fixture.componentRef.setInput('year', 2026);
    fixture.detectChanges();
    const january = fixture.componentInstance.months()[0].days;
    expect(january[13].count).toBe(2);
    expect(january[14].count).toBe(4);
    expect(january[14].hasWork).toBeTrue();
    expect(january[15].count).toBe(2);
    expect(january[16].count).toBe(1);
    expect(january[16].hasWork).toBeFalse();
    expect(fixture.nativeElement.querySelectorAll('.activity.has-items').length).toBe(
      365,
    );
    fixture.componentRef.setInput('year', 2028);
    expect(fixture.componentInstance.months()[1].days.at(-1)?.count).toBe(1);
    expect(fixture.componentInstance.months()[1].days.length).toBe(29);
  });

  it('reacts to navigation, series edits and display timezone changes through bounded signals', () => {
    const days = signal(['2026-01-15']);
    const schedule = service.createScheduleDaysComputed(days);
    const read = (): ScheduleEvent[] =>
      mapScheduleDaysToScheduleEvents(schedule(), FH, service.displayTimeZone())
        .eventsFlat;
    const original = read().find((event) => titleOf(event) === overnight.title)!;
    days.set(['2026-01-16']);
    expect(read().find((event) => titleOf(event) === overnight.title)!.id).toBe(
      original.id,
    );
    store.overrideSelector(selectLocalizationConfig, { timeZone: 'America/Los_Angeles' });
    store.refreshState();
    expect(read().some((event) => titleOf(event) === overnight.title)).toBeFalse();
    days.set(['2026-01-14']);
    const shifted = read().find((event) => titleOf(event) === overnight.title)!;
    expect(shifted.id).toBe(original.id);
    expect(shifted.startHours).toBe(15);
    expect(shifted.data).toEqual(original.data);
    expect(read().find((event) => titleOf(event) === allDay.title)!.plannedForDay).toBe(
      '2026-01-14',
    );
    store.overrideSelector(selectAllEventSeries, [
      { ...overnight, title: 'Renamed routine' },
    ]);
    store.refreshState();
    expect(titleOf(read().find((event) => event.id === original.id)!)).toBe(
      'Renamed routine',
    );
    expect(read().some((event) => titleOf(event) === allDay.title)).toBeFalse();
  });

  it('keeps occurrence click, resize, delete and forged drag deliveries out of every write path', async () => {
    const fixture = renderWeek(['2026-01-15']);
    const entry = fixture.debugElement
      .queryAll(By.directive(ScheduleEventComponent))
      .find(
        (element) => element.componentInstance.event().data?.title === overnight.title,
      )!;
    const component = entry.componentInstance as ScheduleEventComponent;
    const event = component.event();
    expect(entry.injector.get(CdkDrag).disabled).toBeTrue();
    expect(component.isResizable()).toBeFalse();
    expect(component.icoType()).toBe('REPEAT');
    expect(component.task()).toBeUndefined();
    expect(editableLocalEvent(event, 'canDelete')).toBeNull();
    expect(editableWorkSession(event, 'canMove')).toBeNull();
    expect(entry.nativeElement.querySelector('.resize-handle')).toBeNull();
    expect(component.calMenuTrigger()).toBeUndefined();
    expect(component.sessionMenuTrigger()).toBeUndefined();
    await component.clickHandler(new MouseEvent('click'));
    component.onContextMenu(new MouseEvent('contextmenu'));
    component.onResizeStart(new MouseEvent('mousedown'));
    component.removeWorkSession();
    component.setWorkSessionCompleted(true);
    component.deleteTask();
    component.markAsDone();
    component.markAsUnDone();
    component.estimateTime();
    await component.openCalendarEventLink();
    await component.deleteCalendarEvent();
    await component.rescheduleCalendarEvent();
    component.createCalendarEventAsTask();
    component.hideCalendarEvent();
    const drag = fixture.debugElement.injector.get(ScheduleWeekDragService);
    const source = { data: event, reset: jasmine.createSpy('reset') };
    drag.handleDragStarted({ source } as unknown as CdkDragStart<ScheduleEvent>);
    expect(drag.isDragging()).toBeFalse();
    drag.handleDragReleased({ source } as unknown as CdkDragRelease<ScheduleEvent>);
    expect(source.reset).toHaveBeenCalled();
    for (const token of [
      EventService,
      WorkSessionService,
      CalendarEventActionsService,
    ] as const) {
      for (const value of Object.values(TestBed.inject(token as typeof EventService))) {
        if (jasmine.isSpy(value)) expect(value).not.toHaveBeenCalled();
      }
    }
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
    expect(TestBed.inject(TaskService).setSelectedId).not.toHaveBeenCalled();
  });

  it('keeps all generated items out of the global persisted projection and store', () => {
    const snapshot = JSON.stringify([allDay, overnight, local, session]);
    const calendar = TestBed.inject(CalendarDisplayService);
    const day = service.createScheduleDaysComputed(signal(['2026-01-15']));
    expect(
      day()
        .flatMap((value) => value.entries)
        .some((entry) => entry.type === SVEType.EventOccurrence),
    ).toBeTrue();
    expect(
      day()
        .flatMap((value) => value.entries)
        .every((entry) =>
          [SVEType.EventOccurrence, SVEType.LocalEvent, SVEType.WorkSession].includes(
            entry.type,
          ),
        ),
    ).toBeTrue();
    expect(calendar.items()).toEqual([local, session]);
    expect(store.selectSignal(selectAllEventSeries)()).toEqual([allDay, overnight]);
    expect(JSON.stringify([allDay, overnight, local, session])).toBe(snapshot);
  });
});
