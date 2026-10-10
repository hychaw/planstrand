import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideStore, Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import EN_TRANSLATIONS from '../../../assets/i18n/en.json';
import { DateService } from '../../core/date/date.service';
import { GlobalConfigService } from '../config/global-config.service';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import { selectLocalizationConfig } from '../config/store/global-config.reducer';
import { selectLocalCalendarDisplayItems } from '../schedule/calendar-display-item.selectors';
import { CalendarDisplayService } from '../schedule/calendar-display.service';
import {
  DialogEventComponent,
  EventDialogData,
} from '../event/dialog-event/dialog-event.component';
import { EventService } from '../event/event.service';
import { eventReducer } from '../event/store/event.reducer';
import { DialogWeeklyTemplatesComponent } from './dialog-weekly-templates/dialog-weekly-templates.component';
import { WeeklyTemplateService } from './weekly-template.service';
import { EventSeriesService } from './event-series.service';
import { OccurrenceExceptionService } from './occurrence-exception.service';
import { weeklyTemplateReducer } from './store/weekly-template.reducer';
import { eventSeriesReducer } from './store/event-series.reducer';
import { occurrenceExceptionReducer } from './store/occurrence-exception.reducer';
import { selectWeeklyTemplateFeatureState } from './store/weekly-template.selectors';
import { selectEventSeriesFeatureState } from './store/event-series.selectors';
import { getFullStateRequiredCapabilities } from '@sp/shared-schema';

