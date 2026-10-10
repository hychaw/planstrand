import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Store, provideStore } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import EN_TRANSLATIONS from '../../../assets/i18n/en.json';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { T } from '../../t.const';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import {
  selectLocalizationConfig,
  selectTimelineConfig,
} from '../config/store/global-config.reducer';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import { CalendarEventActionsService } from '../calendar-integration/calendar-event-actions.service';
import { selectPersistedCalendarDisplayItems } from '../schedule/calendar-display-item.selectors';
import { ScheduleService } from '../schedule/schedule.service';
import { ScheduleWeekComponent } from '../schedule/schedule-week/schedule-week.component';
import { ScheduleMonthComponent } from '../schedule/schedule-month/schedule-month.component';
import { ScheduleYearComponent } from '../schedule/schedule-year/schedule-year.component';
import { mapScheduleDaysToScheduleEvents } from '../schedule/map-schedule-data/map-schedule-days-to-schedule-events';
import { FH } from '../schedule/schedule.const';
import { calendarDayStart } from '../schedule/calendar-time';
import { TaskService } from '../tasks/task.service';
import { WorkSessionService } from '../work-session/work-session.service';
import { selectTimelineTasks } from '../work-context/store/work-context.selectors';
import { selectPlannerDayMap } from '../planner/store/planner.selectors';
import { selectTaskRepeatCfgsWithAndWithoutStartTime } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import {
  DialogEventComponent,
  EventDialogData,
} from '../event/dialog-event/dialog-event.component';
import { EventService } from '../event/event.service';
import { eventReducer } from '../event/store/event.reducer';
import { projectEventOccurrences } from '../schedule/project-event-occurrences';
import { EventSeries } from './event-series.model';
import { EventSeriesService } from './event-series.service';
import { OccurrenceExceptionService } from './occurrence-exception.service';
import { resolveEventOccurrence } from './resolve-event-occurrence';
import { addEventSeries } from './store/event-series.actions';
import { eventSeriesReducer } from './store/event-series.reducer';
import { selectAllEventSeries } from './store/event-series.selectors';
import { occurrenceExceptionReducer } from './store/occurrence-exception.reducer';
import { selectAllOccurrenceException } from './store/occurrence-exception.selectors';

