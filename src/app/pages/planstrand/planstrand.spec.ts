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
      providers: [
        provideMockStore({ initialState: state }),
        PlanstrandService,
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
