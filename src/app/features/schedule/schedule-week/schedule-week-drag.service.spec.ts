import { WorkSessionService } from '../../work-session/work-session.service';
import {
  configurePlanningFixture,
  expectPlanningDay,
  flushPlanningWrites,
} from '../../../../test-helpers/planning-fixture';
import { TestBed } from '@angular/core/testing';
import { CdkDragRelease } from '@angular/cdk/drag-drop';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { ScheduleWeekDragService } from './schedule-week-drag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskCopy, TaskReminderOptionId } from '../../tasks/task.model';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { signal } from '@angular/core';
import { GlobalConfigState } from '../../config/global-config.model';
import { ScheduleEvent } from '../schedule.model';
import { FH, SVEType, T_ID_PREFIX } from '../schedule.const';
import { CalendarEventActionsService } from '../../calendar-integration/calendar-event-actions.service';
import { DateService } from '../../../core/date/date.service';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

describe('ScheduleWeekDragService', () => {
  let service: ScheduleWeekDragService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let calendarEventActionsSpy: jasmine.SpyObj<CalendarEventActionsService>;

  const createMockGlobalConfigService = (
    defaultTaskRemindOption: TaskReminderOptionId = TaskReminderOptionId.AtStart,
  ): Partial<GlobalConfigService> => {
    const mockCfg = {
      ...DEFAULT_GLOBAL_CONFIG,
      reminder: {
        ...DEFAULT_GLOBAL_CONFIG.reminder,
        defaultTaskRemindOption,
      },
    } as GlobalConfigState;

    return {
      cfg: signal(mockCfg),
    };
  };

  const setupTestBed = (
    defaultTaskRemindOption: TaskReminderOptionId = TaskReminderOptionId.AtStart,
  ): void => {
    TestBed.configureTestingModule({
      providers: [
        ScheduleWeekDragService,
        provideMockStore(),
        {
          provide: CalendarEventActionsService,
          useValue: jasmine.createSpyObj<CalendarEventActionsService>(
            'CalendarEventActionsService',
            ['canMoveEvent', 'moveToStartTime'],
          ),
        },
        {
          provide: GlobalConfigService,
          useValue: createMockGlobalConfigService(defaultTaskRemindOption),
        },
        {
          provide: DateService,
          useValue: { todayStr: () => '2026-03-20' },
        },
      ],
    });

    service = TestBed.inject(ScheduleWeekDragService);
    store = TestBed.inject(MockStore);
    calendarEventActionsSpy = TestBed.inject(
      CalendarEventActionsService,
    ) as jasmine.SpyObj<CalendarEventActionsService>;
    calendarEventActionsSpy.canMoveEvent.and.returnValue(true);
    calendarEventActionsSpy.moveToStartTime.and.resolveTo(true);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
  };

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('captures today when unscheduling a timed task but leaving it in Today', () => {
    setupTestBed();
    const sourceEvent = createTaskEvent({ id: 'task-1', dueWithTime: Date.now() });

    (
      service as unknown as {
        _handleUnschedule: (task: TaskCopy, sourceEvent: ScheduleEvent) => void;
      }
    )._handleUnschedule(sourceEvent.data as TaskCopy, sourceEvent);

    expect(dispatchSpy).toHaveBeenCalledWith(
      TaskSharedActions.unscheduleTask({
        id: 'task-1',
        isLeaveInToday: true,
        today: '2026-03-20',
      }),
    );
  });

  const createTaskEvent = (
    task: Partial<{ id: string; title: string; dueWithTime: number }> = {},
  ): ScheduleEvent =>
    ({
      id: task.id ?? 'task-1',
      type: SVEType.ScheduledTask,
      style: '',
      startHours: 10,
      timeLeftInHours: 0.5,
      data: {
        id: task.id ?? 'task-1',
        title: task.title ?? 'Test Task',
        timeEstimate: THIRTY_MINUTES_MS,
        dueWithTime: task.dueWithTime,
      },
    }) as ScheduleEvent;

  describe('drag release reorder behavior', () => {
    const createReleaseEvent = (
      sourceEvent: ScheduleEvent,
      sourceEl: HTMLElement,
    ): CdkDragRelease<ScheduleEvent> =>
      ({
        source: {
          data: sourceEvent,
          element: {
            nativeElement: sourceEl,
          },
          reset: jasmine.createSpy('reset'),
        },
        event: new MouseEvent('mouseup', { clientX: 10, clientY: 120 }),
      }) as unknown as CdkDragRelease<ScheduleEvent>;

    const createScheduleEventElement = (
      taskId: string,
      className = SVEType.TaskPlannedForDay,
    ): HTMLElement => {
      const el = document.createElement('schedule-event');
      el.id = `${T_ID_PREFIX}${taskId}`;
      el.classList.add(className);
      return el;
    };

    beforeEach(() => {
      setupTestBed();
    });

    it('reorders canonical planning when shift-dropping over a planned task', async () => {
      configurePlanningFixture(store);
      store.setState({
        planning: {
          ids: ['target'],
          entities: {
            target: {
              id: 'target',
              placement: { target: { type: 'DAY', key: '2026-03-20' }, orderKey: 'F' },
              revision: { counter: 1, clientId: 'fixture', opId: 'target' },
            },
          },
        },
      });
      const sourceEl = createScheduleEventElement('source', SVEType.ScheduledTask);
      const targetEl = createScheduleEventElement('target');
      spyOn(document, 'elementsFromPoint').and.returnValue([targetEl]);

      service.setShiftMode(true);
      service.handleDragReleased(
        createReleaseEvent(createTaskEvent({ id: 'source' }), sourceEl),
      );

      await flushPlanningWrites();
      expectPlanningDay(dispatchSpy, 'source', '2026-03-20');
    });
  });

  describe('calendar event drag release', () => {
    const createReleaseEvent = (
      sourceEvent: ScheduleEvent,
      sourceEl: HTMLElement,
    ): CdkDragRelease<ScheduleEvent> =>
      ({
        source: {
          data: sourceEvent,
          element: {
            nativeElement: sourceEl,
          },
          reset: jasmine.createSpy('reset'),
        },
        event: new MouseEvent('mouseup', { clientX: 125, clientY: 120 }),
      }) as unknown as CdkDragRelease<ScheduleEvent>;

    const createCalendarEvent = (): ScheduleEvent =>
      ({
        id: 'calendar-1::event-1',
        type: SVEType.CalendarEvent,
        style: '',
        startHours: 10,
        timeLeftInHours: 0.5,
        data: {
          id: 'calendar-1::event-1',
          calProviderId: 'provider-1',
          issueProviderKey: 'plugin:google-calendar-provider',
          title: 'Meeting',
          start: new Date('2026-03-20T10:00:00Z').getTime(),
          duration: THIRTY_MINUTES_MS,
          icon: 'event',
        },
      }) as ScheduleEvent;

    beforeEach(() => {
      setupTestBed();
    });

    const setupCalendarGrid = (): void => {
      const columnEl = document.createElement('div');
      columnEl.classList.add('col');
      columnEl.setAttribute('data-day', '2026-03-20');
      spyOn(document, 'elementsFromPoint').and.returnValue([columnEl]);

      service.setGridContainer(() => {
        const gridEl = document.createElement('div');
        spyOn(gridEl, 'getBoundingClientRect').and.returnValue({
          top: 0,
          bottom: 24 * FH,
          left: 0,
          right: 200,
          width: 200,
          height: 24 * FH,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect);
        return gridEl;
      });
      service.setDaysToShowAccessor(() => ['2026-03-20']);
    };

    it('moves plugin calendar events via the calendar action service when dropped on a time column', () => {
      const sourceEl = document.createElement('schedule-event');
      setupCalendarGrid();
      service.handleDragStarted({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 120 },
      } as unknown as any);
      service.handleDragReleased(createReleaseEvent(createCalendarEvent(), sourceEl));

      expect(calendarEventActionsSpy.moveToStartTime).toHaveBeenCalledTimes(1);
      const [calendarEvent, startMs] =
        calendarEventActionsSpy.moveToStartTime.calls.mostRecent().args;
      expect(calendarEvent.id).toBe('calendar-1::event-1');
      expect(startMs).toEqual(jasmine.any(Number));
    });

    it('treats shift-drop on a calendar event as a normal timed move', () => {
      const sourceEl = document.createElement('schedule-event');
      setupCalendarGrid();

      service.setShiftMode(true);
      service.handleDragStarted({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 120 },
      } as unknown as any);
      service.handleDragReleased(createReleaseEvent(createCalendarEvent(), sourceEl));

      expect(calendarEventActionsSpy.moveToStartTime).toHaveBeenCalledTimes(1);
    });

    it('resets the dragged calendar event after the provider write resolves', async () => {
      const sourceEl = document.createElement('schedule-event');
      setupCalendarGrid();
      const releaseEvent = createReleaseEvent(createCalendarEvent(), sourceEl);

      service.handleDragStarted({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 120 },
      } as unknown as any);
      service.handleDragReleased(releaseEvent);

      expect(releaseEvent.source.reset).not.toHaveBeenCalled();
      expect(sourceEl.style.pointerEvents).toBe('none');
      await Promise.resolve();

      expect(releaseEvent.source.reset).toHaveBeenCalled();
      expect(sourceEl.style.transform).toBe('translate3d(0px, 0px, 0px)');
      expect(sourceEl.style.pointerEvents).toBe('');
    });

    it('suppresses the unschedule preview when dragging a calendar event outside the grid', () => {
      const sourceEl = document.createElement('schedule-event');
      setupCalendarGrid();

      service.handleDragStarted({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 5000 },
      } as unknown as any);

      expect(service.dragPreviewContext()).toBeNull();
    });

    it('does not move calendar events when the provider is read-only', () => {
      calendarEventActionsSpy.canMoveEvent.and.returnValue(false);
      const sourceEl = document.createElement('schedule-event');
      const columnEl = document.createElement('div');
      columnEl.classList.add('col');
      columnEl.setAttribute('data-day', '2026-03-20');
      spyOn(document, 'elementsFromPoint').and.returnValue([columnEl]);

      service.setGridContainer(() => {
        const gridEl = document.createElement('div');
        spyOn(gridEl, 'getBoundingClientRect').and.returnValue({
          top: 0,
          bottom: 24 * FH,
          left: 0,
          right: 200,
          width: 200,
          height: 24 * FH,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect);
        return gridEl;
      });
      service.setDaysToShowAccessor(() => ['2026-03-20']);

      const event = createCalendarEvent();
      service.handleDragStarted({
        source: {
          data: event,
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: event,
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 120 },
      } as unknown as any);
      service.handleDragReleased(createReleaseEvent(event, sourceEl));

      expect(calendarEventActionsSpy.moveToStartTime).not.toHaveBeenCalled();
    });
  });

  describe('drag preview sizing', () => {
    beforeEach(() => {
      setupTestBed();
    });

    it('should use the full remaining task time for clipped beyond-budget events', () => {
      const event = createTaskEvent();
      event.isBeyondBudget = true;
      event.timeLeftInHours = 0.25;
      event.data = {
        ...event.data,
        subTaskIds: [],
        timeEstimate: TWO_HOURS_MS,
        timeSpent: THIRTY_MINUTES_MS,
      } as ScheduleEvent['data'];

      expect((service as any)._calculateRowSpan(event)).toBe(1.5 * FH);
    });
  });

  describe('timed Task routing', () => {
    it('uses WorkSession scheduling with the established 15-minute fallback', () => {
      setupTestBed();
      const task = createTaskEvent().data as TaskCopy;
      const schedule = spyOn(
        TestBed.inject(WorkSessionService),
        'scheduleTask',
      ).and.returnValue(true);
      (
        service as unknown as {
          _scheduleTask: (task: TaskCopy, start: number) => boolean;
        }
      )._scheduleTask(task, 100);
      expect(schedule).toHaveBeenCalledWith(task, 100, 15 * 60 * 1000);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });
});
