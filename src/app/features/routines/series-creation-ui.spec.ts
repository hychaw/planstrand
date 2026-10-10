import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Store, provideStore } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { getFullStateRequiredCapabilities, ROUTINES_V1 } from '@sp/shared-schema';
import { of } from 'rxjs';
import EN_TRANSLATIONS from '../../../assets/i18n/en.json';
import { DateService } from '../../core/date/date.service';
import { T } from '../../t.const';
import { GlobalConfigService } from '../config/global-config.service';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import {
  DialogEventComponent,
  EventDialogData,
} from '../event/dialog-event/dialog-event.component';
import { EventService } from '../event/event.service';
import { eventReducer } from '../event/store/event.reducer';
import { CalendarDisplayService } from '../schedule/calendar-display.service';
import { EventOccurrenceDisplayItem } from '../schedule/calendar-display-item.model';
import { selectLocalCalendarDisplayItems } from '../schedule/calendar-display-item.selectors';
import { selectLocalizationConfig } from '../config/store/global-config.reducer';
import { eventSeriesReducer } from './store/event-series.reducer';
import {
  selectAllEventSeries,
  selectEventSeriesFeatureState,
} from './store/event-series.selectors';
import { occurrenceExceptionReducer } from './store/occurrence-exception.reducer';
import { isValidEventSeries } from './event-series.validation';