describe('Weekly Templates management UI with real commands and Calendar', () => {
  let fixture: ComponentFixture<DialogWeeklyTemplatesComponent>;
  let ui: DialogWeeklyTemplatesComponent;
  let data: EventDialogData;
  let writes: jasmine.Spy;
  let dialog: jasmine.SpyObj<MatDialog>;
  let close: jasmine.Spy;
  let templates: WeeklyTemplateService;
  let series: EventSeriesService;
  beforeEach(async () => {
    data = {};
    close = jasmine.createSpy('close');
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
    selectLocalizationConfig.setResult({ timeZone: 'UTC' });
    selectLocalCalendarDisplayItems.setResult([]);
    await TestBed.configureTestingModule({
      imports: [
        DialogWeeklyTemplatesComponent,
        DialogEventComponent,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideStore({
          weeklyTemplate: weeklyTemplateReducer,
          eventSeries: eventSeriesReducer,
          occurrenceException: occurrenceExceptionReducer,
          event: eventReducer,
        }),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MatDialog, useValue: dialog },
        { provide: DateService, useValue: { todayStr: () => '2026-01-05' } },
        {
          provide: GlobalConfigService,
          useValue: { localization: () => ({ timeZone: 'UTC' }) },
        },
        { provide: CalendarIntegrationService, useValue: { calendarEvents$: of([]) } },
        {
          provide: HiddenCalendarProvidersService,
          useValue: { hiddenProviderIds: signal([]) },
        },
      ],
    })
      .overrideProvider(MatDialog, { useValue: dialog })
      .compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', EN_TRANSLATIONS);
    translate.use('en');
    writes = spyOn(TestBed.inject(Store), 'dispatch').and.callThrough();
    templates = TestBed.inject(WeeklyTemplateService);
    series = TestBed.inject(EventSeriesService);
    fixture = TestBed.createComponent(DialogWeeklyTemplatesComponent);
    ui = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    for (const [action] of writes.calls.allArgs())
      expect(['WEEKLY_TEMPLATE', 'EVENT_SERIES', 'OCCURRENCE_EXCEPTION']).toContain(
        action.meta.entityType,
      );
    expect(Object.keys(TestBed.inject(EventService).entities()).length).toBe(0);
    selectLocalizationConfig.release();
    selectLocalizationConfig.clearResult();
    selectLocalCalendarDisplayItems.release();
    selectLocalCalendarDisplayItems.clearResult();
  });
  const create = (title = 'Week'): string => {
    ui.edit();
    ui.title = title;
    ui.endDate = '2026-02-01';
    ui.save();
    return ui.selectedId()!;
  };
  const entry = (
    id: string,
    title = 'Class',
  ): {
    editor: ComponentFixture<DialogEventComponent>;
    component: DialogEventComponent;
  } => {
    Object.assign(data, { templateId: id, seriesId: undefined });
    const editor = TestBed.createComponent(DialogEventComponent);
    editor.detectChanges();
    const component = editor.componentInstance;
    component.title = title;
    component.isAllDay = true;
    component.weekdays = [1, 3];
    return { editor, component };
  };
  const calendar = (): ReturnType<CalendarDisplayService['itemsForDays']> =>
    TestBed.inject(CalendarDisplayService).createItemsForRangeComputed(
      signal({ fromDate: '2026-01-01', toDateExclusive: '2026-02-01' }),
    )();

  it('does not write or require ROUTINES_V1 when opening and browsing', () => {
    ui.select('absent');
    fixture.detectChanges();
    expect(writes).not.toHaveBeenCalled();
    const store = TestBed.inject(Store);
    expect(
      getFullStateRequiredCapabilities({
        weeklyTemplate: store.selectSignal(selectWeeklyTemplateFeatureState)(),
        eventSeries: store.selectSignal(selectEventSeriesFeatureState)(),
      }),
    ).toEqual([]);
  });
  it('creates inactive templates, renames them, validates dates and preserves invalid drafts', () => {
    ui.edit();
    ui.title = 'Draft';
    ui.endDate = '2025-01-01';
    ui.save();
    fixture.detectChanges();
    expect(ui.invalid()).toBeTrue();
    expect(ui.title).toBe('Draft');
    expect(writes).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    ui.endDate = '2026-02-01';
    ui.save();
    const current = ui.selected()!;
    expect(current.isActive).toBeFalse();
    ui.edit(current);
    ui.title = 'Renamed';
    ui.save();
    expect(ui.selected()?.title).toBe('Renamed');
    expect(ui.templates().length).toBe(1);
  });
  it('creates multiple weekly entries directly with immutable ownership, even while inactive', () => {
    const id = create();
    for (const title of ['A', 'B']) {
      const { editor, component } = entry(id, title);
      component.save();
      component.save();
      editor.destroy();
    }
    expect(ui.entries().map((e) => e.title)).toEqual(['A', 'B']);
    expect(ui.entries().every((e) => e.templateId === id)).toBeTrue();
    expect(calendar()).toEqual([]);
    const adds = writes.calls.allArgs().filter(([a]) => !!a.eventSeries);
    expect(adds.length).toBe(2);
    for (const [action] of adds) expect(action.eventSeries.templateId).toBe(id);
  });
  it('keeps invalid entry drafts for weekdays, interval, zone and template window', () => {
    const id = create();
    const { editor, component } = entry(id);
    for (const changes of [
      { weekdays: [] },
      { weekdays: [1], interval: 0 },
      { interval: 1, date: '2025-01-01' },
      { date: '2026-01-05', isAllDay: false, timeZone: 'invalid' },
    ]) {
      Object.assign(component, changes);
      component.save();
      expect(component.seriesError()).not.toBeNull();
      expect(ui.entries().length).toBe(0);
    }
    component.timeZone = 'Europe/Berlin';
    component.durationMinutes = 90;
    component.save();
    expect(ui.entries().length).toBe(1);
    editor.destroy();
  });
  it('opens entry creation and definition editing from the management interface', () => {
    const id = create();
    ui.openEntry();
    expect(dialog.open).toHaveBeenCalledWith(
      DialogEventComponent,
      jasmine.objectContaining({ data: { templateId: id, date: '2026-01-05' } }),
    );
    const { editor, component } = entry(id);
    component.save();
    editor.destroy();
    ui.openEntry(ui.entries()[0].id);
    expect(dialog.open).toHaveBeenCalledWith(
      DialogEventComponent,
      jasmine.objectContaining({ data: { seriesId: ui.entries()[0].id } }),
    );
  });
  it('edits an inactive entry through the same editor and retains ownership and exception consent', async () => {
    const id = create();
    const created = entry(id);
    created.component.save();
    created.editor.destroy();
    const owned = ui.entries()[0];
    TestBed.inject(OccurrenceExceptionService).cancel({ seriesId: owned.id, slot: 0 });
    Object.assign(data, { templateId: undefined, seriesId: owned.id });
    const editor = TestBed.createComponent(DialogEventComponent);
    editor.detectChanges();
    const c = editor.componentInstance;
    expect(c.scope).toBe('series');
    expect(c.template()?.id).toBe(id);
    c.title = 'Edited';
    c.weekdays = [2];
    dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
    c.save();
    await editor.whenStable();
    expect(series.entities()[owned.id]?.title).toBe('Class');
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    c.save();
    await editor.whenStable();
    expect(series.entities()[owned.id]?.title).toBe('Edited');
    expect(series.entities()[owned.id]?.templateId).toBe(id);
    expect(
      Object.values(TestBed.inject(OccurrenceExceptionService).entities()).length,
    ).toBe(1);
    editor.destroy();
  });
  it('updates Calendar for activation, deactivation, reactivation and date changes; overlapping templates remain independent', () => {
    const id = create();
    const a = entry(id);
    a.component.save();
    a.editor.destroy();
    ui.toggle(ui.selected()!);
    const original = calendar();
    expect(original.length).toBeGreaterThan(0);
    ui.toggle(ui.selected()!);
    expect(calendar()).toEqual([]);
    expect(ui.entries().length).toBe(1);
    ui.toggle(ui.selected()!);
    expect(calendar()).toEqual(original);
    ui.edit(ui.selected());
    ui.startDate = '2026-01-19';
    ui.save();
    expect(calendar().length).toBeLessThan(original.length);
    const other = create('Other');
    const b = entry(other);
    b.component.save();
    b.editor.destroy();
    ui.toggle(ui.selected()!);
    expect(
      calendar().some(
        (item) =>
          item.sourceType === 'eventOccurrence' && item.sourceId === ui.entries()[0].id,
      ),
    ).toBeTrue();
    expect(templates.entities()[id]?.isActive).toBeTrue();
  });
  it('requires confirmation for permanent template deletion and guards duplicate requests', async () => {
    const id = create();
    const a = entry(id);
    a.component.save();
    a.editor.destroy();
    ui.toggle(ui.selected()!);
    await ui.remove();
    expect(templates.entities()[id]?.deletedAt).toBeUndefined();
    const result = new Subject<boolean>();
    dialog.open.and.returnValue({ afterClosed: () => result } as never);
    const first = ui.remove();
    const calls = dialog.open.calls.count();
    await ui.remove();
    expect(dialog.open.calls.count()).toBe(calls);
    result.next(true);
    result.complete();
    await first;
    expect(templates.entities()[id]?.deletedAt).toBeDefined();
    expect(calendar()).toEqual([]);
    expect(Object.values(series.entities()).length).toBe(1);
  });
  it('removes entries with the existing terminal deletion confirmation', async () => {
    const id = create();
    const a = entry(id);
    a.component.save();
    a.editor.destroy();
    const owned = ui.entries()[0];
    Object.assign(data, { templateId: undefined, seriesId: owned.id });
    const editor = TestBed.createComponent(DialogEventComponent);
    editor.detectChanges();
    await editor.componentInstance.deleteEntireSeries();
    expect(ui.entries().length).toBe(1);
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    await editor.componentInstance.deleteEntireSeries();
    expect(ui.entries().length).toBe(0);
    expect(series.entities()[owned.id]?.deletedAt).toBeDefined();
    editor.destroy();
  });
  it('keeps standalone recurring Events independent and browsing populated templates read-only', () => {
    const id = create();
    const a = entry(id);
    a.component.save();
    a.editor.destroy();
    const standalone = series.create({
      title: 'Independent',
      recurrence: {
        frequency: 'weekly',
        interval: 1,
        weekdays: [1],
        startDate: '2026-01-05',
      },
      timing: { kind: 'allDay' },
    })!;
    writes.calls.reset();
    ui.select(id);
    fixture.detectChanges();
    expect(writes).not.toHaveBeenCalled();
    const independentItems = calendar().filter((item) => item.sourceId === standalone);
    ui.toggle(ui.selected()!);
    ui.toggle(ui.selected()!);
    expect(calendar()).toEqual(independentItems);
    expect(series.entities()[standalone]?.templateId).toBeUndefined();
  });

  it('provides native labelled controls and focuses the name when creating', async () => {
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input[name="title"]');
    expect(input.closest('label')).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(
      fixture.nativeElement.querySelector('form').hasAttribute('novalidate'),
    ).toBeTrue();
  });
});
