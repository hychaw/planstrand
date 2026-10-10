import { Component, computed, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { CdkDrag } from '@angular/cdk/drag-drop';
import { By } from '@angular/platform-browser';
import { Store, provideStore } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import EN_TRANSLATIONS from '../../../assets/i18n/en.json';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { selectLocalizationConfig } from '../config/store/global-config.reducer';
import { TaskService } from '../tasks/task.service';
import { CalendarEventActionsService } from '../calendar-integration/calendar-event-actions.service';
import { WorkSessionService } from '../work-session/work-session.service';
import { eventReducer } from '../event/store/event.reducer';
import { ScheduleWeekComponent } from '../schedule/schedule-week/schedule-week.component';
import { ScheduleEventComponent } from '../schedule/schedule-event/schedule-event.component';
import { ScheduleEvent } from '../schedule/schedule.model';
import { SVEType } from '../schedule/schedule.const';
import { projectEventOccurrences } from '../schedule/project-event-occurrences';
import { eventSeriesReducer } from './store/event-series.reducer';
import { addEventSeries } from './store/event-series.actions';
import { selectAllEventSeries } from './store/event-series.selectors';
import { occurrenceExceptionReducer } from './store/occurrence-exception.reducer';
import { selectAllOccurrenceException } from './store/occurrence-exception.selectors';
import { DialogCancelledOccurrencesComponent } from './dialog-cancelled-occurrences/dialog-cancelled-occurrences.component';
import { OccurrenceExceptionService } from './occurrence-exception.service';
import { CreateTaskPlaceholderComponent } from '../schedule/create-task-placeholder/create-task-placeholder.component';
import { SnackService } from '../../core/snack/snack.service';
import { ShortTimePipe } from '../../ui/pipes/short-time.pipe';

@Component({
  imports: [ScheduleWeekComponent],
  template: `<schedule-week
      [events]="events()"
      [daysToShow]="['2026-01-05']"
    />
    <button
      class="manage-cancelled"
      (click)="manage()"
    >
      Cancelled occurrences
    </button>`,
})
class OccurrenceKeyboardHost {
  private readonly _store = inject(Store);
  private readonly _series = this._store.selectSignal(selectAllEventSeries);
  private readonly _exceptions = this._store.selectSignal(selectAllOccurrenceException);
  private readonly _dialog = inject(MatDialog);
  readonly events = computed<ScheduleEvent[]>(() =>
    projectEventOccurrences(
      this._series(),
      { fromDate: '2026-01-05', toDateExclusive: '2026-01-06' },
      'UTC',
      this._exceptions(),
    ).map((item) => ({
      id: item.id,
      type: SVEType.EventOccurrence,
      style: '',
      startHours: 0,
      timeLeftInHours: 0,
      plannedForDay: '2026-01-05',
      data: item,
    })),
  );
  manage(): void {
    this._dialog.open(DialogCancelledOccurrencesComponent);
  }
}

describe('occurrence keyboard actions and real dialog focus', () => {
  let fixture: ComponentFixture<OccurrenceKeyboardHost>;
  let dialogs: MatDialog;
  beforeEach(async () => {
    selectLocalizationConfig.setResult({ timeZone: 'UTC' });
    await TestBed.configureTestingModule({
      imports: [
        OccurrenceKeyboardHost,
        CreateTaskPlaceholderComponent,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideNoopAnimations(),
        ShortTimePipe,
        { provide: SnackService, useValue: jasmine.createSpyObj('snack', ['open']) },
        provideStore({
          eventSeries: eventSeriesReducer,
          occurrenceException: occurrenceExceptionReducer,
          event: eventReducer,
        }),
        { provide: DateService, useValue: { todayStr: () => '2026-01-05' } },
        {
          provide: DateTimeFormatService,
          useValue: {
            currentLocale: () => 'en-US',
            textLocale: () => 'en-US',
            isoTextLocale: () => 'en-US',
            is24HourFormat: () => true,
            formatTime: () => '10:00',
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            localization: () => ({ timeZone: 'UTC' }),
            cfg: signal(DEFAULT_GLOBAL_CONFIG),
          },
        },
        {
          provide: TaskService,
          useValue: {
            currentTaskId: signal(null),
            setSelectedId: jasmine.createSpy('setSelectedId'),
          },
        },
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
    }).compileComponents();
    const translations = TestBed.inject(TranslateService);
    translations.setTranslation('en', EN_TRANSLATIONS);
    translations.use('en');
    TestBed.inject(Store).dispatch(
      addEventSeries({
        eventSeries: {
          id: 'focus-series',
          title: 'Keyboard routine',
          created: 1,
          modified: 1,
          segments: [
            {
              id: 'segment',
              timing: { kind: 'allDay' },
              recurrence: {
                frequency: 'daily',
                startDate: '2026-01-05',
                endDate: '2026-01-05',
                interval: 1,
              },
            },
          ],
        },
      }),
    );
    dialogs = TestBed.inject(MatDialog);
    fixture = TestBed.createComponent(OccurrenceKeyboardHost);
    fixture.detectChanges();
    await fixture.whenStable();
  });
  afterEach(() => {
    dialogs.closeAll();
    fixture.destroy();
    selectLocalizationConfig.release();
    selectLocalizationConfig.clearResult();
  });
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const buttonWith = (text: string): HTMLButtonElement =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>('.cdk-overlay-container button'),
    ).find((button) => button.textContent?.trim() === text)!;

  it('opens with Enter and Space, focuses the title, and restores focus on Close or Escape', async () => {
    const origin = fixture.nativeElement.querySelector('schedule-event') as HTMLElement;
    expect(origin.getAttribute('role')).toBe('button');
    expect(origin.tabIndex).toBe(0);
    const entry = fixture.debugElement.query(By.directive(ScheduleEventComponent));
    expect(entry.injector.get(CdkDrag).disabled).toBeTrue();
    for (const key of ['Enter', ' ']) {
      origin.focus();
      origin.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
      await settle();
      expect(dialogs.openDialogs.length).toBe(1);
      expect((document.activeElement as HTMLInputElement).name).toBe('title');
      const content = document.querySelector('.cdk-overlay-container')!;
      expect(content.textContent).toContain('This occurrence');
      expect(content.textContent).toContain('This and future');
      expect(content.textContent).toContain('Entire series');
      expect(content.querySelector('.resize-handle')).toBeNull();
      if (key === 'Enter') buttonWith('Close').click();
      else
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
        );
      await settle();
      expect(dialogs.openDialogs.length).toBe(0);
      expect(document.activeElement).toBe(origin);
    }
  });

  it('keeps drag previews non-interactive', async () => {
    const preview = TestBed.createComponent(ScheduleEventComponent);
    preview.componentRef.setInput('event', fixture.componentInstance.events()[0]);
    preview.componentRef.setInput('isDragPreview', true);
    preview.detectChanges();
    preview.nativeElement.click();
    preview.nativeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(preview.nativeElement.hasAttribute('tabindex')).toBeFalse();
    expect(dialogs.openDialogs).toEqual([]);
    preview.destroy();
  });

  it('creates a recurring Event through the real Calendar placeholder, renders it, and restores focus', async () => {
    const placeholder = TestBed.createComponent(CreateTaskPlaceholderComponent);
    placeholder.componentRef.setInput('isEditMode', false);
    placeholder.componentRef.setInput('date', '2026-01-05');
    placeholder.componentRef.setInput('time', '10:00');
    // Angular's test renderer replaces the preceding fixture root; reconnect the Calendar.
    document.body.appendChild(fixture.nativeElement);
    const calendar = fixture.nativeElement.querySelector('schedule-week') as HTMLElement;
    calendar.appendChild(placeholder.nativeElement);
    // Match ScheduleWeek's editEnd behavior: the transient launcher disappears on open.
    const removal = placeholder.componentInstance.editEnd.subscribe(() =>
      placeholder.nativeElement.remove(),
    );
    placeholder.detectChanges();
    const launcher = placeholder.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    launcher.focus();
    launcher.click();
    await settle();
    expect(dialogs.openDialogs.length).toBe(1);
    expect((document.activeElement as HTMLInputElement).name).toBe('title');
    const title = document.querySelector<HTMLInputElement>('input[name="title"]')!;
    title.value = 'Created from Calendar';
    title.dispatchEvent(new Event('input'));
    const repeat = document.querySelector<HTMLSelectElement>(
      'select[name="creationRepeat"]',
    )!;
    repeat.focus();
    repeat.value = 'weekly';
    repeat.dispatchEvent(new Event('change'));
    await settle();
    expect(document.activeElement).toBe(repeat);
    const allDay = document.querySelector<HTMLInputElement>('input[name="allDay"]')!;
    allDay.click();
    await settle();
    const weekdays = document.querySelectorAll<HTMLInputElement>('.weekdays input');
    expect(weekdays.length).toBe(7);
    expect(weekdays[0].checked).toBeTrue();
    expect(weekdays[4].closest('label')!.textContent).toContain('Friday');
    weekdays[4].focus();
    weekdays[4].click();
    await settle();
    expect(document.querySelector('.cdk-overlay-container')!.textContent).not.toContain(
      'F.EVENT.',
    );
    buttonWith('Save').focus();
    buttonWith('Save').click();
    await settle();
    expect(dialogs.openDialogs.length).toBe(0);
    expect(document.activeElement).toBe(calendar);
    expect(fixture.nativeElement.textContent).toContain('Created from Calendar');
    const created = TestBed.inject(Store)
      .selectSignal(selectAllEventSeries)()
      .find((series) => series.title === 'Created from Calendar')!;
    expect(created.segments.length).toBe(1);
    expect(created.segments[0].recurrence).toEqual(
      jasmine.objectContaining({
        frequency: 'weekly',
        weekdays: [1, 5],
        startDate: '2026-01-05',
      }),
    );
    expect(fixture.nativeElement.querySelectorAll('schedule-event').length).toBe(2);
    expect(TestBed.inject(TaskService).setSelectedId).not.toHaveBeenCalled();
    expect(TestBed.inject(WorkSessionService).update).not.toHaveBeenCalled();
    removal.unsubscribe();
    placeholder.destroy();
  });

  it('keeps keyboard focus on scope changes and saves a series edit with translated controls', async () => {
    const origin = fixture.nativeElement.querySelector('schedule-event') as HTMLElement;
    origin.focus();
    origin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    const scope = document.querySelector<HTMLSelectElement>('select[name="scope"]')!;
    scope.focus();
    scope.value = 'future';
    scope.dispatchEvent(new Event('change'));
    await settle();
    expect(document.activeElement).toBe(scope);
    const content = document.querySelector('.cdk-overlay-container')!;
    expect(content.textContent).toContain('Recurrence');
    expect(content.textContent).not.toContain('F.EVENT.');
    const title = content.querySelector<HTMLInputElement>('input[name="title"]')!;
    title.value = 'Edited from keyboard';
    title.dispatchEvent(new Event('input'));
    await settle();
    buttonWith('Save').focus();
    buttonWith('Save').click();
    await settle();
    expect(dialogs.openDialogs.length).toBe(0);
    expect(origin.textContent).toContain('Edited from keyboard');
    expect(document.activeElement).toBe(origin);
  });

  it('restores focus and the unsaved draft after declining retain, then saves only with explicit consent', async () => {
    TestBed.inject(OccurrenceExceptionService).edit(
      { seriesId: 'focus-series', slot: 0 },
      { title: 'Modified occurrence', isAllDay: true, date: '2026-01-05' },
    );
    await settle();
    const origin = fixture.nativeElement.querySelector('schedule-event') as HTMLElement;
    origin.focus();
    origin.click();
    await settle();
    const scope = document.querySelector<HTMLSelectElement>('select[name="scope"]')!;
    scope.value = 'series';
    scope.dispatchEvent(new Event('change'));
    await settle();
    const date = document.querySelector<HTMLInputElement>('input[name="date"]')!;
    date.value = '2026-01-04';
    date.dispatchEvent(new Event('input'));
    await settle();
    const save = buttonWith('Save');
    save.focus();
    save.click();
    await settle();
    expect(dialogs.openDialogs.length).toBe(2);
    expect(document.querySelector('.cdk-overlay-container')!.textContent).toContain(
      'logical occurrence slots',
    );
    buttonWith('Cancel').click();
    await settle();
    await settle();
    expect(dialogs.openDialogs.length).toBe(1);
    expect(document.activeElement).toBe(save);
    expect(date.value).toBe('2026-01-04');
    save.click();
    await settle();
    document.querySelector<HTMLButtonElement>('[e2e="confirmBtn"]')!.click();
    await settle();
    await settle();
    expect(dialogs.openDialogs.length).toBe(0);
    expect(document.activeElement).toBe(origin);
    expect(fixture.nativeElement.textContent).toContain('Modified occurrence');
  });

  it('confirms entire-series deletion separately and focuses the Calendar after the series disappears', async () => {
    const origin = fixture.nativeElement.querySelector('schedule-event') as HTMLElement;
    origin.focus();
    origin.click();
    await settle();
    const remove = buttonWith('Delete entire series');
    remove.focus();
    remove.click();
    await settle();
    expect(document.querySelector('.cdk-overlay-container')!.textContent).toContain(
      'All its occurrences',
    );
    buttonWith('Cancel').click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(remove);
    expect(fixture.nativeElement.querySelector('schedule-event')).not.toBeNull();
    remove.click();
    await settle();
    document.querySelector<HTMLButtonElement>('[e2e="confirmBtn"]')!.click();
    await settle();
    await settle();
    expect(dialogs.openDialogs.length).toBe(0);
    expect(fixture.nativeElement.querySelector('schedule-event')).toBeNull();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('schedule-week'),
    );
    expect(TestBed.inject(TaskService).setSelectedId).not.toHaveBeenCalled();
  });

  it('restores focus to the Calendar when cancellation removes the block, and to the manager button after restoration', async () => {
    const origin = fixture.nativeElement.querySelector('schedule-event') as HTMLElement;
    origin.focus();
    origin.click();
    await settle();
    buttonWith('Cancel this occurrence').click();
    await settle();
    const confirm = document.querySelector<HTMLButtonElement>('[e2e="confirmBtn"]')!;
    confirm.click();
    // Confirmation closes first; its async continuation then closes the editor.
    await settle();
    await settle();
    expect(fixture.nativeElement.querySelector('schedule-event')).toBeNull();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('schedule-week'),
    );
    const managerButton = fixture.nativeElement.querySelector(
      '.manage-cancelled',
    ) as HTMLButtonElement;
    managerButton.focus();
    managerButton.click();
    await settle();
    expect((document.activeElement as HTMLInputElement).type).toBe('search');
    expect(document.querySelector('.cdk-overlay-container')!.textContent).toContain(
      'Keyboard routine',
    );
    buttonWith('Restore original schedule').click();
    await settle();
    expect(fixture.nativeElement.querySelector('schedule-event')).not.toBeNull();
    expect(document.activeElement).toBe(managerButton);
    expect(TestBed.inject(TaskService).setSelectedId).not.toHaveBeenCalled();
  });

  it('restores focus to the Calendar after saving a move outside the visible date', async () => {
    const origin = fixture.nativeElement.querySelector('schedule-event') as HTMLElement;
    origin.focus();
    origin.click();
    await settle();
    const date = document.querySelector<HTMLInputElement>(
      '.cdk-overlay-container input[name="date"]',
    )!;
    date.value = '2026-02-10';
    date.dispatchEvent(new Event('input'));
    await settle();
    buttonWith('Save').click();
    await settle();
    expect(dialogs.openDialogs.length).toBe(0);
    expect(fixture.nativeElement.querySelector('schedule-event')).toBeNull();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('schedule-week'),
    );
  });
});
