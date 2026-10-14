import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlanningStatusComponent } from '../../features/planning/planning-status.component';
import { selectAllPlacements } from '../../features/planning/store/planning.selectors';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { PlanstrandPageComponent } from './planstrand-page.component';
import { PlanningDestinationDialogComponent } from './planning-destination-dialog.component';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CurrentDateService } from '../../core/date/current-date.service';
import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { DEFAULT_TASK, TaskWithSubTasks } from '../../features/tasks/task.model';
import { TaskService } from '../../features/tasks/task.service';
import { initialFolderState } from '../../features/folder/folder-state';
import { INBOX_FOLDER_ID } from '../../features/folder/folder.const';
import { selectMasterTaskGroups } from './planstrand.selectors';
import { PlanstrandService } from './planstrand.service';
import { createStateWithExistingTasks } from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import { initialPlanningState } from '../../features/planning/store/planning.reducer';
import {
  configurePlanningWrites,
  planningCommands,
} from '../../features/planning/planning-commands';
import {
  setPlacement,
  removePlacement,
} from '../../features/planning/store/planning.actions';
import { APP_ROUTES } from '../../app.routes';
import { moveFolder, removeFolder } from '../../features/folder/store/folder.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { PlanstrandTaskListComponent } from './planstrand-task-list.component';
import { CdkDragDrop, CdkDragStart } from '@angular/cdk/drag-drop';
import { ScheduleExternalDragService } from '../../features/schedule/schedule-week/schedule-external-drag.service';
import { DialogScheduleTaskComponent } from '../../features/planner/dialog-schedule-task/dialog-schedule-task.component';
import { selectLocalizationConfig } from '../../features/config/store/global-config.reducer';

