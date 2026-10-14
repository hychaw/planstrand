import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
  DEFAULT_TASK,
  DropListModelSource,
  TaskWithSubTasks,
} from '../../features/tasks/task.model';
import { TaskService } from '../../features/tasks/task.service';
import { TaskFocusService } from '../../features/tasks/task-focus.service';
import { TaskPlanningMenuComponent } from '../../features/tasks/task-planning-menu.component';
import { TASK_ROW_MENU_ACTIONS } from '../../features/tasks/task-row-menu-actions';
import { selectTaskEntities } from '../../features/tasks/store/task.selectors';
import { selectAllPlacements } from '../../features/planning/store/planning.selectors';
import { PlanstrandTaskListComponent } from './planstrand-task-list.component';
import { PlanstrandService } from './planstrand.service';

describe('Task menu list commands', () => {
  const a = {
    ...DEFAULT_TASK,
    id: 'a',
    title: 'A',
    projectId: 'p',
    subTasks: [],
  } as TaskWithSubTasks;
  const b = { ...a, id: 'b', title: 'B' };
  let list: PlanstrandTaskListComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<PlanstrandTaskListComponent>>;
  let ui: jasmine.SpyObj<PlanstrandService>;
  let taskService: jasmine.SpyObj<TaskService>;
  let store: MockStore;
  beforeEach(() => {
    ui = jasmine.createSpyObj(
      'PlanstrandService',
      ['canReorderTask', 'chooseTaskFolder'],
      { paths: signal(new Map()), folders: signal({ entities: {} }) },
    );
    ui.canReorderTask.and.returnValue(true);
    taskService = jasmine.createSpyObj('TaskService', ['move']);
    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        { provide: PlanstrandService, useValue: ui },
        { provide: TaskService, useValue: taskService },
        { provide: MatDialog, useValue: {} },
      ],
    });
    TestBed.overrideComponent(PlanstrandTaskListComponent, {
      set: { template: '', imports: [] },
    });
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectTaskEntities, {
      a: { ...a, subTaskIds: ['x', 'y'] },
      x: { ...a, id: 'x', parentId: 'a' },
      y: { ...a, id: 'y', parentId: 'a' },
    });
    store.overrideSelector(selectAllPlacements, []);
    fixture = TestBed.createComponent(PlanstrandTaskListComponent);
    fixture.componentRef.setInput('tasks', [a, b]);
    list = fixture.componentInstance;
  });
  afterEach(() => store.resetSelectors());
  it('routes adjacent rows through the owning list and rejects edges, unknown and completed rows', () => {
    const moved = jasmine.createSpy('reordered');
    list.reordered.subscribe(moved);
    list.moveTask(a, -1);
    list.moveTask(b, 1);
    list.moveTask({ ...a, id: 'missing' }, 1);
    list.moveTask({ ...a, isDone: true }, 1);
    expect(moved).not.toHaveBeenCalled();
    list.moveTask(a, 1);
    expect(moved).toHaveBeenCalledOnceWith({ task: a, direction: 1 });
    expect(taskService.move).not.toHaveBeenCalled();
  });
  it('respects canonical domain guards while planning rows use their existing placement order', () => {
    ui.canReorderTask.and.returnValue(false);
    expect(list.canMoveTask(a, 1)).toBeFalse();
    fixture.componentRef.setInput('planning', true);
    expect(list.canMoveTask(a, 1)).toBeTrue();
    fixture.componentRef.setInput('ordering', false);
    expect(list.canMoveTask(a, 1)).toBeFalse();
  });
  it('keeps nested movement among siblings and calls the existing drag reorder service', () => {
    const x = { ...a, id: 'x', parentId: 'a' };
    const y = { ...a, id: 'y', parentId: 'a' };
    list.moveTask(x, -1, true);
    list.moveTask(y, 1, true);
    expect(taskService.move).not.toHaveBeenCalled();
    fixture.componentRef.setInput('tasks', [a, x]);
    list.moveTask(x, 1, true);
    expect(taskService.move).toHaveBeenCalledOnceWith(
      'x',
      'a' as DropListModelSource,
      'a' as DropListModelSource,
      ['y', 'x'],
    );
    list.moveTaskToFolder(x);
    expect(ui.chooseTaskFolder).toHaveBeenCalledOnceWith(x);
  });
});

describe('Task three-dot planning menu', () => {
  let planningStore: MockStore;
  const task = {
    ...DEFAULT_TASK,
    id: 'a',
    title: 'A',
    projectId: 'p',
    subTasks: [],
  } as TaskWithSubTasks;
  let actions: {
    plan: jasmine.Spy;
    chooseDestination: jasmine.Spy;
    schedule: jasmine.Spy;
    planningTarget: () => undefined;
  };
  let closeContext: jasmine.Spy;
  beforeEach(() => {
    actions = {
      plan: jasmine.createSpy('plan'),
      chooseDestination: jasmine.createSpy('chooseDestination'),
      schedule: jasmine.createSpy('schedule'),
      planningTarget: () => undefined,
    };
    closeContext = jasmine.createSpy('closeContext');
    TestBed.configureTestingModule({
      imports: [TaskPlanningMenuComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        { provide: TASK_ROW_MENU_ACTIONS, useValue: actions },
        {
          provide: TaskFocusService,
          useValue: { closeActiveTaskContextMenu: () => closeContext },
        },
      ],
    });
    planningStore = TestBed.inject(MockStore);
    planningStore.overrideSelector(selectAllPlacements, []);
  });
  afterEach(() => planningStore.resetSelectors());
  it('contains planning and scheduling only, closes the context menu and returns focus on Escape', fakeAsync(() => {
    const fixture = TestBed.createComponent(TaskPlanningMenuComponent);
    fixture.componentRef.setInput('task', task);
    fixture.detectChanges();
    const menu = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
    menu.open = true;
    fixture.componentInstance.revealActions(menu);
    tick(20);
    expect(closeContext).toHaveBeenCalled();
    expect(menu.textContent).not.toContain('PLANSTRAND.MOVE_UP');
    expect(menu.textContent).not.toContain('PLANSTRAND.MOVE_DOWN');
    expect(menu.textContent).not.toContain('PLANSTRAND.MOVE_TASK');
    const buttons = Array.from(menu.querySelectorAll('button'));
    buttons.find((b) => b.textContent?.includes('PLANSTRAND.PLAN_TODAY'))!.click();
    expect(actions.plan).toHaveBeenCalledOnceWith(task, 'TODAY');
    expect(menu.open).toBeFalse();
    menu.open = true;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.open).toBeFalse();
    expect(document.activeElement).toBe(menu.querySelector('summary'));
  }));
});
