import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { shortSyntaxSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/short-syntax-shared.reducer';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { taskBatchUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/task-batch-update.reducer';
import { materializeProjectFolders } from '../folder/ensure-project-folder-associations';
import { Action, ActionReducer } from '@ngrx/store';
import { DEFAULT_TASK, Task, TaskState } from './task.model';
import { initialTaskState, taskReducer } from './store/task.reducer';
import { taskAdapter } from './store/task.adapter';
import { initialProjectState, projectReducer } from '../project/store/project.reducer';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../project/project.const';
import { initialFolderState } from '../folder/folder-state';
import { folderReducer } from '../folder/store/folder.reducer';
import * as FolderActions from '../folder/store/folder.actions';
import * as ProjectActions from '../project/store/project.actions';
import { FolderState } from '../folder/folder.model';
import { INBOX_FOLDER_ID } from '../folder/folder.const';
import { projectFolderId } from '../folder/legacy-project-folder-migration';
import {
  materializeTaskFolders,
  resolveTaskFolderId,
  taskFolderIdForProject,
} from './task-folder-ownership';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { createCombinedTaskSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/test-helpers';
import { projectFolderSeedMetaReducer } from '../../root-store/meta/project-folder-seed.meta-reducer';
import {
  prepareTaskFolderAction,
  taskFolderOwnershipMetaReducer,
} from '../../root-store/meta/task-folder-ownership.meta-reducer';
import {
  createValidAppData,
  appDataToRootState,
  rootStateToAppData,
} from '../../op-log/validation/state-validity-test-utils';
import { RootState } from '../../root-store/root-state';
import { addSubTask, moveSubTask } from './store/task.actions';
import { WorkContextType } from '../work-context/work-context.model';
import { appDataValidators } from '../../op-log/validation/validation-fn';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { Operation, ActionType } from '../../op-log/core/operation.types';
import { CURRENT_SCHEMA_VERSION, TASK_FOLDER_OWNERSHIP_V1 } from '@sp/shared-schema';
import { selectTasksInFolder } from './store/task.selectors';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  ...DEFAULT_TASK,
  id,
  title: id,
  projectId: 'p',
  ...extra,
});
const folders: FolderState = {
  ...initialFolderState,
  legacyProjectMigrationComplete: true,
  ids: [INBOX_FOLDER_ID, projectFolderId('p'), 'manual'],
  entities: {
    ...initialFolderState.entities,
    [projectFolderId('p')]: { id: projectFolderId('p'), title: 'P' },
    manual: { id: 'manual', title: 'Manual' },
  },
};
const projects = {
  ...initialProjectState,
  ids: [...initialProjectState.ids.map(String), 'p'],
  entities: {
    ...initialProjectState.entities,
    p: { ...DEFAULT_PROJECT, id: 'p', title: 'P' },
  },
};
const tasks = (...entries: Task[]): TaskState =>
  taskAdapter.addMany(entries, initialTaskState);
const state = (...entries: Task[]): RootState => ({
  ...appDataToRootState(
    createValidAppData({
      task: tasks(...entries),
      project: projects,
      folder: folders,
    }),
  ),
  folder: folders,
});
const base: ActionReducer<RootState> = (s = state(), a) => ({
  ...s,
  tasks: taskReducer(s.tasks, a),
  projects: projectReducer(s.projects, a),
  folder: folderReducer(s.folder, a),
});
const reduce = taskFolderOwnershipMetaReducer(
  projectFolderSeedMetaReducer(
    createCombinedTaskSharedMetaReducer(
      taskBatchUpdateMetaReducer(shortSyntaxSharedMetaReducer(base)),
    ),
  ),
) as ActionReducer<RootState>;
const local = (s: RootState, a: Action): RootState =>
  reduce(s, prepareTaskFolderAction(s, a));
const add = (entry: Task): ReturnType<typeof TaskSharedActions.addTask> =>
  TaskSharedActions.addTask({
    task: entry,
    workContextId: entry.projectId,
    workContextType: WorkContextType.PROJECT,
    isAddToBacklog: false,
    isAddToBottom: false,
  });