describe('recurring Event creation UI with real commands and Calendar projection', () => {
  let data: EventDialogData;
  let fixture: ComponentFixture<DialogEventComponent>;
  let store: Store;
  let close: jasmine.Spy;
  let writes: jasmine.Spy;
  let configuredTimeZone: string | undefined;
  beforeEach(async () => {
    data = { date: '2026-01-05' };
    configuredTimeZone = 'Asia/Tokyo';
    close = jasmine.createSpy('close');
    selectLocalizationConfig.setResult({ timeZone: 'UTC' });
    // Keep the real one-off Event selector; only unrelated Task/session projection is stubbed.
    selectLocalCalendarDisplayItems.setResult([]);
    await TestBed.configureTestingModule({
      imports: [DialogEventComponent, TranslateModule.forRoot()],
      providers: [
        provideStore({
          event: eventReducer,
          eventSeries: eventSeriesReducer,
          occurrenceException: occurrenceExceptionReducer,
        }),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: DateService, useValue: { todayStr: () => '2026-01-05' } },
        {
          provide: GlobalConfigService,
          useValue: { localization: () => ({ timeZone: configuredTimeZone }) },
        },
        { provide: CalendarIntegrationService, useValue: { calendarEvents$: of([]) } },
        {
          provide: HiddenCalendarProvidersService,
          useValue: { hiddenProviderIds: signal([]) },
        },
      ],
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', EN_TRANSLATIONS);
    translate.use('en');
    store = TestBed.inject(Store);
    writes = spyOn(store, 'dispatch').and.callThrough();
  });
  afterEach(() => {
    fixture?.destroy();
    for (const [action] of writes.calls.allArgs())
      expect(['EVENT', 'EVENT_SERIES']).toContain(action.meta.entityType);
    selectLocalCalendarDisplayItems.release();
    selectLocalCalendarDisplayItems.clearResult();
    selectLocalizationConfig.release();
    selectLocalizationConfig.clearResult();
  });
  const editor = async (): Promise<DialogEventComponent> => {
    fixture = TestBed.createComponent(DialogEventComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.title = 'Created routine';
    return fixture.componentInstance;
  };
  const series = (): ReturnType<typeof selectAllEventSeries> =>
    store.selectSignal(selectAllEventSeries)();
  const read = (
    fromDate = '2026-01-01',
    toDateExclusive = '2026-04-01',
  ): ReturnType<CalendarDisplayService['itemsForDays']> => {
    return TestBed.inject(CalendarDisplayService).createItemsForRangeComputed(
      signal({ fromDate, toDateExclusive }),
    )();
  };
  const save = async (component: DialogEventComponent): Promise<void> => {
    component.save();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('defaults to one-off creation with the existing end-time fields and no Routines activation', async () => {
    const component = await editor();
    expect(component.repeats).toBeFalse();
    expect(
      fixture.nativeElement.querySelector('select[name="creationRepeat"]').value,
    ).toBe('none');
    expect(fixture.nativeElement.querySelector('input[name="end"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="interval"]')).toBeNull();
    await save(component);
    component.save();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.calls.first().args[0].meta.entityType).toBe('EVENT');
    expect(series()).toEqual([]);
    expect(Object.values(TestBed.inject(EventService).entities()).length).toBe(1);
    expect(read().length).toBe(1);
    expect(
      getFullStateRequiredCapabilities({
        eventSeries: store.selectSignal(selectEventSeriesFeatureState)(),
      }),
    ).toEqual([]);
  });

  for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
    for (const isAllDay of [true, false]) {
      it(`creates exactly one ${isAllDay ? 'all-day' : 'timed'} ${frequency} series with one initial segment`, async () => {
        const calendar = TestBed.inject(
          CalendarDisplayService,
        ).createItemsForDaysComputed(signal(['2026-01-05', '2026-01-07', '2026-02-05']));
        expect(calendar()).toEqual([]);
        const component = await editor();
        component.changeCreationRepeat(frequency);
        component.isAllDay = isAllDay;
        component.interval = 2;
        component.recurrenceEndDate = '2026-12-31';
        if (frequency === 'weekly') component.weekdays = [1, 3, 5];
        component.durationMinutes = 90;
        await save(component);
        component.save();
        component.changeCreationRepeat('none');
        expect(writes).toHaveBeenCalledTimes(1);
        expect(writes.calls.first().args[0].meta.entityType).toBe('EVENT_SERIES');
        expect(series().length).toBe(1);
        const created = series()[0];
        expect(isValidEventSeries(created)).toBeTrue();
        expect(created.title).toBe('Created routine');
        expect(created.segments.length).toBe(1);
        expect(created.segments[0].logicalSlotOffset ?? 0).toBe(0);
        expect(created.segments[0].recurrence).toEqual(
          jasmine.objectContaining({
            frequency,
            interval: 2,
            startDate: '2026-01-05',
            endDate: '2026-12-31',
            ...(frequency === 'weekly' ? { weekdays: [1, 3, 5] } : {}),
          }),
        );
        expect(created.segments[0].timing).toEqual(
          isAllDay
            ? { kind: 'allDay' }
            : {
                kind: 'timed',
                localTime: '09:00',
                timeZone: 'Asia/Tokyo',
                durationMs: 5400000,
              },
        );
        expect(Object.values(TestBed.inject(EventService).entities())).toEqual([]);
        expect(calendar().length).toBeGreaterThan(0);
        expect(
          calendar().every((item) => item.sourceType === 'eventOccurrence'),
        ).toBeTrue();
        expect(new Set(calendar().map((item) => item.id)).size).toBe(calendar().length);
        expect(
          getFullStateRequiredCapabilities({
            eventSeries: store.selectSignal(selectEventSeriesFeatureState)(),
          }),
        ).toEqual([ROUTINES_V1]);
        expect(close).toHaveBeenCalledOnceWith(true);
      });
    }
  }

  it('retains Calendar anchor date/time and carries an edited elapsed duration into recurrence controls', async () => {
    data.start = Date.parse('2026-01-05T23:30:00Z');
    const component = await editor();
    expect(component.date).toBe('2026-01-06');
    expect(component.startTime).toBe('08:30');
    component.endTime = '10:00';
    component.changeCreationRepeat('weekly');
    expect(component.durationMinutes).toBe(90);
    expect(component.weekdays).toEqual([2]);
    await save(component);
    expect(series()[0].segments[0].recurrence.startDate).toBe('2026-01-06');
    expect(series()[0].segments[0].timing).toEqual(
      jasmine.objectContaining({ localTime: '08:30', durationMs: 5400000 }),
    );
  });

  it('returns to the one-off path and preserves recurrence settings when toggled back', async () => {
    const component = await editor();
    component.changeCreationRepeat('monthly');
    component.interval = 3;
    component.changeCreationRepeat('none');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="interval"]')).toBeNull();
    component.changeCreationRepeat('monthly');
    expect(component.interval).toBe(3);
    component.changeCreationRepeat('none');
    await save(component);
    expect(series()).toEqual([]);
    expect(writes.calls.first().args[0].meta.entityType).toBe('EVENT');
  });

  it('skips invalid monthly dates and includes the end boundary', async () => {
    const component = await editor();
    component.date = '2026-01-31';
    component.isAllDay = true;
    component.changeCreationRepeat('monthly');
    component.recurrenceEndDate = '2026-03-31';
    await save(component);
    expect(read().map((item) => item.date)).toEqual(['2026-01-31', '2026-03-31']);
  });

  it('uses ISO weekdays and the existing Monday-based interval phase', async () => {
    const component = await editor();
    component.date = '2026-01-07';
    component.isAllDay = true;
    component.changeCreationRepeat('weekly');
    component.weekdays = [1, 3, 7];
    component.interval = 2;
    component.recurrenceEndDate = '2026-01-25';
    await save(component);
    expect(read().map((item) => item.date)).toEqual([
      '2026-01-07',
      '2026-01-11',
      '2026-01-19',
      '2026-01-21',
      '2026-01-25',
    ]);
  });

  it('allows a DST-gap anchor, skips its reserved slot, and uses the earlier fold instant', async () => {
    let component = await editor();
    component.changeCreationRepeat('daily');
    component.date = '2026-03-08';
    component.startTime = '02:30';
    component.timeZone = 'America/New_York';
    component.recurrenceEndDate = '2026-03-09';
    await save(component);
    const gap = read('2026-03-08', '2026-03-10');
    expect(gap.length).toBe(1);
    expect((gap[0] as EventOccurrenceDisplayItem).occurrence.slot).toBe(1);
    expect(gap[0].start).toBe(Date.parse('2026-03-09T06:30:00Z'));
    fixture.destroy();
    component = await editor();
    component.changeCreationRepeat('daily');
    component.date = '2026-11-01';
    component.startTime = '01:30';
    component.durationMinutes = 90;
    component.timeZone = 'America/New_York';
    component.recurrenceEndDate = '2026-11-01';
    await save(component);
    const fold = read('2026-11-01', '2026-11-02');
    expect(fold[0].start).toBe(Date.parse('2026-11-01T05:30:00Z'));
    expect(fold[0].end).toBe(Date.parse('2026-11-01T07:00:00Z'));
  });

  it('uses the valid system timezone when no configured timezone is set', async () => {
    configuredTimeZone = undefined;
    const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const component = await editor();
    component.changeCreationRepeat('daily');
    expect(component.timeZone).toBe(systemZone);
    await save(component);
    expect(series()[0].segments[0].timing).toEqual(
      jasmine.objectContaining({ timeZone: systemZone }),
    );
  });

  it('requires an explicit timed timezone when the system cannot supply one, without substituting UTC', async () => {
    configuredTimeZone = undefined;
    spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').and.returnValue({
      ...Intl.DateTimeFormat().resolvedOptions(),
      timeZone: undefined as unknown as string,
    });
    const component = await editor();
    component.changeCreationRepeat('daily');
    expect(component.timeZone).toBe('');
    await save(component);
    expect(series()).toEqual([]);
    expect(component.seriesError()).toBe(T.F.EVENT.CREATION_INVALID);
    component.timeZone = 'UTC';
    await save(component);
    expect(series()[0].segments[0].timing).toEqual(
      jasmine.objectContaining({ timeZone: 'UTC' }),
    );
  });

  it('allows floating all-day creation with an invalid configured zone and no end date', async () => {
    configuredTimeZone = 'Missing/Zone';
    const component = await editor();
    component.changeCreationRepeat('daily');
    expect(component.timeZone).toBe('');
    component.isAllDay = true;
    await save(component);
    expect(series()[0].segments[0].timing).toEqual({ kind: 'allDay' });
    expect(series()[0].segments[0].recurrence.endDate).toBeUndefined();
    expect(read('2030-01-01', '2030-01-02').length).toBe(1);
  });

  const invalid: Partial<DialogEventComponent>[] = [
    { title: ' ' },
    { date: '2026-02-30' },
    { interval: 0 },
    { interval: -1 },
    { interval: 1.5 },
    { frequency: 'weekly', weekdays: [] },
    { frequency: 'weekly', weekdays: [0, 8] },
    { timeZone: 'Missing/Zone' },
    { timeZone: '+09:00' },
    { startTime: '24:00' },
    { durationMinutes: 0 },
    { durationMinutes: -10 },
    { recurrenceEndDate: '2026-01-01' },
  ];
  invalid.forEach((fields, index) => {
    it(`retains invalid creation draft ${index} without persisting anything and allows correction`, async () => {
      const component = await editor();
      component.changeCreationRepeat('daily');
      Object.assign(component, fields);
      await save(component);
      expect(series()).toEqual([]);
      expect(writes).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(component.busy()).toBeFalse();
      expect(component.seriesError()).toBe(T.F.EVENT.CREATION_INVALID);
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
        'Enter a title',
      );
      for (const [key, value] of Object.entries(fields))
        expect(component[key as keyof DialogEventComponent]).toEqual(value);
      Object.assign(component, {
        title: 'Corrected',
        date: '2026-01-05',
        interval: 1,
        frequency: 'daily',
        timeZone: 'Asia/Tokyo',
        startTime: '09:00',
        durationMinutes: 60,
        recurrenceEndDate: '',
      });
      await save(component);
      expect(series().length).toBe(1);
    });
  });
});
