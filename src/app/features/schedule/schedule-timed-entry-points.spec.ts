import { ElementRef, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DragDropRegistry } from '@angular/cdk/drag-drop';
import { provideStore, Store } from '@ngrx/store';
import { of, Subject } from 'rxjs';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { SnackService } from '../../core/snack/snack.service';
import { DEFAULT_TASK, TaskWithSubTasks } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { workSessionReducer } from '../work-session/store/work-session.reducer';
import { selectWorkSessionEntities } from '../work-session/store/work-session.selectors';
import { addWorkSession } from '../work-session/store/work-session.actions';
import { CreateTaskPlaceholderComponent } from './create-task-placeholder/create-task-placeholder.component';
import { ScheduleDayPanelComponent } from './schedule-day-panel/schedule-day-panel.component';
import { ScheduleExternalDragService } from './schedule-week/schedule-external-drag.service';
import { ScheduleService } from './schedule.service';
import { FH } from './schedule.const';
import { configurePlanningWrites, planningCommands } from '../planning/planning-commands';
import { planningReducer } from '../planning/store/planning.reducer';
import {
  selectPlanningState,
  selectAllPlacements,
  selectOrderedDayTaskIds,
} from '../planning/store/planning.selectors';
import { PlanstrandPageComponent } from '../../pages/planstrand/planstrand-page.component';
import { PlanstrandService } from '../../pages/planstrand/planstrand.service';
import { ActivatedRoute } from '@angular/router';
import { CurrentDateService } from '../../core/date/current-date.service';
import { WorkSessionService } from '../work-session/work-session.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';