describe('series editing UI with real commands, reducers and bounded projection', () => {
  const series: EventSeries = {
    id: 'editing-series',
    title: 'Original series',
    created: 1,
    modified: 1,
    segments: [
      {
        id: 'original-segment',
        recurrence: {
          frequency: 'daily',
          interval: 1,
          startDate: '2026-01-05',
          endDate: '2026-12-31',
        },
        timing: {
          kind: 'timed',
          localTime: '09:00',
          timeZone: 'Asia/Tokyo',
          durationMs: 3600123,
        },
      },
    ],
  };
  let store: Store;
  let commands: EventSeriesService;
  let exceptions: OccurrenceExceptionService;
  let fixture: ComponentFixture<DialogEventComponent>;
  let data: EventDialogData;
  let close: jasmine.Spy;
  let confirm: jasmine.Spy;
  let writes: jasmine.Spy;
  let events: jasmine.SpyObj<EventService>;
  const calendarSelectors = [
    selectLocalizationConfig,
    selectTimelineConfig,
    selectPersistedCalendarDisplayItems,
    selectTimelineTasks,
    selectPlannerDayMap,
    selectTaskRepeatCfgsWithAndWithoutStartTime,
  ];

  beforeEach(async () => {
    selectLocalizationConfig.setResult({ timeZone: 'UTC' });
    selectTimelineConfig.setResult({
      isWorkStartEndEnabled: false,
      isLunchBreakEnabled: false,
      workStart: '09:00',
      workEnd: '17:00',
      lunchBreakStart: '12:00',
      lunchBreakEnd: '13:00',
    });
    selectPersistedCalendarDisplayItems.setResult([]);
    selectTimelineTasks.setResult({ planned: [], unPlanned: [] });
    selectPlannerDayMap.setResult({});
    selectTaskRepeatCfgsWithAndWithoutStartTime.setResult({
      withStartTime: [],
      withoutStartTime: [],
    });
    data = { occurrence: { seriesId: series.id, slot: 2 } };
    close = jasmine.createSpy('close');
    confirm = jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(true) });
    events = jasmine.createSpyObj('events', ['create', 'update', 'remove']);
    Object.defineProperty(events, 'entities', { value: signal({}) });
    await TestBed.configureTestingModule({
      imports: [
        DialogEventComponent,
        ScheduleWeekComponent,
        ScheduleMonthComponent,
        ScheduleYearComponent,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideNoopAnimations(),
        provideStore({
          eventSeries: eventSeriesReducer,
          occurrenceException: occurrenceExceptionReducer,
          event: eventReducer,
        }),
        { provide: EventService, useValue: events },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: DateService, useValue: { todayStr: () => '2026-01-05' } },
        {
          provide: GlobalConfigService,
          useValue: {
            localization: () => ({ timeZone: 'America/Los_Angeles' }),
            cfg: signal(DEFAULT_GLOBAL_CONFIG),
          },
        },
        { provide: CalendarIntegrationService, useValue: { calendarEvents$: of([]) } },
        {
          provide: HiddenCalendarProvidersService,
          useValue: { hiddenProviderIds: signal([]) },
        },
        {
          provide: DateTimeFormatService,
          useValue: {
            currentLocale: () => 'en-US',
            textLocale: () => 'en-US',
            isoTextLocale: () => 'en-US',
            is24HourFormat: () => true,
          },
        },
        { provide: TaskService, useValue: { currentTaskId: signal(null) } },
        {
          provide: WorkSessionService,
          useValue: jasmine.createSpyObj('sessions', ['update', 'remove']),
        },
        {
          provide: CalendarEventActionsService,
          useValue: jasmine.createSpyObj('providers', [
            'hasEventUrl',
            'isPluginEvent',
            'canMoveEvent',
          ]),
        },
      ],
    })
      .overrideProvider(MatDialog, { useValue: { open: confirm } })
      .compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', EN_TRANSLATIONS);
    translate.use('en');
    store = TestBed.inject(Store);
    commands = TestBed.inject(EventSeriesService);
    exceptions = TestBed.inject(OccurrenceExceptionService);
    store.dispatch(addEventSeries({ eventSeries: structuredClone(series) }));
    writes = spyOn(store, 'dispatch').and.callThrough();
  });
  afterEach(() => {
    fixture?.destroy();
    for (const [action] of writes.calls.allArgs()) {
      expect(['EVENT_SERIES', 'OCCURRENCE_EXCEPTION']).toContain(action.meta.entityType);
    }
    expect(events.create).not.toHaveBeenCalled();
    expect(events.update).not.toHaveBeenCalled();
    expect(events.remove).not.toHaveBeenCalled();
    for (const selector of calendarSelectors) {
      selector.release();
      selector.clearResult();
    }
  });
  const editor = async (
    scope: 'occurrence' | 'future' | 'series' = 'occurrence',
  ): Promise<DialogEventComponent> => {
    fixture?.destroy();
    fixture = TestBed.createComponent(DialogEventComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.changeScope(scope);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  };
  const save = async (component: DialogEventComponent): Promise<void> => {
    component.save();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const current = (): EventSeries => commands.entities()[series.id]!;
  const occurrence = (slot: number): ReturnType<typeof resolveEventOccurrence> =>
    resolveEventOccurrence(current(), { seriesId: series.id, slot });
  const projected = (): ReturnType<typeof projectEventOccurrences> =>
    projectEventOccurrences(
      store.selectSignal(selectAllEventSeries)(),
      { fromDate: '2026-01-01', toDateExclusive: '2027-01-01' },
      'UTC',
      store.selectSignal(selectAllOccurrenceException)(),
    );

  it('offers all scopes, distinct cancellation/deletion, and recurrence controls only for series scopes', async () => {
    const component = await editor();
    const select = fixture.nativeElement.querySelector(
      'select[name="scope"]',
    ) as HTMLSelectElement;
    expect(
      Array.from(select.options).map((option) => option.textContent?.trim()),
    ).toEqual(['This occurrence', 'This and future', 'Entire series']);
    expect(fixture.nativeElement.textContent).toContain('Cancel this occurrence');
    expect(fixture.nativeElement.textContent).toContain('Delete entire series');
    expect(fixture.nativeElement.querySelector('[name="frequency"]')).toBeNull();
    select.value = 'future';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.scope).toBe('future');
    expect(fixture.nativeElement.querySelector('[name="frequency"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[name="end"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Cancel this occurrence');
    await fixture.whenStable();
    const frequency = fixture.nativeElement.querySelector(
      'select[name="frequency"]',
    ) as HTMLSelectElement;
    frequency.value = 'weekly';
    frequency.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.frequency).toBe('weekly');
    await fixture.whenStable();
    const weekdays = fixture.nativeElement.querySelectorAll('.weekdays input');
    expect(weekdays.length).toBe(7);
    weekdays[0].click();
    weekdays[2].click();
    await fixture.whenStable();
    await save(component);
    expect(current().segments[1].recurrence).toEqual(
      jasmine.objectContaining({ frequency: 'weekly', weekdays: [3] }),
    );
  });

  for (const view of ['Day', 'Week', 'Month', 'Year'] as const) {
    it(`renders a saved scope edit and whole-series deletion immediately in ${view}`, async () => {
      const component = await editor('future');
      const service = TestBed.inject(ScheduleService);
      const days =
        view === 'Day'
          ? ['2026-01-07']
          : service.getDaysToShow(view === 'Week' ? 7 : 35, new Date(2026, 0, 5));
      const read = (): ReturnType<typeof mapScheduleDaysToScheduleEvents> => {
        const start = calendarDayStart(days[0], 'UTC');
        return mapScheduleDaysToScheduleEvents(
          service.createScheduleDaysWithContext({
            daysToShow: days,
            contextNow: start,
            realNow: start,
            currentTaskId: null,
          }),
          FH,
          'UTC',
        );
      };
      const beforeId = read().eventsFlat.find(
        (event) => event.plannedForDay === '2026-01-07',
      )!.id;
      component.frequency = 'weekly';
      component.weekdays = [3];
      component.title = 'Edited series scope';
      await save(component);
      const edited = read().eventsFlat;
      expect(edited.find((event) => event.plannedForDay === '2026-01-07')?.id).toBe(
        beforeId,
      );
      expect(edited.some((event) => event.plannedForDay === '2026-01-08')).toBeFalse();
      const calendar =
        view === 'Year'
          ? TestBed.createComponent(ScheduleYearComponent)
          : view === 'Month'
            ? TestBed.createComponent(ScheduleMonthComponent)
            : TestBed.createComponent(ScheduleWeekComponent);
      if (view === 'Year') calendar.componentRef.setInput('year', 2026);
      else {
        calendar.componentRef.setInput('daysToShow', days);
        calendar.componentRef.setInput('events', edited);
        if (view === 'Month') calendar.componentRef.setInput('weeksToShow', 5);
      }
      calendar.detectChanges();
      if (calendar.componentInstance instanceof ScheduleYearComponent) {
        expect(calendar.componentInstance.months()[0].days[6].count).toBe(1);
        expect(calendar.componentInstance.months()[0].days[7].count).toBe(0);
      } else expect(calendar.nativeElement.textContent).toContain('Edited series scope');
      await component.deleteEntireSeries();
      expect(read().eventsFlat).toEqual([]);
      if (view !== 'Year') calendar.componentRef.setInput('events', read().eventsFlat);
      calendar.detectChanges();
      if (calendar.componentInstance instanceof ScheduleYearComponent)
        expect(
          calendar.componentInstance.months()[0].days.every((day) => day.count === 0),
        ).toBeTrue();
      else expect(calendar.nativeElement.querySelector('schedule-event')).toBeNull();
      calendar.destroy();
    });
  }

  it('initializes each scope from its definition and preserves drafts when switching scopes', async () => {
    exceptions.edit(data.occurrence!, {
      title: 'Moved override',
      isAllDay: true,
      date: '2028-01-01',
    });
    const snapshot = JSON.stringify(exceptions.entities());
    const component = await editor();
    expect(component.title).toBe('Moved override');
    component.title = 'Unsaved occurrence';
    component.changeScope('future');
    expect(component.date).toBe('2026-01-07');
    expect(component.title).toBe(series.title);
    expect(component.isAllDay).toBeFalse();
    expect(component.startTime).toBe('09:00');
    expect(component.timeZone).toBe('Asia/Tokyo');
    component.title = 'Unsaved future';
    component.changeScope('series');
    expect(component.date).toBe('2026-01-05');
    expect(component.title).toBe(series.title);
    component.changeScope('occurrence');
    expect(component.title).toBe('Unsaved occurrence');
    expect(component.date).toBe('2028-01-01');
    component.changeScope('future');
    expect(component.title).toBe('Unsaved future');
    expect(JSON.stringify(exceptions.entities())).toBe(snapshot);
  });

  it('targets the original slot of a moved override and preserves earlier occurrences and exceptions', async () => {
    exceptions.edit(
      { seriesId: series.id, slot: 0 },
      { title: 'Earlier override', isAllDay: true, date: '2026-01-06' },
    );
    exceptions.edit(data.occurrence!, {
      title: 'Moved override',
      isAllDay: true,
      date: '2028-01-01',
    });
    const before = occurrence(1);
    const snapshot = JSON.stringify(exceptions.entities());
    const component = await editor('future');
    component.title = 'Future title';
    component.isAllDay = true;
    await save(component);
    expect(current().segments[1].logicalSlotOffset).toBe(2);
    expect(occurrence(1)).toEqual(before);
    expect(occurrence(2)?.original).toEqual({
      title: 'Future title',
      isAllDay: true,
      date: '2026-01-07',
    });
    expect(JSON.stringify(exceptions.entities())).toBe(snapshot);
    expect(confirm.calls.mostRecent().args[1].data.okTxt).toBe(
      T.F.EVENT.RETAIN_EXCEPTIONS,
    );
    expect(close).toHaveBeenCalledWith(true);
  });

  it('preserves all segments and exact durations for an entire-series title-only edit', async () => {
    commands.editThisAndFuture(series.id, 2, {
      title: 'Segment title',
      timing: { kind: 'allDay' },
    });
    const before = current().segments.map(({ title, ...segment }) => segment);
    const component = await editor('series');
    component.title = 'Renamed series';
    await save(component);
    expect(current().segments).toEqual(before);
    expect(current().title).toBe('Renamed series');
    expect(occurrence(1)?.original.title).toBe('Renamed series');
    expect(occurrence(2)?.original.title).toBe('Renamed series');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('replaces the entire schedule from slot zero and explains changes to earlier occurrences', async () => {
    commands.editThisAndFuture(series.id, 2, { timing: { kind: 'allDay' } });
    const component = await editor('series');
    expect(fixture.nativeElement.textContent).toContain('including earlier occurrences');
    component.frequency = 'monthly';
    component.interval = 2;
    component.date = '2026-01-10';
    component.recurrenceEndDate = '2026-05-10';
    component.isAllDay = true;
    await save(component);
    expect(current().segments.length).toBe(1);
    expect(occurrence(0)?.scheduledDate).toBe('2026-01-10');
    expect(occurrence(1)?.scheduledDate).toBe('2026-03-10');
    expect(occurrence(2)?.scheduledDate).toBe('2026-05-10');
    expect(occurrence(3)).toBeNull();
    expect(projected().length).toBe(3);
  });

  it('supports successive daily/weekly/monthly splits and initializes later segments correctly', async () => {
    let component = await editor('future');
    component.title = 'Weekly segment';
    component.frequency = 'weekly';
    component.interval = 2;
    component.weekdays = [1, 5];
    component.isAllDay = true;
    await save(component);
    expect(occurrence(2)?.scheduledDate).toBe('2026-01-09');
    data.occurrence = { seriesId: series.id, slot: 4 };
    component = await editor('future');
    expect(component.title).toBe('Weekly segment');
    expect(component.frequency).toBe('weekly');
    expect(component.interval).toBe(2);
    expect(component.weekdays).toEqual([1, 5]);
    expect(component.date).toBe('2026-01-23');
    component.frequency = 'monthly';
    component.interval = 1;
    component.title = 'Monthly segment';
    await save(component);
    expect(current().segments.map((segment) => segment.logicalSlotOffset ?? 0)).toEqual([
      0, 2, 4,
    ]);
    expect(occurrence(3)?.scheduledDate).toBe('2026-01-19');
    expect(occurrence(4)?.scheduledDate).toBe('2026-01-23');
    expect(occurrence(5)?.scheduledDate).toBe('2026-02-23');
    expect(new Set(projected().map((item) => item.id)).size).toBe(projected().length);
  });

  it('keeps later planned schedules for a future title-only edit', async () => {
    commands.editThisAndFuture(series.id, 5, { timing: { kind: 'allDay' } });
    const later = current().segments[1];
    const component = await editor('future');
    component.title = 'Future metadata';
    await save(component);
    expect(current().segments[2]).toEqual({ ...later, title: 'Future metadata' });
    expect(occurrence(1)?.original.title).toBe(series.title);
  });

  it('converts all-day to timed with explicit timezone/duration and follows DST after the split', async () => {
    commands.editEntire(series.id, { timing: { kind: 'allDay' } });
    const component = await editor('future');
    component.isAllDay = false;
    component.timeZone = 'America/New_York';
    component.startTime = '09:00';
    component.durationMinutes = 90;
    component.date = '2026-03-07';
    await save(component);
    expect(occurrence(1)?.original.isAllDay).toBeTrue();
    expect(occurrence(2)?.original).toEqual(
      jasmine.objectContaining({
        start: Date.parse('2026-03-07T14:00:00Z'),
        end: Date.parse('2026-03-07T15:30:00Z'),
        timeZone: 'America/New_York',
      }),
    );
    expect(occurrence(3)?.original).toEqual(
      jasmine.objectContaining({ start: Date.parse('2026-03-08T13:00:00Z') }),
    );
  });

  it('shortens and removes the end boundary without deleting stored exceptions', async () => {
    exceptions.cancel({ seriesId: series.id, slot: 20 });
    const snapshot = JSON.stringify(exceptions.entities());
    let component = await editor('series');
    component.recurrenceEndDate = '2026-01-08';
    await save(component);
    expect(occurrence(4)).toBeNull();
    expect(JSON.stringify(exceptions.entities())).toBe(snapshot);
    component = await editor('series');
    component.recurrenceEndDate = '';
    await save(component);
    expect(current().segments[0].recurrence.endDate).toBeUndefined();
    expect(occurrence(400)).not.toBeNull();
    expect(JSON.stringify(exceptions.entities())).toBe(snapshot);
  });

  it('requires explicit retain consent, keeps unsaved data on decline, and never offers clear', async () => {
    exceptions.cancel({ seriesId: series.id, slot: 3 });
    const before = JSON.stringify(current());
    const answer = new Subject<boolean>();
    confirm.and.returnValue({ afterClosed: () => answer });
    const component = await editor('future');
    component.title = 'Unsaved changes';
    component.interval = 2;
    component.save();
    expect(component.busy()).toBeTrue();
    const confirmation = confirm.calls.mostRecent().args[1].data;
    expect(confirmation.message).toBe(T.F.EVENT.RETAIN_EXCEPTIONS_CONFIRM);
    expect(confirmation.okTxt).toBe(T.F.EVENT.RETAIN_EXCEPTIONS);
    expect(JSON.stringify(confirmation)).not.toContain('CLEAR');
    component.changeScope('series');
    expect(component.scope).toBe('future');
    answer.next(false);
    await fixture.whenStable();
    expect(JSON.stringify(current())).toBe(before);
    expect(component.title).toBe('Unsaved changes');
    expect(component.interval).toBe(2);
    expect(close).not.toHaveBeenCalled();
    confirm.and.returnValue({ afterClosed: () => of(true) });
    await save(component);
    expect(current().segments[1].recurrence.interval).toBe(2);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('shows a rejected clear-and-edit error without changing scope or losing form data', async () => {
    spyOn(commands, 'editThisAndFuture').and.returnValue({
      ok: false,
      reason: 'atomic-clear-unsupported',
    });
    const component = await editor('future');
    component.title = 'Keep my draft';
    await save(component);
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'unsupported',
    );
    expect(component.scope).toBe('future');
    expect(component.title).toBe('Keep my draft');
    expect(close).not.toHaveBeenCalled();
  });

  const invalid: Partial<DialogEventComponent>[] = [
    { title: ' ' },
    { date: '2026-02-30' },
    { interval: 1.5 },
    { interval: 0 },
    { frequency: 'weekly', weekdays: [] },
    { durationMinutes: 0 },
    { timeZone: 'Missing/Zone' },
    { timeZone: '+09:00' },
    { recurrenceEndDate: '2026-01-01' },
    { date: '2026-03-08', startTime: '02:30', timeZone: 'America/New_York' },
  ];
  invalid.forEach((fields, index) => {
    it(`rejects invalid series input ${index} while retaining the draft`, async () => {
      const component = await editor('future');
      Object.assign(component, fields);
      writes.calls.reset();
      await save(component);
      expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
      expect(component.seriesError()).toBe(T.F.EVENT.SERIES_INVALID);
      expect(writes).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      for (const [key, value] of Object.entries(fields))
        expect(component[key as keyof DialogEventComponent]).toEqual(value);
    });
  });

  it('requires deletion confirmation and immediately suppresses generated and moved occurrences', async () => {
    exceptions.edit(data.occurrence!, {
      title: 'Moved in',
      isAllDay: true,
      date: '2026-02-01',
    });
    const snapshot = JSON.stringify(exceptions.entities());
    const component = await editor();
    confirm.and.returnValue({ afterClosed: () => of(false) });
    await component.deleteEntireSeries();
    expect(current().deletedAt).toBeUndefined();
    confirm.and.returnValue({ afterClosed: () => of(true) });
    await component.deleteEntireSeries();
    expect(confirm.calls.mostRecent().args[1].data.message).toBe(
      T.F.EVENT.DELETE_SERIES_CONFIRM,
    );
    expect(current().deletedAt).toBeDefined();
    expect(projected()).toEqual([]);
    expect(JSON.stringify(exceptions.entities())).toBe(snapshot);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('reports concurrent deletion without discarding the draft', async () => {
    const component = await editor('future');
    component.title = 'Unsaved draft';
    commands.deleteEntire(series.id);
    await save(component);
    expect(component.seriesError()).toBe(T.F.EVENT.OCCURRENCE_UNAVAILABLE);
    expect(component.title).toBe('Unsaved draft');
    expect(fixture.nativeElement.querySelector('input[name="title"]').value).toBe(
      'Unsaved draft',
    );
    expect(close).not.toHaveBeenCalled();
  });
});
