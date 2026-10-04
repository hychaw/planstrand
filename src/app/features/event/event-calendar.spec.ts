import { signal } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { CdkDragRelease, CdkDragStart, DragDropModule } from '@angular/cdk/drag-drop';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideStore, Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { EventService } from './event.service';
import { eventReducer } from './store/event.reducer';
import { LocalEvent } from './event.model';
import { addEvent } from './store/event.actions';
import { DialogEventComponent } from './dialog-event/dialog-event.component';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { TaskService } from '../tasks/task.service';
import { CalendarEventActionsService } from '../calendar-integration/calendar-event-actions.service';
import { ScheduleEventComponent } from '../schedule/schedule-event/schedule-event.component';
import { ScheduleWeekDragService } from '../schedule/schedule-week/schedule-week-drag.service';
import {
  projectEvent,
  projectWorkSession,
  projectCalendarIntegrationEvent,
} from '../schedule/calendar-display-item';
import { mapToScheduleDays } from '../schedule/map-schedule-data/map-to-schedule-days';
import { mapScheduleDaysToScheduleEvents } from '../schedule/map-schedule-data/map-schedule-days-to-schedule-events';
import { FH, SVEType } from '../schedule/schedule.const';
import { ScheduleEvent } from '../schedule/schedule.model';
import { workSessionReducer } from '../work-session/store/work-session.reducer';
const hour = 3600000;
const twoHours = 2 * hour;
const threeHours = 3 * hour;
const start = new Date(2026, 9, 4, 10).getTime();
const timed: LocalEvent = {
  id: 'local',
  title: 'Local meeting',
  isAllDay: false,
  start,
  end: start + hour,
  timeZone: 'UTC',
  created: start,
  modified: start,
};
const allDay: LocalEvent = {
  id: 'all-day',
  title: 'Day off',
  isAllDay: true,
  date: '2026-10-04',
  created: start,
  modified: start,
};
const eventFor = (): ScheduleEvent => ({
  id: 'event:local',
  type: SVEType.LocalEvent,
  style: '',
  startHours: 10,
  timeLeftInHours: 1,
  data: projectEvent(timed),
  plannedForDay: '2026-10-04',
});

