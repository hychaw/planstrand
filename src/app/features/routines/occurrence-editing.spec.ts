import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Store, provideStore } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DateService } from '../../core/date/date.service';
import { GlobalConfigService } from '../config/global-config.service';
import { selectLocalizationConfig } from '../config/store/global-config.reducer';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import { CalendarDisplayService } from '../schedule/calendar-display.service';
import { selectPersistedCalendarDisplayItems } from '../schedule/calendar-display-item.selectors';
import {
  DialogEventComponent,
  EventDialogData,
} from '../event/dialog-event/dialog-event.component';
import { EventService } from '../event/event.service';
import { eventReducer } from '../event/store/event.reducer';
import { EventSeries } from './event-series.model';
import { eventSeriesReducer } from './store/event-series.reducer';
import { selectAllEventSeries } from './store/event-series.selectors';
import { addEventSeries } from './store/event-series.actions';
import { occurrenceExceptionReducer } from './store/occurrence-exception.reducer';
import { selectAllOccurrenceException } from './store/occurrence-exception.selectors';
import { setOccurrenceException } from './store/occurrence-exception.actions';
import { OccurrenceExceptionService } from './occurrence-exception.service';
import { occurrenceExceptionId } from './occurrence-exception.validation';
import { DialogCancelledOccurrencesComponent } from './dialog-cancelled-occurrences/dialog-cancelled-occurrences.component';

