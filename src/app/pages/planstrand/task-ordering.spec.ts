import { Action } from '@ngrx/store';
import { EffectRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../features/tasks/task.service';
import { PlanstrandService } from './planstrand.service';
import { PlanstrandPageComponent } from './planstrand-page.component';
import { selectCanonicalTasks, selectMasterTaskGroups } from './planstrand.selectors';
import { createStateWithExistingTasks } from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import { initialFolderState } from '../../features/folder/folder-state';
import { INBOX_FOLDER_ID } from '../../features/folder/folder.const';
import {
  initialPlanningState,
  planningReducer,
} from '../../features/planning/store/planning.reducer';
import { configurePlanningWrites } from '../../features/planning/planning-commands';
import { projectReducer } from '../../features/project/store/project.reducer';
import { DEFAULT_TASK, TaskWithSubTasks } from '../../features/tasks/task.model';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

describe('Planstrand canonical Task ordering', () => {
  const task = (id: string): TaskWithSubTasks => ({
    ...DEFAULT_TASK,
    id,
    title: id,
    projectId: 'project1',
    deadlineDay: '2027-02-01',
    folderId: INBOX_FOLDER_ID,
    subTasks: [],
  });
  let state: ReturnType<typeof createStateWithExistingTasks>;
  let ui: PlanstrandService;
  let store: MockStore;
  beforeEach(() => {
    state = createStateWithExistingTasks(['a', 'b', 'c'], ['backlog'], [], []);
    state.folder = initialFolderState;
    state.planning = initialPlanningState;
    for (const id of ['a', 'b', 'c', 'backlog']) state.tasks.entities[id] = task(id);
    state.tasks.entities['child'] = { ...task('child'), parentId: 'b' };
    state.tasks.entities['b'] = { ...state.tasks.entities['b']!, subTaskIds: ['child'] };
    state.tasks.ids = ['c', 'b', 'a', 'backlog', 'child'];
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({ initialState: state }),
        { provide: TaskService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({ planstrand: 'today' }),
            paramMap: of(convertToParamMap({})),
          },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    ui = TestBed.inject(PlanstrandService);
    configurePlanningWrites({ getOrGenerateClientId: async () => 'ordering-test' });
    spyOn(store, 'dispatch').and.callFake(
      (action: Action | (() => Action)): EffectRef => {
        if (typeof action === 'function') throw new Error('Unexpected dispatch function');
        state = {
          ...state,
          projects: projectReducer(state.projects, action),
          planning: planningReducer(state.planning, action),
        };
        store.setState(state);
        return undefined as unknown as EffectRef;
      },
    );
  });
  const ids = (tasks: TaskWithSubTasks[]): string[] => tasks.map((t) => t.id);
  it('reads canonical regular/backlog order rather than entity enumeration', () => {
    expect(ids(selectCanonicalTasks(state))).toEqual(['a', 'b', 'c', 'backlog']);
    expect(selectCanonicalTasks(state)[1].subTasks[0].id).toBe('child');
  });
  for (const [id, index, expected] of [
    ['b', 0, ['b', 'a', 'c', 'backlog']],
    ['b', 2, ['a', 'c', 'b', 'backlog']],
    ['c', 0, ['c', 'a', 'b', 'backlog']],
  ] as const) {
    it(`persists ${id} at ${index} without changing Task/Planning data`, () => {
      const beforeTasks = JSON.stringify(state.tasks);
      const beforePlanning = JSON.stringify(state.planning);
      ui.reorderTask(task(id), index, selectCanonicalTasks(state));
      const restored = JSON.parse(JSON.stringify(state));
      expect(ids(selectCanonicalTasks(restored))).toEqual([...expected]);
      expect(JSON.stringify(state.tasks)).toBe(beforeTasks);
      expect(JSON.stringify(state.planning)).toBe(beforePlanning);
      expect(store.dispatch).toHaveBeenCalledTimes(1);
    });
  }
  it('rejects boundaries, unknown Tasks, subtasks and cross-backlog moves', () => {
    const tasks = selectCanonicalTasks(state);
    ui.reorderTask(task('a'), -1, tasks);
    ui.reorderTask(task('a'), 0, tasks);
    ui.reorderTask(task('c'), 4, tasks);
    ui.reorderTask(task('c'), 3, tasks);
    ui.reorderTask({ ...task('b'), parentId: 'a' }, 0, tasks);
    ui.reorderTask(task('missing'), 0, tasks);
    expect(store.dispatch).not.toHaveBeenCalled();
  });
  it('same-Inbox drop and Unplanned adjacent controls use the same persisted order', () => {
    const page = TestBed.runInInjectionContext(() => new PlanstrandPageComponent());
    page.moveTask({ task: task('c'), index: 0 }, INBOX_FOLDER_ID);
    expect(ids(selectMasterTaskGroups(state).get(INBOX_FOLDER_ID)!)).toEqual([
      'c',
      'a',
      'b',
      'backlog',
    ]);
    page.reorderUnderlying({ task: task('c'), direction: 1 }, page.captureTasks());
    expect(ids(page.captureTasks())).toEqual(['a', 'c', 'b', 'backlog']);
    page.unplannedDrop({ task: task('b'), index: 0 });
    expect(ids(page.captureTasks())).toEqual(['b', 'a', 'c', 'backlog']);
    expect(state.planning).toBe(initialPlanningState);
  });
  it('keeps hidden Tasks in the canonical list while reordering visible peers', () => {
    ui.reorderTask(task('c'), 0, [task('a'), task('c')]);
    expect(state.projects.entities['project1']!.taskIds).toEqual(['c', 'a', 'b']);
  });
  it('rejects canonical moves across Folder ownership boundaries', () => {
    state.folder = {
      ...initialFolderState,
      ids: [...initialFolderState.ids, 'other'],
      entities: {
        ...initialFolderState.entities,
        other: { id: 'other', title: 'Other', orderKey: 'V' },
      },
    };
    state.tasks.entities['b'] = { ...state.tasks.entities['b']!, folderId: 'other' };
    store.setState(state);
    const tasks = selectCanonicalTasks(state);
    expect(ui.canReorderTask(tasks[0], tasks[1])).toBeFalse();
    ui.reorderTask(tasks[0], 1, tasks);
    expect(store.dispatch).not.toHaveBeenCalled();
  });
  it('reorders Focus adjacent visible peers around completed placements without changing destination', async () => {
    const page = TestBed.runInInjectionContext(() => new PlanstrandPageComponent());
    const target = { type: 'DAY' as const, key: page.today() };
    state = {
      ...state,
      tasks: {
        ...state.tasks,
        entities: {
          ...state.tasks.entities,
          a: { ...state.tasks.entities['a']!, isDone: true },
        },
      },
      planning: {
        ids: ['a', 'b', 'c'],
        entities: Object.fromEntries(
          ['a', 'b', 'c'].map((id, i) => [
            id,
            {
              id,
              placement: { target, orderKey: ['F', 'V', 'z'][i] },
              revision: { counter: 1, clientId: 'test', opId: id },
            },
          ]),
        ),
      },
    };
    store.setState(state);
    const before = JSON.stringify(state.tasks);
    page.reorder({ task: task('c'), direction: -1 }, page.focusTasks(), target);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(ids(page.focusTasks())).toEqual(['c', 'b']);
    expect(page.completedTasks().map((t) => t.id)).toEqual(['a']);
    expect(state.planning!.entities['c']!.placement!.target).toEqual(target);
    expect(JSON.stringify(state.tasks)).toBe(before);
    expect(state.projects.entities['project1']!.taskIds).toEqual(['a', 'b', 'c']);
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    page.reorder({ task: task('c'), direction: -1 }, page.focusTasks(), target);
    expect(store.dispatch).toHaveBeenCalledTimes(1);
  });
});