describe('Fast-Track Milestone A commands and selectors', () => {
  const folders = {
    ...initialFolderState,
    ids: [...initialFolderState.ids, 'a', 'b'],
    entities: {
      ...initialFolderState.entities,
      a: { id: 'a', title: 'A', orderKey: 'A' },
      b: { id: 'b', title: 'B', parentId: 'a', orderKey: 'B' },
    },
  };
  const task = (id: string, folderId?: string): TaskWithSubTasks => ({
    ...DEFAULT_TASK,
    id,
    title: id,
    projectId: 'legacy',
    folderId,
    subTasks: [],
  });
  const destinationData = { type: 'DAY', date: '2026-10-01' };
  const destinationClose = jasmine.createSpy('close');
  let store: MockStore;
  let ui: PlanstrandService;
  let dispatch: jasmine.Spy;
  let taskService: jasmine.SpyObj<TaskService>;

  beforeEach(() => {
    localStorage.removeItem('PLANSTRAND_COLLAPSED_FOLDERS');
    const state = createStateWithExistingTasks(['task', 'child'], [], [], []);
    state.folder = folders;
    state.planning = initialPlanningState;
    state.tasks.entities['task'] = task('task', 'a');
    state.tasks.entities['child'] = { ...task('child', 'a'), parentId: 'task' };
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'update',
      'createNewTaskWithDefaults',
    ]);
    taskService.createNewTaskWithDefaults.and.callFake((p) => ({
      ...DEFAULT_TASK,
      id: 'new',
      title: p.title ?? '',
      projectId: 'INBOX_PROJECT',
      ...p.additional,
    }));
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      teardown: { destroyAfterEach: true },
      providers: [
        provideMockStore({ initialState: state }),
        { provide: MAT_DIALOG_DATA, useValue: destinationData },
        { provide: MatDialogRef, useValue: { close: destinationClose } },
        PlanstrandService,
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({ planstrand: 'week' }),
            paramMap: of(convertToParamMap({})),
          },
        },
        { provide: TaskService, useValue: taskService },
        {
          provide: MatDialog,
          useValue: { open: () => ({ afterClosed: () => of('New') }) },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    ui = TestBed.inject(PlanstrandService);
    dispatch = spyOn(store, 'dispatch');
    configurePlanningWrites({ getOrGenerateClientId: async () => 'milestone-test' });
  });

  afterEach(() => store.resetSelectors());

  it('projects Today Focus in the configured zone and follows that zone midnight', () => {
    const now = spyOn(Date, 'now').and.returnValue(Date.parse('2026-10-14T15:59:00Z'));
    TestBed.inject(ActivatedRoute).data = of({ planstrand: 'today' });
    const config = store.selectSignal(selectLocalizationConfig)();
    store.overrideSelector(selectLocalizationConfig, {
      ...config,
      timeZone: 'Asia/Singapore',
    });
    store.overrideSelector(selectAllPlacements, [
      { id: 'task', target: { type: 'DAY', key: '2026-10-15' }, orderKey: 'V' },
    ]);
    store.refreshState();
    const page = TestBed.runInInjectionContext(() => new PlanstrandPageComponent());
    expect(page.today()).toBe('2026-10-14');
    expect(page.focusTasks()).toEqual([]);
    now.and.returnValue(Date.parse('2026-10-14T16:01:00Z'));
    TestBed.inject(CurrentDateService).refresh();
    expect(page.today()).toBe('2026-10-15');
    expect(page.focusTasks().map((entry) => entry.id)).toEqual(['task']);
    expect(page.captureTasks().some((entry) => entry.id === 'task')).toBeFalse();
  });

  for (const [firstDayOfWeek, start] of [
    [1, '2026-12-28'],
    [0, '2026-12-27'],
  ] as const) {
    it(
      'navigates civil weeks and keeps Add on the displayed week with start ' +
        firstDayOfWeek,
      () => {
        spyOn(Date, 'now').and.returnValue(new Date('2026-12-31T12:00:00').getTime());
        const config = store.selectSignal(selectLocalizationConfig)();
        store.overrideSelector(selectLocalizationConfig, { ...config, firstDayOfWeek });
        store.refreshState();
        const page = TestBed.runInInjectionContext(() => new PlanstrandPageComponent());
        expect(page.days()[0]).toBe(start);
        page.weekOffset.set(1);
        expect(page.days()[0]).toBe(firstDayOfWeek === 1 ? '2027-01-04' : '2027-01-03');
        expect(page.days()[6]).toBe(firstDayOfWeek === 1 ? '2027-01-10' : '2027-01-09');
        const create = spyOn(ui, 'createTask').and.resolveTo();
        page.addTask(page.sections()[0].target);
        expect(create).toHaveBeenCalledWith(INBOX_FOLDER_ID, undefined, {
          type: 'WEEK',
          key: page.days()[0],
        });
        page.addTask(page.sections()[2].target);
        expect(create.calls.mostRecent().args[2]).toEqual({
          type: 'DAY',
          key: page.days()[1],
        });
        page.weekOffset.set(-1);
        expect(page.days()[0]).toBe(firstDayOfWeek === 1 ? '2026-12-21' : '2026-12-20');
        page.weekOffset.set(0);
        expect(page.days()[0]).toBe(start);
        const dates = TestBed.inject(CurrentDateService);
        expect(page.today()).toBe(dates.today());
      },
    );
  }

  for (const [type, date, firstDayOfWeek, expected] of [
    ['DAY', '2028-02-29', 1, '2028-02-29'],
    ['DAY', '2020-01-01', 0, '2020-01-01'],
    ['WEEK', '2027-01-01', 1, '2026-12-28'],
    ['WEEK', '2027-01-01', 0, '2026-12-27'],
  ] as const) {
    it('chooses arbitrary ' + type + ' ' + date + ' with start ' + firstDayOfWeek, () => {
      const close = destinationClose;
      close.calls.reset();
      Object.assign(destinationData, { type, date });
      const config = store.selectSignal(selectLocalizationConfig)();
      store.overrideSelector(selectLocalizationConfig, { ...config, firstDayOfWeek });
      store.refreshState();
      const dialog = TestBed.runInInjectionContext(
        () => new PlanningDestinationDialogComponent(),
      );
      dialog.save();
      expect(close).toHaveBeenCalledWith({ type, key: expected });
      dialog.selected.set(null);
      close.calls.reset();
      dialog.save();
      expect(close).not.toHaveBeenCalled();
    });
  }

  it('renders selector-backed planning status and immediately reflects moves and unplanning', () => {
    spyOn(Date, 'now').and.returnValue(new Date('2026-12-31T12:00:00').getTime());
    const translations = TestBed.inject(TranslateService);
    translations.setTranslation('en', {
      PLANSTRAND: {
        PLAN: 'Plan Task',
        UNPLANNED: 'Unplanned',
        TODAY: 'Today',
        TOMORROW: 'Tomorrow',
        WEEK_OF: 'Week of {{date}}',
      },
    });
    translations.use('en');
    const placements = store.overrideSelector(selectAllPlacements, []);
    const fixture = TestBed.createComponent(PlanningStatusComponent);
    fixture.componentRef.setInput('taskId', 'task');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('Unplanned');
    for (const [type, key, label] of [
      ['DAY', '2026-12-31', 'Today'],
      ['DAY', '2027-01-01', 'Tomorrow'],
      ['DAY', '2028-02-29', 'Feb 29, 2028'],
      ['WEEK', '2027-01-04', 'Week of Jan 4, 2027'],
    ] as const) {
      placements.setResult([{ id: 'task', target: { type, key }, orderKey: 'V' }]);
      store.refreshState();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent.trim()).toBe(label);
    }
    placements.setResult([]);
    store.refreshState();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('Unplanned');
  });

  it('keeps future assignments in their selected week and follows local midnight rollover', () => {
    const now = spyOn(Date, 'now').and.returnValue(
      new Date('2026-12-31T23:59:59').getTime(),
    );
    store.overrideSelector(selectAllPlacements, [
      { id: 'task', target: { type: 'WEEK', key: '2027-01-04' }, orderKey: 'V' },
      { id: 'child', target: { type: 'DAY', key: '2027-01-06' }, orderKey: 'V' },
    ]);
    store.refreshState();
    const page = TestBed.runInInjectionContext(() => new PlanstrandPageComponent());
    expect(page.sections().flatMap((s) => s.tasks)).toEqual([]);
    page.weekOffset.set(1);
    expect(page.sections()[0].tasks.map((t) => t.id)).toEqual(['task']);
    expect(page.sections()[3].tasks.map((t) => t.id)).toEqual(['child']);
    now.and.returnValue(new Date('2027-01-04T00:00:01').getTime());
    TestBed.inject(CurrentDateService).refresh();
    expect(page.today()).toBe('2027-01-04');
    expect(page.days()[0]).toBe('2027-01-11');
    page.weekOffset.set(0);
    expect(page.days()[0]).toBe('2027-01-04');
  });

  it('resolves Plan for Today at selection time after a midnight boundary', async () => {
    const clock = spyOn(Date, 'now').and.returnValue(
      new Date(2026, 9, 6, 23, 59, 59).getTime(),
    );
    const list = TestBed.runInInjectionContext(() => new PlanstrandTaskListComponent());
    expect(list.today()).toBe('2026-10-06');
    clock.and.returnValue(new Date(2026, 9, 7, 0, 0, 1).getTime());
    list.plan(task('task'), 'TODAY');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(list.today()).toBe('2026-10-07');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.calls.mostRecent().args[0].record.placement.target).toEqual({
      type: 'DAY',
      key: '2026-10-07',
    });
  });

  for (const [date, target, firstDayOfWeek, type, key] of [
    ['2026-12-31', 'TOMORROW', 1, 'DAY', '2027-01-01'],
    ['2028-02-28', 'TOMORROW', 1, 'DAY', '2028-02-29'],
    ['2026-12-31', 'NEXT_WEEK', 1, 'WEEK', '2027-01-04'],
    ['2026-12-31', 'NEXT_WEEK', 0, 'WEEK', '2027-01-03'],
    ['2027-01-03', 'WEEK', 1, 'WEEK', '2026-12-28'],
    ['2027-01-03', 'WEEK', 0, 'WEEK', '2027-01-03'],
  ] as const) {
    it(
      'resolves ' + target + ' on ' + date + ' with week start ' + firstDayOfWeek,
      async () => {
        spyOn(Date, 'now').and.returnValue(new Date(date + 'T00:01:00').getTime());
        const config = store.selectSignal(selectLocalizationConfig)();
        store.overrideSelector(selectLocalizationConfig, { ...config, firstDayOfWeek });
        store.refreshState();
        const list = TestBed.runInInjectionContext(
          () => new PlanstrandTaskListComponent(),
        );
        const original = {
          ...task('task', 'a'),
          isDone: true,
          dueDay: '2027-02-01',
          deadlineDay: '2027-02-02',
          reminderId: 'reminder',
        };
        const snapshot = JSON.stringify(original);
        list.plan(original, target);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(dispatch).toHaveBeenCalledTimes(1);
        const action = dispatch.calls.mostRecent().args[0];
        expect(action.type).toBe(setPlacement.type);
        expect(action.record.placement.target).toEqual({ type, key });
        expect(JSON.stringify(original)).toBe(snapshot);
        expect(taskService.update).not.toHaveBeenCalled();
      },
    );
  }

  it('unplans through one Planning operation without updating the Task', async () => {
    const list = TestBed.runInInjectionContext(() => new PlanstrandTaskListComponent());
    list.plan(task('task'), 'UNPLAN');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.calls.mostRecent().args[0].type).toBe(removePlacement.type);
    expect(taskService.update).not.toHaveBeenCalled();
  });

  it('groups stale, missing and explicit Inbox ownership without consulting Project', () => {
    const explicit = task('inbox', INBOX_FOLDER_ID),
      missing = task('missing', 'deleted'),
      legacy = task('legacy');
    const groups = selectMasterTaskGroups.projector(folders, [
      task('a', 'a'),
      explicit,
      missing,
      legacy,
    ]);
    expect(groups.get(INBOX_FOLDER_ID)).toEqual([explicit, missing, legacy]);
    expect(groups.get('a')?.map((t) => t.id)).toEqual(['a']);
  });

  it('creates a task and exact day/week placement in one persistent action', async () => {
    for (const target of [
      { type: 'WEEK' as const, key: '2026-10-05' },
      { type: 'DAY' as const, key: '2026-10-05' },
      { type: 'DAY' as const, key: '2026-10-08' },
    ]) {
      dispatch.calls.reset();
      await ui.createTask(INBOX_FOLDER_ID, 'Planned capture', target);
      expect(dispatch).toHaveBeenCalledTimes(1);
      const action = dispatch.calls.mostRecent().args[0];
      expect(action.type).toBe(TaskSharedActions.addTask.type);
      expect(action.initialPlanning.id).toBe(action.task.id);
      expect(action.initialPlanning.placement.target).toEqual(target);
      expect(JSON.parse(JSON.stringify(action))).toEqual(action);
    }
  });
  it('keeps subtasks with their top-level task', () => {
    const parent = {
      ...task('parent', 'a'),
      subTaskIds: ['child'],
      subTasks: [task('child', 'a')],
    };
    expect(selectMasterTaskGroups.projector(folders, [parent]).get('a')).toEqual([
      parent,
    ]);
  });
  it('creates a Folder task in one Task operation without implicitly planning it', async () => {
    await ui.createTask('a');
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.calls.mostRecent().args[0];
    expect(action.type).toBe(TaskSharedActions.addTask.type);
    expect(action.task.folderId).toBe('a');
  });
  it('moves a subtask through its top-level owner with one Task mutation', () => {
    ui.moveTask({ ...task('child', 'a'), parentId: 'task' }, 'b');
    expect(taskService.update).toHaveBeenCalledOnceWith('task', { folderId: 'b' });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('rejects cyclic Folder moves before dispatch', () => {
    ui.moveFolder('a', 'b');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('reparents with one Folder operation', () => {
    ui.moveFolder('b', null);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.calls.mostRecent().args[0].type).toBe(moveFolder.type);
    expect(
      dispatch.calls.mostRecent().args[0].folderState.entities.b.parentId,
    ).toBeNull();
  });
  it('uses leaf-only deletion rules and leaves Task references untouched', () => {
    ui.deleteFolder('a');
    expect(dispatch.calls.mostRecent().args[0].folderState).toBe(folders);
    ui.deleteFolder('b');
    expect(dispatch.calls.mostRecent().args[0].type).toBe(removeFolder.type);
    expect(dispatch.calls.mostRecent().args[0].folderState.entities.b).toBeUndefined();
    expect(taskService.update).not.toHaveBeenCalled();
  });
  it('stores collapse state only on the device', () => {
    ui.toggle('a');
    expect(ui.visibleRows().some((r) => r.folder.id === 'b')).toBeFalse();
    expect(JSON.parse(localStorage.getItem('PLANSTRAND_COLLAPSED_FOLDERS')!)).toEqual([
      'a',
    ]);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('uses one Planning operation for day movement without scheduling a Task', async () => {
    planningCommands(store).placeAt('task', { type: 'DAY', key: '2026-10-05' }, 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.calls.mostRecent().args[0].type).toBe(setPlacement.type);
    expect(dispatch.calls.mostRecent().args[0].record.placement.target.type).toBe('DAY');
    expect(taskService.update).not.toHaveBeenCalled();
  });
  it('supports week-level placement and unplanning without Task deletion or unscheduling', async () => {
    planningCommands(store).placeAt('task', { type: 'WEEK', key: '2026-10-05' }, 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(dispatch.calls.mostRecent().args[0].record.placement.target.type).toBe('WEEK');
    dispatch.calls.reset();
    planningCommands(store).unplan('task');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.calls.mostRecent().args[0].type).toBe(removePlacement.type);
    expect(taskService.update).not.toHaveBeenCalled();
  });
  it('exposes primary routes and preserves upstream routes', () => {
    const paths = APP_ROUTES.map((r) => r.path);
    for (const path of [
      'inbox',
      'master-tasks',
      'folder/:id',
      'today',
      'this-week',
      'schedule',
      'project/:id',
      'planner',
      'search',
    ])
      expect(paths).toContain(path);
  });
  it('translates a Task drop into one destination intent and ignores Folder drags', () => {
    const list = TestBed.runInInjectionContext(() => new PlanstrandTaskListComponent());
    const emit = spyOn(list.dropped, 'emit');
    list.drop({
      isPointerOverContainer: true,
      item: { data: 'folder-a' },
      currentIndex: 0,
    } as unknown as CdkDragDrop<TaskWithSubTasks[]>);
    expect(emit).not.toHaveBeenCalled();
    const entry = task('task', 'a');
    list.drop({
      isPointerOverContainer: true,
      item: { data: entry },
      currentIndex: 2,
    } as unknown as CdkDragDrop<TaskWithSubTasks[]>);
    expect(emit).toHaveBeenCalledOnceWith({ task: entry, index: 2 });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('registers scheduling drags and never emits a placement for an external drop', () => {
    const list = TestBed.runInInjectionContext(() => new PlanstrandTaskListComponent());
    const external = TestBed.inject(ScheduleExternalDragService);
    const entry = task('task', 'a');
    const ref = {};
    list.startDrag(entry, { source: { _dragRef: ref } } as CdkDragStart);
    expect(external.activeTask()).toBe(entry);
    const emit = spyOn(list.dropped, 'emit');
    list.drop({
      isPointerOverContainer: false,
      item: { data: entry },
      currentIndex: 0,
    } as unknown as CdkDragDrop<TaskWithSubTasks[]>);
    expect(emit).not.toHaveBeenCalled();
    external.setCancelNextDrop(true);
    list.drop({
      isPointerOverContainer: true,
      item: { data: entry },
      currentIndex: 0,
    } as unknown as CdkDragDrop<TaskWithSubTasks[]>);
    expect(emit).not.toHaveBeenCalled();
    list.endDrag();
    expect(external.activeTask()).toBeNull();
  });
  it('opens the existing scheduling dialog and keeps quick date selection open for time placement', () => {
    const list = TestBed.runInInjectionContext(() => new PlanstrandTaskListComponent());
    const open = spyOn(TestBed.inject(MatDialog), 'open').and.callThrough();
    const entry = task('task', 'a');
    list.schedule(entry);
    expect(open).toHaveBeenCalledWith(DialogScheduleTaskComponent, {
      data: { task: entry, isSubmitOnQuickAccess: false },
    });
    expect(list.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('reorders week placement in one Planning operation with deterministic anchor order', async () => {
    const state = createStateWithExistingTasks(['task', 'other'], [], [], []);
    state.planning = {
      ids: ['task', 'other'],
      entities: {
        task: {
          id: 'task',
          placement: { target: { type: 'WEEK', key: '2026-10-05' }, orderKey: 'z' },
          revision: { counter: 1, clientId: 'test', opId: '1' },
        },
        other: {
          id: 'other',
          placement: { target: { type: 'WEEK', key: '2026-10-05' }, orderKey: 'V' },
          revision: { counter: 1, clientId: 'test', opId: '2' },
        },
      },
    };
    store.setState(state);
    planningCommands(store).placeAt('task', { type: 'WEEK', key: '2026-10-05' }, 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(
      dispatch.calls.mostRecent().args[0].record.placement.orderKey < 'V',
    ).toBeTrue();
    expect(taskService.update).not.toHaveBeenCalled();
  });
});