describe('Event calendar projection', () => {
  [1, 7, 35].forEach((length) => {
    it(`places the same timed and all-day Event in a ${length}-day window`, () => {
      const dates = Array.from({ length }, (_, i) => {
        const d = new Date(2026, 9, 4 + i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      const session = projectWorkSession({
        id: 'session',
        taskId: 'task',
        start: start + hour,
        end: start + twoHours,
        timeZone: 'UTC',
        created: start,
        modified: start,
      });
      const external = {
        id: 'provider-event',
        calProviderId: 'ical',
        issueProviderKey: 'ICAL',
        title: 'External',
        start: start + twoHours,
        duration: hour,
      };
      const items = [
        session,
        projectEvent(timed),
        projectEvent(allDay),
        projectCalendarIntegrationEvent(external),
      ];
      const days = mapToScheduleDays(
        new Date(2026, 9, 4).getTime(),
        dates,
        [],
        [],
        [],
        [],
        [{ items: [external] }],
        null,
        {},
        undefined,
        undefined,
        start,
        items,
      );
      const events = mapScheduleDaysToScheduleEvents(days, FH).eventsFlat;
      expect(events.filter((e) => e.id === 'event:local').length).toBe(1);
      expect(events.filter((e) => e.id === 'event:all-day').length).toBe(1);
      expect(events.find((e) => e.id === 'event:all-day')?.plannedForDay).toBe(
        '2026-10-04',
      );
      expect(events.filter((e) => e.type === SVEType.WorkSession).length).toBe(1);
      expect(events.filter((e) => e.type === SVEType.CalendarEvent).length).toBe(1);
    });
  });
});

describe('Event calendar interactions', () => {
  let events: EventService;
  let store: Store;
  let writes: jasmine.Spy;
  let dialog: jasmine.Spy;
  let drag: ScheduleWeekDragService;
  let grid: HTMLElement;
  let fixture: ComponentFixture<ScheduleEventComponent> | undefined;
  beforeEach(async () => {
    dialog = jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(true) });
    TestBed.configureTestingModule({
      imports: [
        ScheduleEventComponent,
        DialogEventComponent,
        DragDropModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideStore({ event: eventReducer, workSession: workSessionReducer }),
        ScheduleWeekDragService,
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal(DEFAULT_GLOBAL_CONFIG),
            localization: () => ({ timeZone: 'UTC' }),
          },
        },
        { provide: DateService, useValue: { todayStr: () => '2026-10-04' } },
        { provide: DateTimeFormatService, useValue: { is24HourFormat: () => true } },
        { provide: MatDialog, useValue: { open: dialog } },
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: MAT_DIALOG_DATA, useValue: { date: '2026-10-04' } },
        {
          provide: TaskService,
          useValue: { setSelectedId: jasmine.createSpy('setSelectedId') },
        },
        {
          provide: CalendarEventActionsService,
          useValue: jasmine.createSpyObj('calendar', [
            'canMoveEvent',
            'moveToStartTime',
            'hasEventUrl',
          ]),
        },
      ],
    });
    TestBed.overrideProvider(MatDialog, { useValue: { open: dialog } });
    await TestBed.compileComponents();
    store = TestBed.inject(Store);
    events = TestBed.inject(EventService);
    store.dispatch(addEvent({ event: timed }));
    writes = spyOn(store, 'dispatch').and.callThrough();
    drag = TestBed.inject(ScheduleWeekDragService);
    grid = document.createElement('div');
    grid.classList.add('grid-container');
    spyOn(grid, 'getBoundingClientRect').and.returnValue({
      top: 0,
      bottom: 24 * FH * 10,
      left: 0,
      right: 500,
      height: 24 * FH * 10,
    } as DOMRect);
    document.body.appendChild(grid);
    drag.setGridContainer(() => grid);
    drag.setDaysToShowAccessor(() => ['2026-10-04']);
  });
  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    drag.destroy();
    grid.remove();
  });
  it('opens the small editor from a local Event without selecting a Task/provider', async () => {
    fixture = TestBed.createComponent(ScheduleEventComponent);
    fixture.componentRef.setInput('event', eventFor());
    fixture.detectChanges();
    await fixture.componentInstance.clickHandler(new MouseEvent('click'));
    expect(dialog).toHaveBeenCalledWith(DialogEventComponent, { data: { id: timed.id } });
    expect(writes).not.toHaveBeenCalled();
  });
  it('uses the existing release geometry for one Event move and retains duration/zone', () => {
    const col = document.createElement('div');
    col.classList.add('col');
    col.setAttribute('data-day', '2026-10-04');
    spyOn(document, 'elementsFromPoint').and.returnValue([col]);
    const source = {
      data: eventFor(),
      element: { nativeElement: document.createElement('schedule-event') },
      reset: jasmine.createSpy('reset'),
    };
    drag.handleDragStarted({ source } as unknown as CdkDragStart<ScheduleEvent>);
    const targetY = 12 * FH * 10;
    const centerOffset = Math.floor(FH / 2) * 10;
    drag.handleDragReleased({
      source,
      event: new MouseEvent('mouseup', {
        clientX: 100,
        clientY: targetY + centerOffset,
      }),
    } as unknown as CdkDragRelease<ScheduleEvent>);
    expect(events.entities()[timed.id]).toEqual(
      jasmine.objectContaining({
        start: start + twoHours,
        end: start + threeHours,
        timeZone: 'UTC',
      }),
    );
    expect(writes).toHaveBeenCalledTimes(1);
    expect(source.reset).toHaveBeenCalled();
  });
  it('uses the existing bottom handle for one Event resize', fakeAsync(() => {
    fixture = TestBed.createComponent(ScheduleEventComponent);
    fixture.componentRef.setInput('event', eventFor());
    fixture.detectChanges();
    grid.appendChild(fixture.nativeElement);
    spyOnProperty(fixture.nativeElement, 'offsetHeight').and.returnValue(120);
    fixture.nativeElement
      .querySelector('.resize-handle')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 220 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(events.entities()[timed.id]).toEqual(
      jasmine.objectContaining({ start, end: start + twoHours }),
    );
    expect(writes).toHaveBeenCalledTimes(1);
    tick(200);
  }));
  it('offers an editable UTC default when the browser has no system zone', () => {
    spyOn(TestBed.inject(GlobalConfigService), 'localization').and.returnValue({});
    spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').and.returnValue({
      ...Intl.DateTimeFormat().resolvedOptions(),
      timeZone: undefined as unknown as string,
    });
    const editor = TestBed.createComponent(DialogEventComponent);
    expect(editor.componentInstance.timeZone).toBe('UTC');
    editor.componentInstance.title = 'Timed Event without a system zone';
    editor.componentInstance.save();
    expect(
      Object.values(events.entities()).some(
        (e) =>
          e?.title === 'Timed Event without a system zone' &&
          !e.isAllDay &&
          e.timeZone === 'UTC',
      ),
    ).toBeTrue();
    editor.destroy();
  });
  it('creates through the editor, then confirms permanent deletion', async () => {
    const editor = TestBed.createComponent(DialogEventComponent);
    editor.detectChanges();
    await editor.whenStable();
    editor.detectChanges();
    const input = editor.nativeElement.querySelector(
      'input[name=title]',
    ) as HTMLInputElement;
    input.value = 'New all-day Event';
    input.dispatchEvent(new Event('input'));
    await editor.whenStable();
    editor.componentInstance.isAllDay = true;
    editor.componentInstance.save();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(
      Object.values(events.entities()).some(
        (e) => e?.title === 'New all-day Event' && e.isAllDay,
      ),
    ).toBeTrue();
    editor.destroy();
    TestBed.inject(MAT_DIALOG_DATA).id = timed.id;
    const edit = TestBed.createComponent(DialogEventComponent);
    edit.detectChanges();
    edit.componentInstance.title = 'Edited';
    edit.componentInstance.save();
    expect(events.entities()[timed.id]?.title).toBe('Edited');
    await edit.componentInstance.remove();
    expect(events.entities()[timed.id]).toBeUndefined();
    expect(writes).toHaveBeenCalledTimes(3);
    edit.destroy();
  });
});