describe('recurring occurrence editor (real commands, reducers and Calendar projection)', () => {
  const series: EventSeries = {
    id: 'series:日本語',
    title: 'Morning routine',
    created: 1,
    modified: 1,
    segments: [
      {
        id: 'segment',
        logicalSlotOffset: 40,
        recurrence: {
          frequency: 'daily',
          startDate: '2026-01-05',
          endDate: '2026-01-07',
          interval: 1,
        },
        timing: {
          kind: 'timed',
          localTime: '09:00',
          timeZone: 'Asia/Tokyo',
          durationMs: 3600000,
        },
      },
    ],
  };
  const floating: EventSeries = {
    ...series,
    id: 'floating',
    title: 'All-day routine',
    segments: [
      {
        ...series.segments[0],
        logicalSlotOffset: 0,
        timing: { kind: 'allDay' },
      },
    ],
  };
  const key = { seriesId: series.id, slot: 40 };
  let data: EventDialogData;
  let store: Store;
  let exceptions: OccurrenceExceptionService;
  let writes: jasmine.Spy;
  let dialog: jasmine.Spy;
  let close: jasmine.Spy;
  let fixture: ComponentFixture<DialogEventComponent> | undefined;
  let parentSnapshot: string;
  let events: jasmine.SpyObj<EventService>;

  beforeEach(async () => {
    data = { occurrence: key };
    close = jasmine.createSpy('close');
    dialog = jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(true) });
    events = jasmine.createSpyObj('events', ['create', 'update', 'remove']);
    Object.defineProperty(events, 'entities', { value: signal({}) });
    // Unrelated Task/provider data remains outside this focused fixture.
    selectPersistedCalendarDisplayItems.setResult([]);
    selectLocalizationConfig.setResult({ timeZone: 'UTC' });
    TestBed.configureTestingModule({
      imports: [
        DialogEventComponent,
        DialogCancelledOccurrencesComponent,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideStore({
          eventSeries: eventSeriesReducer,
          occurrenceException: occurrenceExceptionReducer,
          event: eventReducer,
        }),
        { provide: EventService, useValue: events },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MatDialog, useValue: { open: dialog } },
        { provide: DateService, useValue: { todayStr: () => '2026-01-05' } },
        {
          provide: GlobalConfigService,
          useValue: { localization: () => ({ timeZone: 'America/Los_Angeles' }) },
        },
        { provide: CalendarIntegrationService, useValue: { calendarEvents$: of([]) } },
        {
          provide: HiddenCalendarProvidersService,
          useValue: { hiddenProviderIds: signal([]) },
        },
      ],
    });
    TestBed.overrideProvider(MatDialog, { useValue: { open: dialog } });
    await TestBed.compileComponents();
    store = TestBed.inject(Store);
    store.dispatch(addEventSeries({ eventSeries: structuredClone(series) }));
    store.dispatch(addEventSeries({ eventSeries: structuredClone(floating) }));
    parentSnapshot = JSON.stringify(store.selectSignal(selectAllEventSeries)());
    writes = spyOn(store, 'dispatch').and.callThrough();
    exceptions = TestBed.inject(OccurrenceExceptionService);
  });
  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    expect(JSON.stringify(store.selectSignal(selectAllEventSeries)())).toBe(
      parentSnapshot,
    );
    for (const [action] of writes.calls.allArgs()) {
      expect(action.type).toBe(setOccurrenceException.type);
      expect(action.meta.entityType).toBe('OCCURRENCE_EXCEPTION');
    }
    expect(events.create).not.toHaveBeenCalled();
    expect(events.update).not.toHaveBeenCalled();
    expect(events.remove).not.toHaveBeenCalled();
    selectPersistedCalendarDisplayItems.release();
    selectPersistedCalendarDisplayItems.clearResult();
    selectLocalizationConfig.release();
    selectLocalizationConfig.clearResult();
  });
  const editor = async (): Promise<DialogEventComponent> => {
    fixture?.destroy();
    fixture = TestBed.createComponent(DialogEventComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  };
  const fill = async (name: string, value: string): Promise<void> => {
    const input = fixture!.nativeElement.querySelector(
      `input[name="${name}"]`,
    ) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture!.whenStable();
    fixture!.detectChanges();
  };

  it('edits title/date/start/end in the stored scheduling zone and updates bounded queries without duplicates', async () => {
    const calendar = TestBed.inject(CalendarDisplayService);
    const oldDay = calendar.createItemsForDaysComputed(signal(['2026-01-05']));
    const newDay = calendar.createItemsForDaysComputed(signal(['2026-01-06']));
    const original = oldDay().find((item) => item.sourceId === series.id)!;
    const component = await editor();
    expect(component.occurrenceKey).toEqual(key);
    expect(component.timeZone).toBe('Asia/Tokyo');
    expect(component.date).toBe('2026-01-05');
    expect(component.startTime).toBe('09:00');
    expect(fixture!.nativeElement.textContent).toContain('F.EVENT.OCCURRENCE_SCOPE');
    expect(
      fixture!.nativeElement.querySelector('button[color="warn"]').textContent,
    ).toContain('F.EVENT.CANCEL_OCCURRENCE');
    expect(fixture!.nativeElement.textContent).not.toContain('Entire series');
    await fill('title', 'Edited title');
    await fill('date', '2026-01-06');
    await fill('start', '10:00');
    await fill('end', '11:30');
    fixture!.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(writes).toHaveBeenCalledTimes(1);
    const exception = exceptions.entities()[occurrenceExceptionId(key)]!;
    expect(exception.value).toEqual({
      kind: 'override',
      event: {
        title: 'Edited title',
        isAllDay: false,
        start: Date.parse('2026-01-06T01:00:00Z'),
        end: Date.parse('2026-01-06T02:30:00Z'),
        timeZone: 'Asia/Tokyo',
      },
    });
    expect(exception.seriesId).toBe(key.seriesId);
    expect(exception.slot).toBe(key.slot);
    expect(oldDay().some((item) => item.id === original.id)).toBeFalse();
    expect(newDay().filter((item) => item.id === original.id).length).toBe(1);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('initializes re-edits from the override and replaces the same exception', async () => {
    exceptions.edit(key, {
      title: 'Existing override',
      isAllDay: false,
      start: Date.parse('2028-04-20T12:30:00Z'),
      end: Date.parse('2028-04-21T14:30:00Z'),
      timeZone: 'Europe/Berlin',
    });
    writes.calls.reset();
    const component = await editor();
    expect(component.title).toBe('Existing override');
    expect(component.date).toBe('2028-04-20');
    expect(component.startTime).toBe('14:30');
    expect(component.endDate).toBe('2028-04-21');
    expect(component.timeZone).toBe('Europe/Berlin');
    component.title = 'Second edit';
    component.save();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(store.selectSignal(selectAllOccurrenceException)().length).toBe(1);
    expect(exceptions.entities()[occurrenceExceptionId(key)]!.value).toEqual(
      jasmine.objectContaining({
        kind: 'override',
        event: jasmine.objectContaining({
          title: 'Second edit',
          start: Date.parse('2028-04-20T12:30:00Z'),
        }),
      }),
    );
  });

  it('edits floating all-day dates and switches timed/all-day shapes without changing identity', async () => {
    data.occurrence = { seriesId: floating.id, slot: 0 };
    let component = await editor();
    expect(component.isAllDay).toBeTrue();
    component.title = 'Floating edit';
    component.date = '2028-02-29';
    component.save();
    expect(exceptions.entities()[occurrenceExceptionId(data.occurrence)]!.value).toEqual({
      kind: 'override',
      event: { title: 'Floating edit', isAllDay: true, date: '2028-02-29' },
    });
    data.occurrence = key;
    component = await editor();
    component.isAllDay = true;
    component.date = '2026-02-10';
    component.save();
    component = await editor();
    expect(component.isAllDay).toBeTrue();
    expect(component.date).toBe('2026-02-10');
    expect(component.timeZone).toBe('Asia/Tokyo');
    component.isAllDay = false;
    component.startTime = '09:00';
    component.endTime = '10:00';
    component.endDate = component.date;
    component.save();
    expect(exceptions.entities()[occurrenceExceptionId(key)]!.value).toEqual({
      kind: 'override',
      event: {
        title: series.title,
        isAllDay: false,
        start: Date.parse('2026-02-10T00:00:00Z'),
        end: Date.parse('2026-02-10T01:00:00Z'),
        timeZone: 'Asia/Tokyo',
      },
    });
    expect(store.selectSignal(selectAllOccurrenceException)().length).toBe(2);
  });

  const invalidInputs: Partial<DialogEventComponent>[] = [
    { title: '   ' },
    { date: '2026-02-30' },
    { endDate: '2026-02-30' },
    { startTime: '24:00' },
    { endTime: 'bad' },
    { endTime: '09:00' },
    { endTime: '08:00' },
    { timeZone: 'Missing/Zone' },
    { timeZone: '+09:00' },
    {
      date: '2026-03-08',
      endDate: '2026-03-08',
      timeZone: 'America/New_York',
      startTime: '02:30',
      endTime: '03:30',
    },
    { isAllDay: true, date: '2026-02-30' },
  ];
  invalidInputs.forEach((fields, index) => {
    it(`rejects invalid form input ${index} without a persistent action`, async () => {
      const component = await editor();
      Object.assign(component, fields);
      component.save();
      fixture!.detectChanges();
      expect(component.invalid).toBeTrue();
      expect(fixture!.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
      expect(writes).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    });
  });

  it('preserves an existing later DST-fold instant and sub-minute precision on a title edit', async () => {
    const event = {
      title: 'Fold',
      isAllDay: false as const,
      start: Date.parse('2026-11-01T06:30:45.123Z'),
      end: Date.parse('2026-11-01T07:30:45.456Z'),
      timeZone: 'America/New_York',
    };
    exceptions.edit(key, event);
    const component = await editor();
    expect(component.startTime).toBe('01:30');
    component.title = 'Renamed fold';
    component.save();
    expect(exceptions.entities()[occurrenceExceptionId(key)]!.value).toEqual({
      kind: 'override',
      event: { ...event, title: 'Renamed fold' },
    });
  });

  it('uses an explicitly selected scheduling timezone rather than the Calendar display timezone', async () => {
    const component = await editor();
    component.timeZone = 'Europe/Berlin';
    component.save();
    expect(exceptions.entities()[occurrenceExceptionId(key)]!.value).toEqual({
      kind: 'override',
      event: {
        title: series.title,
        isAllDay: false,
        start: Date.parse('2026-01-05T08:00:00Z'),
        end: Date.parse('2026-01-05T09:00:00Z'),
        timeZone: 'Europe/Berlin',
      },
    });
  });

  it('cancels only after confirmation and restores through the independent cancelled-occurrence dialog', async () => {
    const calendar = TestBed.inject(CalendarDisplayService);
    const day = calendar.createItemsForDaysComputed(signal(['2026-01-05']));
    const originalId = day().find((item) => item.sourceId === series.id)!.id;
    const component = await editor();
    dialog.and.returnValue({ afterClosed: () => of(false) });
    await component.cancelOccurrence();
    expect(writes).not.toHaveBeenCalled();
    dialog.and.returnValue({ afterClosed: () => of(true) });
    await component.cancelOccurrence();
    expect(exceptions.entities()[occurrenceExceptionId(key)]!.value).toEqual({
      kind: 'cancelled',
    });
    expect(day().some((item) => item.id === originalId)).toBeFalse();
    const manager = TestBed.createComponent(DialogCancelledOccurrencesComponent);
    manager.detectChanges();
    expect(manager.componentInstance.entries().length).toBe(1);
    expect(manager.nativeElement.textContent).toContain(series.title);
    expect(manager.nativeElement.textContent).toContain('2026-01-05');
    expect(manager.nativeElement.textContent).toContain('Asia/Tokyo');
    manager.componentInstance.search.set('not found');
    expect(manager.componentInstance.entries()).toEqual([]);
    manager.componentInstance.search.set('2026-01-05');
    manager.detectChanges();
    const restore = manager.nativeElement.querySelector('li button') as HTMLButtonElement;
    expect(restore.getAttribute('aria-label')).toContain(series.title);
    restore.click();
    expect(exceptions.entities()[occurrenceExceptionId(key)]!.value).toEqual({
      kind: 'inherit',
    });
    expect(day().filter((item) => item.id === originalId).length).toBe(1);
    expect(manager.componentInstance.entries()).toEqual([]);
    expect(close).toHaveBeenCalledWith(true);
    expect(writes).toHaveBeenCalledTimes(2);
    manager.destroy();
  });

  it('restores an override via its editor and blocks saves after a cancellation arrives', async () => {
    exceptions.edit(key, { title: 'Moved', isAllDay: true, date: '2028-01-01' });
    let component = await editor();
    expect(fixture!.nativeElement.textContent).toContain('F.EVENT.RESTORE_OCCURRENCE');
    component.restoreOccurrence();
    expect(exceptions.entities()[occurrenceExceptionId(key)]!.value).toEqual({
      kind: 'inherit',
    });
    component = await editor();
    exceptions.cancel(key);
    writes.calls.reset();
    component.save();
    fixture!.detectChanges();
    expect(writes).not.toHaveBeenCalled();
    expect(
      fixture!.nativeElement.querySelector('button[type="submit"]').disabled,
    ).toBeTrue();
    component.restoreOccurrence();
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('does not offer unavailable slots, orphans or inherited entries as cancellations to restore', async () => {
    exceptions.cancel({ seriesId: 'missing', slot: 0 });
    exceptions.cancel({ seriesId: series.id, slot: 999 });
    exceptions.restore(key);
    writes.calls.reset();
    const manager = TestBed.createComponent(DialogCancelledOccurrencesComponent);
    expect(manager.componentInstance.entries()).toEqual([]);
    manager.destroy();
    data.occurrence = { seriesId: 'missing', slot: 0 };
    data.id = 'must-not-be-used';
    const component = await editor();
    component.save();
    component.restoreOccurrence();
    await component.cancelOccurrence();
    await component.remove();
    expect(writes).not.toHaveBeenCalled();
    expect(fixture!.nativeElement.textContent).toContain(
      'F.EVENT.OCCURRENCE_UNAVAILABLE',
    );
  });
});