describe('canonical Task Folder ownership', () => {
  it('persists Project creation, canonical Task ownership and deletion fallback across fresh IndexedDB readers', async () => {
    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: {
            loadClientId: async () => 'ownership-smoke',
            getOrGenerateClientId: async () => 'ownership-smoke',
            clearCache: () => {},
          },
        },
      ],
    });
    const db = TestBed.inject(OperationLogStoreService);
    await db.init();
    await db._clearAllDataForTesting();
    const data = createValidAppData({
      project: initialProjectState,
      task: initialTaskState,
    });
    const folder = materializeProjectFolders(
      data.project,
      data.menuTree,
      initialFolderState,
    );
    let current: RootState = { ...appDataToRootState(data), folder };
    expect(current.folder?.entities[INBOX_FOLDER_ID]).toBeDefined();
    current = local(
      current,
      ProjectActions.addProject({
        project: { ...DEFAULT_PROJECT, id: 'smoke-project', title: 'Smoke' },
      }),
    );
    const owner = projectFolderId('smoke-project');
    expect(current.folder?.entities[owner]?.title).toBe('Smoke');
    current = local(current, add(task('smoke-task', { projectId: 'smoke-project' })));
    expect(current.tasks.entities['smoke-task']?.folderId).toBe(owner);
    const persist = async (value: RootState): Promise<void> => {
      await db.saveStateCache({
        state: { ...rootStateToAppData(value), folder: value.folder },
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: 1,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
    };
    const restart = async (): Promise<RootState> => {
      const fresh = TestBed.runInInjectionContext(() => new OperationLogStoreService());
      const restored = (await fresh.loadStateCache())!.state as ReturnType<
        typeof createValidAppData
      >;
      const restoredFolder = materializeProjectFolders(
        restored.project,
        restored.menuTree,
        restored.folder,
      );
      const restoredTasks = materializeTaskFolders(
        restored.task,
        restored.project,
        restoredFolder,
      );
      return {
        ...appDataToRootState({ ...restored, task: restoredTasks }),
        folder: restoredFolder,
      };
    };
    await persist(current);
    current = await restart();
    expect(current.folder?.entities[owner]).toBeDefined();
    expect(current.tasks.entities['smoke-task']?.folderId).toBe(owner);
    const beforeDelete = current.tasks;
    current = local(
      current,
      FolderActions.removeFolder({ state: current.folder!, id: owner }),
    );
    expect(current.tasks).toBe(beforeDelete);
    expect(current.tasks.entities['smoke-task']?.folderId).toBe(owner);
    expect(
      resolveTaskFolderId(current.tasks.entities['smoke-task']!, current.folder!),
    ).toBe(INBOX_FOLDER_ID);
    await persist(current);
    current = await restart();
    expect(current.folder?.entities[owner]).toBeUndefined();
    expect(current.folder?.dismissedProjectFolderIds).toContain(owner);
    expect(current.tasks.entities['smoke-task']?.folderId).toBe(owner);
    expect(
      resolveTaskFolderId(current.tasks.entities['smoke-task']!, current.folder!),
    ).toBe(INBOX_FOLDER_ID);
    await persist(current);
    expect(await restart()).toEqual(current);
    expect(await db.getLastSeq()).toBe(0);
  });
  for (const [name, projectId, expected] of [
    ['Inbox', INBOX_PROJECT.id, INBOX_FOLDER_ID],
    ['ordinary Project', 'p', projectFolderId('p')],
    ['missing Project', 'missing', INBOX_FOLDER_ID],
    ['malformed Project', '', INBOX_FOLDER_ID],
  ]) {
    it(`materializes a legacy ${name} Task`, () => {
      expect(
        materializeTaskFolders(tasks(task('t', { projectId })), projects, folders)
          .entities.t?.folderId,
      ).toBe(expected);
    });
  }
  it('uses Inbox for missing or dismissed associations', () => {
    const removed = FolderActions.removeFolder({
      state: folders,
      id: projectFolderId('p'),
    }).folderState;
    expect(taskFolderIdForProject('p', projects, removed)).toBe(INBOX_FOLDER_ID);
    expect(
      taskFolderIdForProject('p', projects, {
        ...folders,
        dismissedProjectFolderIds: [projectFolderId('p')],
      }),
    ).toBe(INBOX_FOLDER_ID);
  });
  it('preserves valid explicit ownership over Project compatibility', () => {
    const input = tasks(task('t', { folderId: 'manual' }));
    expect(materializeTaskFolders(input, projects, folders)).toBe(input);
  });
  it('is idempotent and survives JSON restart/restore', () => {
    const result = materializeTaskFolders(tasks(task('t')), projects, folders);
    expect(materializeTaskFolders(result, projects, folders)).toBe(result);
    const restored = JSON.parse(JSON.stringify(result)) as TaskState;
    expect(materializeTaskFolders(restored, projects, folders)).toBe(restored);
    expect(restored.entities.t?.folderId).toBe(projectFolderId('p'));
  });
  it('inherits deep legacy parent chains iteratively regardless of enumeration order', () => {
    const entries = Array.from({ length: 12000 }, (_, i) =>
      task(String(i), {
        parentId: i ? String(i - 1) : undefined,
        projectId: i ? 'missing' : 'p',
      }),
    ).reverse();
    const result = materializeTaskFolders(tasks(...entries), projects, folders);
    expect(result.entities['11999']?.folderId).toBe(projectFolderId('p'));
  });
  it('resolves missing parents and cycles deterministically to Inbox', () => {
    const result = materializeTaskFolders(
      tasks(
        task('a', { parentId: 'b' }),
        task('b', { parentId: 'a' }),
        task('orphan', { parentId: 'missing' }),
      ),
      projects,
      folders,
    );
    expect(result.ids.map((id) => result.entities[id]?.folderId)).toEqual([
      INBOX_FOLDER_ID,
      INBOX_FOLDER_ID,
      INBOX_FOLDER_ID,
    ]);
  });
  for (const projectId of [INBOX_PROJECT.id, 'p']) {
    it(`puts ownership directly in a new ${projectId} Task payload`, () => {
      const original = add(task('new', { projectId }));
      const prepared = prepareTaskFolderAction(state(), original);
      const expected = projectId === 'p' ? projectFolderId('p') : INBOX_FOLDER_ID;
      expect(prepared.task.folderId).toBe(expected);
      expect(original.task.folderId).toBeUndefined();
      expect(reduce(state(), prepared).tasks.entities.new?.folderId).toBe(expected);
    });
  }
  it('creates Tasks in Inbox after their Project association was dismissed', () => {
    const s = reduce(
      state(),
      FolderActions.removeFolder({ state: folders, id: projectFolderId('p') }),
    );
    expect(local(s, add(task('new'))).tasks.entities.new?.folderId).toBe(INBOX_FOLDER_ID);
  });
  it('bridges a Project move and preserves the Task id and operation intent', () => {
    const s = state(task('t', { folderId: 'manual' }));
    const action = TaskSharedActions.moveToOtherProject({
      task: { ...s.tasks.entities.t!, subTasks: [] },
      targetProjectId: INBOX_PROJECT.id,
    });
    const prepared = prepareTaskFolderAction(s, action);
    const result = reduce(s, prepared);
    expect(result.tasks.entities.t).toEqual(
      jasmine.objectContaining({
        projectId: INBOX_PROJECT.id,
        folderId: INBOX_FOLDER_ID,
      }),
    );
    expect(prepared.type).toBe(action.type);
    expect(prepared.meta).toBe(action.meta);
  });
  it('bridges explicit generic Project updates used by compatibility callers', () => {
    const result = local(
      state(task('t', { folderId: 'manual' })),
      TaskSharedActions.updateTask({
        task: { id: 't', changes: { projectId: INBOX_PROJECT.id } },
      }),
    );
    expect(result.tasks.entities.t?.folderId).toBe(INBOX_FOLDER_ID);
  });
  it('bridges an atomic short-syntax Project move in its existing Task operation', () => {
    const s = state(task('t', { folderId: 'manual' }));
    const original = TaskSharedActions.applyShortSyntax({
      task: s.tasks.entities.t!,
      taskChanges: { title: 'Moved' },
      targetProjectId: INBOX_PROJECT.id,
    });
    const prepared = prepareTaskFolderAction(s, original);
    const result = reduce(s, prepared);
    expect(result.tasks.entities.t).toEqual(
      jasmine.objectContaining({
        projectId: INBOX_PROJECT.id,
        folderId: INBOX_FOLDER_ID,
        title: 'Moved',
      }),
    );
    expect(prepared.type).toBe(original.type);
    expect(prepared.meta).toBe(original.meta);
  });
  it('does not change ownership when an invalid generic Project move is rejected', () => {
    const result = local(
      state(task('t', { folderId: 'manual' })),
      TaskSharedActions.updateTask({
        task: { id: 't', changes: { projectId: 'missing' } },
      }),
    );
    expect(result.tasks.entities.t?.projectId).toBe('p');
    expect(result.tasks.entities.t?.folderId).toBe('manual');
  });
  it('creates plugin batch Tasks with ownership directly in the central batch payload', () => {
    const original = TaskSharedActions.batchUpdateForProject({
      projectId: 'p',
      createdTaskTimestamp: 1,
      createdTaskIds: { new: 'new' },
      operations: [{ type: 'create', tempId: 'new', data: { title: 'New' } }],
    });
    const prepared = prepareTaskFolderAction(state(), original);
    expect(prepared.folderId).toBe(projectFolderId('p'));
    expect(reduce(state(), prepared).tasks.entities.new?.folderId).toBe(
      projectFolderId('p'),
    );
  });
  it('Folder deletion changes effective placement without rewriting Task state', () => {
    const s = state(task('t', { folderId: projectFolderId('p') }));
    const result = reduce(
      s,
      FolderActions.removeFolder({ state: folders, id: projectFolderId('p') }),
    );
    expect(result.tasks).toBe(s.tasks);
    expect(result.folder?.entities[projectFolderId('p')]).toBeUndefined();
    expect(resolveTaskFolderId(result.tasks.entities.t!, result.folder!)).toBe(
      INBOX_FOLDER_ID,
    );
    expect(
      selectTasksInFolder(INBOX_FOLDER_ID).projector(result.tasks, result.folder!),
    ).toEqual([s.tasks.entities.t!]);
  });
  it('does not remap a persisted stale Folder through the Project', () => {
    const input = tasks(task('t', { folderId: 'deleted' }));
    expect(materializeTaskFolders(input, projects, folders)).toBe(input);
    expect(resolveTaskFolderId(input.entities.t!, folders)).toBe(INBOX_FOLDER_ID);
  });
  it('Project rename/archive/delete do not rewrite canonical ownership', () => {
    let s = state(task('t', { folderId: 'manual' }));
    for (const action of [
      ProjectActions.updateProject({
        project: { id: 'p', changes: { title: 'Renamed' } },
      }),
      ProjectActions.archiveProject({ id: 'p' }),
      TaskSharedActions.deleteProject({ projectId: 'p', noteIds: [], allTaskIds: [] }),
    ]) {
      const before = s.tasks.entities.t;
      s = reduce(s, action);
      expect(s.tasks.entities.t?.folderId).toBe(before?.folderId);
    }
  });
  it('Folder rename/move leave Project compatibility untouched', () => {
    let s = state(task('t', { folderId: projectFolderId('p') }));
    for (const action of [
      FolderActions.updateFolder({
        state: folders,
        id: projectFolderId('p'),
        changes: { title: 'Renamed' },
      }),
      FolderActions.moveFolder({
        state: folders,
        id: projectFolderId('p'),
        parentId: 'manual',
        orderKey: 'V',
      }),
    ]) {
      const before = s.tasks;
      s = reduce(s, action);
      expect(s.tasks).toBe(before);
      expect(s.tasks.entities.t?.projectId).toBe('p');
    }
  });
  it('adds subtasks with their parent owner, overriding independent placement', () => {
    const s = state(task('parent', { folderId: 'manual' }));
    const result = local(
      s,
      addSubTask({
        parentId: 'parent',
        task: task('child', { folderId: projectFolderId('p') }),
      }),
    );
    expect(result.tasks.entities.child?.folderId).toBe('manual');
  });
  it('moves a subtask between parents with effective ownership inheritance', () => {
    const s = state(
      task('a', { folderId: 'manual', subTaskIds: ['child'] }),
      task('b', { folderId: INBOX_FOLDER_ID }),
      task('child', { parentId: 'a', folderId: 'manual' }),
    );
    const result = local(
      s,
      moveSubTask({
        taskId: 'child',
        srcTaskId: 'a',
        targetTaskId: 'b',
        afterTaskId: null,
      }),
    );
    expect(result.tasks.entities.child).toEqual(
      jasmine.objectContaining({ parentId: 'b', folderId: INBOX_FOLDER_ID }),
    );
  });
  it('converts to a subtask and back while preserving the canonical owner', () => {
    let s = state(
      task('parent', { folderId: 'manual' }),
      task('child', { folderId: projectFolderId('p') }),
    );
    s = local(
      s,
      TaskSharedActions.convertToSubTask({
        taskId: 'child',
        targetParentId: 'parent',
        afterTaskId: null,
      }),
    );
    expect(s.tasks.entities.child?.folderId).toBe('manual');
    s = local(s, TaskSharedActions.convertToMainTask({ task: s.tasks.entities.child! }));
    expect(s.tasks.entities.child?.parentId).toBeUndefined();
    expect(s.tasks.entities.child?.folderId).toBe('manual');
  });
  it('moves parent and all descendants together', () => {
    const s = state(
      task('a', { folderId: 'manual', subTaskIds: ['b'] }),
      task('b', { parentId: 'a', folderId: 'manual', subTaskIds: ['c'] }),
      task('c', { parentId: 'b', folderId: 'manual' }),
    );
    const result = local(
      s,
      TaskSharedActions.moveToOtherProject({
        task: { ...s.tasks.entities.a!, subTasks: [s.tasks.entities.b!] },
        targetProjectId: INBOX_PROJECT.id,
      }),
    );
    expect(result.tasks.ids.map((id) => result.tasks.entities[id]?.folderId)).toEqual([
      INBOX_FOLDER_ID,
      INBOX_FOLDER_ID,
      INBOX_FOLDER_ID,
    ]);
  });
  it('preserves ownership in archive/restore payloads and resolves legacy restores', () => {
    const archived = task('t', { folderId: 'manual' });
    const archiveAction = TaskSharedActions.moveToArchive({
      tasks: [{ ...archived, subTasks: [] }],
    });
    const removed = local(state(archived), archiveAction);
    expect(archiveAction.tasks[0].folderId).toBe('manual');
    expect(removed.tasks.entities.t).toBeUndefined();
    expect(
      local(removed, TaskSharedActions.restoreTask({ task: archived, subTasks: [] }))
        .tasks.entities.t?.folderId,
    ).toBe('manual');
    expect(
      local(
        state(),
        TaskSharedActions.restoreTask({ task: task('legacy'), subTasks: [] }),
      ).tasks.entities.legacy?.folderId,
    ).toBe(projectFolderId('p'));
  });
  it('materializes legacy replay without recapture and preserves current explicit replay', () => {
    const replay = bulkOperationsMetaReducer(reduce);
    const operations = [
      add(task('legacy')),
      add(task('current', { folderId: 'manual' })),
    ].map((action, i): Operation => {
      const { type, meta, ...payload } = action;
      return {
        id: String(i),
        actionType: type as ActionType,
        opType: meta.opType,
        entityType: 'TASK',
        entityId: action.task.id,
        clientId: 'remote',
        vectorClock: { remote: i + 1 },
        timestamp: i,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        payload: { actionPayload: payload, entityChanges: [] },
        ...(i ? { requiredCapabilities: [TASK_FOLDER_OWNERSHIP_V1] } : {}),
      };
    });
    const result = replay(state(), bulkApplyOperations({ operations }));
    expect(result.tasks.entities.legacy?.folderId).toBe(projectFolderId('p'));
    expect(result.tasks.entities.current?.folderId).toBe('manual');
    expect(
      (operations[0].payload as { actionPayload: { task: Task } }).actionPayload.task
        .folderId,
    ).toBeUndefined();
  });
  it('waits for a later Project create in the startup tail before materializing legacy Tasks', () => {
    const s = state(task('legacy', { projectId: 'later' }));
    const action = ProjectActions.addProject({
      project: { ...DEFAULT_PROJECT, id: 'later', title: 'Later' },
    });
    const { type, meta, ...payload } = action;
    const operation: Operation = {
      id: 'late-project',
      actionType: type as ActionType,
      opType: meta.opType,
      entityType: 'PROJECT',
      entityId: 'later',
      clientId: 'remote',
      vectorClock: { remote: 1 },
      timestamp: 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      payload: { actionPayload: payload, entityChanges: [] },
    };
    const replay = bulkOperationsMetaReducer(reduce);
    const hydrated = reduce(
      state(),
      loadAllData({
        appDataComplete: createValidAppData({
          task: s.tasks,
          project: s.projects,
          folder: s.folder,
        }),
      }),
    );
    expect(hydrated.tasks.entities.legacy?.folderId).toBeUndefined();
    const replayed = replay(
      hydrated,
      bulkApplyOperations({
        operations: [operation],
        deferTaskFolderMaterialization: true,
      }),
    );
    expect(replayed.tasks.entities.legacy?.folderId).toBeUndefined();
    const folderState = materializeProjectFolders(
      replayed.projects,
      replayed.menuTree,
      replayed.folder,
    );
    const final = reduce(
      replayed,
      FolderActions.installLegacyFolderMigration({ folderState }),
    );
    expect(final.tasks.entities.legacy?.folderId).toBe(projectFolderId('later'));
  });
  it('does not rewrite even an unmaterialized legacy Task when a Folder is deleted', () => {
    const s = state(task('legacy'));
    const result = reduce(
      s,
      FolderActions.removeFolder({ state: folders, id: projectFolderId('p') }),
    );
    expect(result.tasks).toBe(s.tasks);
    expect(result.tasks.entities.legacy?.folderId).toBeUndefined();
    const action = FolderActions.removeFolder({
      state: folders,
      id: projectFolderId('p'),
    });
    const { type, meta, ...payload } = action;
    const operation: Operation = {
      id: 'delete-folder',
      actionType: type as ActionType,
      opType: meta.opType,
      entityType: 'FOLDER',
      entityId: '*',
      clientId: 'remote',
      vectorClock: { remote: 1 },
      timestamp: 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      payload: { actionPayload: payload, entityChanges: [] },
    };
    const replayed = bulkOperationsMetaReducer(reduce)(
      s,
      bulkApplyOperations({ operations: [operation] }),
    );
    expect(replayed.tasks).toBe(s.tasks);

    expect(resolveTaskFolderId(result.tasks.entities.legacy!, result.folder!)).toBe(
      INBOX_FOLDER_ID,
    );
  });
  it('accepts legacy and stale string fields but rejects malformed non-string fields', () => {
    expect(appDataValidators.task(tasks(task('legacy'))).success).toBeTrue();
    expect(
      appDataValidators.task(tasks(task('stale', { folderId: 'deleted' }))).success,
    ).toBeTrue();
    expect(
      appDataValidators.task(tasks({ ...task('bad'), folderId: 42 } as unknown as Task))
        .success,
    ).toBeFalse();
  });
});