describe('timed placeholder and day-panel entry points', () => {
  const task: TaskWithSubTasks = {
    ...DEFAULT_TASK,
    id: 'task',
    projectId: 'INBOX',
    timeEstimate: 1800000,
    subTasks: [],
  };
  const day = '2026-01-16';
  let store: Store;
  let writes: jasmine.Spy;
  let fixture: ComponentFixture<
    CreateTaskPlaceholderComponent | ScheduleDayPanelComponent
  >;
  let pointerUp: Subject<MouseEvent | TouchEvent>;
  let activeTask: ReturnType<typeof signal<TaskWithSubTasks | null>>;
  let addTask: jasmine.Spy;
  let today: ReturnType<typeof signal<string>>;

  beforeEach(async () => {
    configurePlanningWrites({ getOrGenerateClientId: async () => 'minute-edit-tests' });
    today = signal(day);
    pointerUp = new Subject();
    activeTask = signal<TaskWithSubTasks | null>(null);
    addTask = jasmine.createSpy('add').and.returnValue(task.id);
    await TestBed.configureTestingModule({
      imports: [CreateTaskPlaceholderComponent, ScheduleDayPanelComponent],
      providers: [
        provideStore({
          tasks: (state = { ids: [task.id], entities: { [task.id]: task } }) => state,
          workSession: workSessionReducer,
          planning: planningReducer,
          projects: (
            state = {
              ids: ['INBOX'],
              entities: {
                INBOX: { id: 'INBOX', taskIds: [task.id], backlogTaskIds: [] },
              },
            },
          ) => state,
          folder: (state = { ids: [], entities: {} }) => state,
          globalConfig: (state = DEFAULT_GLOBAL_CONFIG) => state,
        }),
        {
          provide: GlobalConfigService,
          useValue: { localization: () => ({ timeZone: 'Asia/Singapore' }) },
        },
        { provide: DateService, useValue: { todayStr: () => day } },
        { provide: DateTimeFormatService, useValue: { currentLocale: signal('en-GB') } },
        { provide: GlobalTrackingIntervalService, useValue: { todayDateStr$: of(day) } },
        { provide: DragDropRegistry, useValue: { pointerUp } },
        {
          provide: ScheduleExternalDragService,
          useValue: {
            activeTask,
            setActiveTask: activeTask.set,
            setCancelNextDrop: jasmine.createSpy('setCancelNextDrop'),
          },
        },
        {
          provide: ScheduleService,
          useValue: {
            today,
            getTodayStr: () => today(),
            displayTimeZone: () => 'Asia/Singapore',
            createScheduleDaysComputed: () => signal([]),
            scheduleRefreshTick: signal(0),
          },
        },
        {
          provide: TaskService,
          useValue: { add: addTask, getByIdOnce$: () => of(task) },
        },
        { provide: SnackService, useValue: { open: jasmine.createSpy('open') } },
        { provide: CurrentDateService, useValue: { today, dateInZone: () => today } },
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({ planstrand: 'today' }),
            paramMap: of({ get: () => null }),
          },
        },
        {
          provide: PlanstrandService,
          useValue: { rows: () => [], visibleRows: () => [] },
        },
      ],
    })
      .overrideComponent(CreateTaskPlaceholderComponent, { set: { template: '' } })
      .overrideComponent(ScheduleDayPanelComponent, { set: { template: '' } })
      .compileComponents();
    store = TestBed.inject(Store);
    writes = spyOn(store, 'dispatch').and.callThrough();
  });

  afterEach(() => fixture?.destroy());

  const assertSession = (start: number, duration = task.timeEstimate): void => {
    const session = Object.values(store.selectSignal(selectWorkSessionEntities)())[0];
    expect(session).toEqual(
      jasmine.objectContaining({
        taskId: task.id,
        start,
        end: start + duration,
        timeZone: 'Asia/Singapore',
      }),
    );
    expect(session?.completedAt).toBeUndefined();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.calls.mostRecent().args[0].type).toBe(addWorkSession.type);
  };

  const placeholder = (inMyDay = false): CreateTaskPlaceholderComponent => {
    const created = TestBed.createComponent(CreateTaskPlaceholderComponent);
    fixture = created;
    created.componentRef.setInput('isEditMode', false);
    created.componentRef.setInput('isInMyDay', inMyDay);
    created.componentRef.setInput('date', day);
    created.componentRef.setInput('time', '10:00');
    created.detectChanges();
    return created.componentInstance;
  };

  it('selects an existing Task in a timed placeholder without a Task update', async () => {
    await placeholder().onTaskSelected(task);
    assertSession(Date.parse('2026-01-16T10:00:00+08:00'));
    expect(addTask).not.toHaveBeenCalled();
  });

  it('uses the existing placeholder Enter path and preserves new-Task estimate and absent Today placement', async () => {
    const component = placeholder();
    component.onTextChanged('New task');
    await component.onSelectTaskKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(addTask).toHaveBeenCalledOnceWith('New task', undefined, {
      timeEstimate: 1800000,
      dueDay: null,
    });
    // TaskService.add owns the independent Task create; the placeholder then emits one session action.
    assertSession(Date.parse('2026-01-16T10:00:00+08:00'));
  });

  it('creates one My Day Task/session with Today Planning, Focus projection, restart persistence and explicit Unplan', async () => {
    const page = TestBed.runInInjectionContext(() => new PlanstrandPageComponent());
    expect(page.captureTasks().map((t) => t.id)).toContain(task.id);
    const component = placeholder(true);
    component.onTextChanged('New My Day task');
    await Promise.all([
      component.onSelectTaskKeyDown(new KeyboardEvent('keydown', { key: 'Enter' })),
      component.onSelectTaskKeyDown(
        new KeyboardEvent('keydown', { key: 'Enter', repeat: true }),
      ),
    ]);
    expect(addTask).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(Object.values(store.selectSignal(selectWorkSessionEntities)())).toHaveSize(1);
    expect(store.selectSignal(selectOrderedDayTaskIds(day))()).toEqual([task.id]);
    expect(page.focusTasks().map((t) => t.id)).toEqual([task.id]);
    expect(page.captureTasks()).toEqual([]);
    const snapshot = JSON.parse(
      JSON.stringify(store.selectSignal(selectPlanningState)()),
    );
    const reloaded = planningReducer(
      undefined,
      loadAllData({ appDataComplete: { planning: snapshot } as never }),
    );
    expect(
      selectAllPlacements.projector(reloaded.entities, { [task.id]: task }),
    ).toHaveSize(1);
    planningCommands(store).unplan(task.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(page.focusTasks()).toEqual([]);
    expect(page.captureTasks().map((t) => t.id)).toEqual([task.id]);
    expect(Object.values(store.selectSignal(selectWorkSessionEntities)())).toHaveSize(1);
  });

  it('captures the new local date when My Day remains open across midnight', async () => {
    const component = placeholder(true);
    today.set('2026-01-17');
    component.onTextChanged('After midnight');
    await component.onSelectTaskKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(store.selectSignal(selectOrderedDayTaskIds('2026-01-17'))()).toEqual([
      task.id,
    ]);
    const session = Object.values(store.selectSignal(selectWorkSessionEntities)())[0]!;
    expect(session.start).toBe(Date.parse('2026-01-17T10:00:00+08:00'));
  });

  it('preserves a future Planning assignment when selecting an existing Task in My Day', async () => {
    store.dispatch(await planningCommands(store).dayAction({ task, day: '2026-01-20' }));
    const original = store.selectSignal(selectPlanningState)();
    writes.calls.reset();
    await placeholder(true).onTaskSelected(task);
    assertSession(Date.parse('2026-01-16T10:00:00+08:00'));
    expect(store.selectSignal(selectPlanningState)()).toBe(original);
    expect(addTask).not.toHaveBeenCalled();
  });

  it('plans a new My Day Task in date-only mode without duplicate automatic placement or a session', async () => {
    const component = placeholder(true);
    component.isForDayMode.set(true);
    component.onTextChanged('Date only');
    await component.onSelectTaskKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(addTask).toHaveBeenCalledOnceWith('Date only', false, {
      timeEstimate: 1800000,
      dueDay: null,
    });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(store.selectSignal(selectOrderedDayTaskIds(day))()).toEqual([task.id]);
    expect(Object.values(store.selectSignal(selectWorkSessionEntities)())).toHaveSize(0);
  });

  it('does not add Planning when WorkSession creation fails', async () => {
    (window.confirm as jasmine.Spy).and.returnValue(false);
    spyOn(TestBed.inject(WorkSessionService), 'scheduleTask').and.returnValue(false);
    const component = placeholder(true);
    component.onTextChanged('Failed schedule');
    await component.onSelectTaskKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(writes).not.toHaveBeenCalled();
    expect(store.selectSignal(selectPlanningState)().ids).toHaveSize(0);
  });

  for (const touch of [false, true]) {
    it(`routes the day-panel ${touch ? 'touch' : 'mouse'} drop to one WorkSession create without changing existing Planning`, async () => {
      store.dispatch(
        await planningCommands(store).dayAction({ task, day: '2026-01-20' }),
      );
      const originalPlanning = store.selectSignal(selectPlanningState)();
      writes.calls.reset();
      const created = TestBed.createComponent(ScheduleDayPanelComponent);
      fixture = created;
      created.detectChanges();
      const component = created.componentInstance;
      const grid = document.createElement('div');
      grid.className = 'grid-container';
      created.nativeElement.appendChild(grid);
      const rect = {
        top: 0,
        bottom: 24 * FH * 10,
        left: 0,
        right: 500,
        height: 24 * FH * 10,
      } as DOMRect;
      spyOn(grid, 'getBoundingClientRect').and.returnValue(rect);
      component.scheduleWeekRef = new ElementRef(created.nativeElement);
      component.dropZoneRef = new ElementRef(grid);
      const start = Date.parse('2026-01-16T10:00:00+08:00');
      const preview = component as unknown as {
        _calculatePreviewStyleFromTime: (instant: number) => string;
        _formatPreviewTime: (instant: number) => string;
      };
      expect(preview._calculatePreviewStyleFromTime(start)).toContain('grid-row: 121 /');
      expect(preview._formatPreviewTime(start)).toBe('10:00');
      activeTask.set({ ...task, timeEstimate: 0 });
      const y = 10 * FH * 10;
      const contact = new Touch({
        identifier: 1,
        target: grid,
        clientX: 100,
        clientY: y,
      });
      component.onDragMove(
        touch
          ? new TouchEvent('touchmove', { touches: [contact] })
          : new MouseEvent('mousemove', { clientX: 100, clientY: y }),
      );
      pointerUp.next(
        touch
          ? new TouchEvent('touchend', { changedTouches: [contact] })
          : new MouseEvent('mouseup', { clientX: 100, clientY: y }),
      );
      assertSession(Date.parse('2026-01-16T10:00:00+08:00'), 900000);
      expect(activeTask()).toBeNull();
      expect(component.isDragging()).toBeFalse();
      // A second native/CDK release after cleanup must not schedule again.
      pointerUp.next(new MouseEvent('mouseup', { clientX: 100, clientY: y }));
      expect(writes).toHaveBeenCalledTimes(1);
      expect(Object.keys(store.selectSignal(selectWorkSessionEntities)()).length).toBe(1);
      expect(store.selectSignal(selectPlanningState)()).toBe(originalPlanning);
    });
  }

  it('rejects a My Day drop with no resolvable time instead of silently replanning the Task', async () => {
    store.dispatch(await planningCommands(store).dayAction({ task, day: '2026-01-20' }));
    const originalPlanning = store.selectSignal(selectPlanningState)();
    writes.calls.reset();
    const created = TestBed.createComponent(ScheduleDayPanelComponent);
    fixture = created;
    created.detectChanges();
    const component = created.componentInstance;
    const zone = document.createElement('div');
    spyOn(zone, 'getBoundingClientRect').and.returnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 500,
      height: 500,
    } as DOMRect);
    component.scheduleWeekRef = new ElementRef(zone);
    component.dropZoneRef = new ElementRef(zone);
    activeTask.set(task);
    component.onDragMove(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    pointerUp.next(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(writes).not.toHaveBeenCalled();
    expect(store.selectSignal(selectPlanningState)()).toBe(originalPlanning);
    expect(Object.values(store.selectSignal(selectWorkSessionEntities)())).toHaveSize(0);
  });
});
