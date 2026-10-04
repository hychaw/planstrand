import { Action, ActionReducer } from '@ngrx/store';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../project/project.const';
import { Project, ProjectState } from '../project/project.model';
import { initialProjectState, projectReducer } from '../project/store/project.reducer';
import * as ProjectActions from '../project/store/project.actions';
import * as FolderActions from './store/folder.actions';
import { FolderState } from './folder.model';
import { initialFolderState, isFolderState } from './folder-state';
import { folderReducer } from './store/folder.reducer';
import { projectFolderId } from './legacy-project-folder-migration';
import {
  ensureProjectFolderAssociations,
  materializeProjectFolders,
} from './ensure-project-folder-associations';
import { getFolderChildren } from './folder.util';
import { projectFolderSeedMetaReducer } from '../../root-store/meta/project-folder-seed.meta-reducer';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { Operation, ActionType, OpType } from '../../op-log/core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { toLwwUpdateActionType } from '../../op-log/core/lww-update-action-types';
import { projectSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/project-shared.reducer';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';

const p = (id: string, changes: Partial<Project> = {}): Project => ({
  ...DEFAULT_PROJECT,
  id,
  title: id,
  ...changes,
});
const projects = (...items: Project[]): ProjectState =>
  items.reduce(
    (state, project) => projectReducer(state, ProjectActions.addProject({ project })),
    initialProjectState,
  );
const activeDomain = (): FolderState => ({
  ...initialFolderState,
  legacyProjectMigrationComplete: true,
});
const id = projectFolderId('a');
const emptyMenu = { projectTree: [], tagTree: [] };
interface State {
  projects: ProjectState;
  folder: FolderState;
}
const base: ActionReducer<State> = (
  state = { projects: initialProjectState, folder: activeDomain() },
  action,
) => ({
  ...state,
  projects: projectReducer(state.projects, action),
  folder: folderReducer(state.folder, action),
});
const reduce = projectFolderSeedMetaReducer(
  lwwUpdateMetaReducer(base),
) as ActionReducer<State>;
const replay = bulkOperationsMetaReducer(reduce);
const op = (
  action: Action & { meta?: unknown },
  payload: Record<string, unknown>,
  entityType: 'PROJECT' | 'FOLDER' = 'PROJECT',
): Operation => ({
  id: 'op',
  actionType: action.type as ActionType,
  opType: OpType.Update,
  entityType,
  entityId: entityType === 'FOLDER' ? '*' : 'a',
  payload: { actionPayload: payload, entityChanges: [] },
  clientId: 'remote',
  vectorClock: { remote: 1 },
  timestamp: 100,
  schemaVersion: CURRENT_SCHEMA_VERSION,
});

describe('Project Folder seed-only associations', () => {
  it('requires an activated or meaningful domain', () => {
    expect(ensureProjectFolderAssociations(projects(p('a')), initialFolderState)).toBe(
      initialFolderState,
    );
    expect(
      materializeProjectFolders(initialProjectState, emptyMenu)
        .legacyProjectMigrationComplete,
    ).toBeTrue();
  });
  it('seeds only ordinary active Projects, including hidden ones', () => {
    const folder = ensureProjectFolderAssociations(
      projects(
        p('a'),
        p('hidden', { isHiddenFromMenu: true }),
        p('archived', { isArchived: true }),
        p('done', { isDone: true }),
      ),
      activeDomain(),
    );
    expect(folder.ids).toEqual(['INBOX_FOLDER', id, projectFolderId('hidden')]);
    expect(folder.entities[id]).toEqual({
      id,
      title: 'a',
      parentId: null,
      orderKey: 'V',
    });
    expect(projectFolderId(INBOX_PROJECT.id)).toBe('INBOX_FOLDER');
    expect(folder.ids).not.toContain(`PROJECT_FOLDER:${INBOX_PROJECT.id}`);
  });
  it('is deterministic across Project enumeration and idempotent by reference', () => {
    const source = projects(p('z'), p('a'));
    const a = ensureProjectFolderAssociations(source, activeDomain());
    const b = ensureProjectFolderAssociations(
      {
        ...source,
        ids: source.ids.map(String).reverse(),
        entities: {
          a: source.entities['a'],
          z: source.entities['z'],
          [INBOX_PROJECT.id]: INBOX_PROJECT,
        },
      },
      activeDomain(),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(getFolderChildren(a).map((f) => f.id)).toEqual([
      'INBOX_FOLDER',
      id,
      projectFolderId('z'),
    ]);
    expect(ensureProjectFolderAssociations(source, a)).toBe(a);
  });
  it('preserves unrelated manual hierarchy and existing renamed/moved associations', () => {
    let folder = FolderActions.addFolder({
      state: initialFolderState,
      folder: { id: 'manual', title: 'Manual', orderKey: 'z' },
    }).folderState;
    folder = FolderActions.addFolder({
      state: folder,
      folder: { id, title: 'Independent', parentId: 'manual', orderKey: 'F' },
    }).folderState;
    const result = ensureProjectFolderAssociations(projects(p('a'), p('b')), folder);
    expect(result.entities['manual']).toBe(folder.entities['manual']);
    expect(result.entities[id]).toBe(folder.entities[id]);
    expect(result.entities[projectFolderId('b')]?.orderKey).toBe('V');
  });
  it('records dismissal only for accepted association leaf deletion', () => {
    let folder = ensureProjectFolderAssociations(projects(p('a')), activeDomain());
    const removed = FolderActions.removeFolder({ state: folder, id }).folderState;
    expect(removed.dismissedProjectFolderIds).toEqual([id]);
    expect(ensureProjectFolderAssociations(projects(p('a')), removed)).toBe(removed);
    folder = FolderActions.addFolder({
      state: folder,
      folder: { id: 'child', title: 'Child', parentId: id },
    }).folderState;
    expect(FolderActions.removeFolder({ state: folder, id }).folderState).toBe(folder);
    expect(
      FolderActions.removeFolder({ state: folder, id: 'child' }).folderState
        .dismissedProjectFolderIds,
    ).toBeUndefined();
  });
  it('validates optional deletion evidence with a safe absent default', () => {
    expect(isFolderState(activeDomain())).toBeTrue();
    expect(
      isFolderState({ ...activeDomain(), dismissedProjectFolderIds: [id] }),
    ).toBeTrue();
    for (const evidence of [
      null,
      ['manual'],
      [id, id],
      [projectFolderId('z'), id],
      ['PROJECT_FOLDER:'],
    ]) {
      expect(
        isFolderState({ ...activeDomain(), dismissedProjectFolderIds: evidence }),
      ).toBeFalse();
    }
  });
  it('materializes local creation without changing its Project envelope', () => {
    const action = ProjectActions.addProject({ project: p('a') });
    const before = JSON.stringify(action);
    const result = reduce(undefined, action);
    expect(result.folder.entities[id]?.title).toBe('a');
    expect(JSON.stringify(action)).toBe(before);
    expect(action.meta.entityType).toBe('PROJECT');
    expect(reduce(result, action).folder).toBe(result.folder);
  });
  for (const activate of [
    ProjectActions.unarchiveProject,
    ProjectActions.reopenProject,
  ]) {
    it(`seeds on ${activate.type} and never resurrects a dismissed Folder`, () => {
      const state = {
        projects: projects(p('a', { isArchived: true })),
        folder: activeDomain(),
      };
      const active = reduce(state, activate({ id: 'a' }));
      expect(active.folder.entities[id]).toBeDefined();
      const removed = reduce(
        active,
        FolderActions.removeFolder({ state: active.folder, id }),
      );
      const archived = reduce(removed, ProjectActions.archiveProject({ id: 'a' }));
      expect(reduce(archived, activate({ id: 'a' })).folder.entities[id]).toBeUndefined();
    });
  }
  it('seeds direct flag activation, while rename/archive/delete preserve Folder', () => {
    let state = {
      projects: projects(p('a', { isArchived: true })),
      folder: activeDomain(),
    };
    state = reduce(
      state,
      ProjectActions.updateProject({
        project: { id: 'a', changes: { isArchived: false } },
      }),
    );
    const folder = state.folder;
    state = reduce(
      state,
      ProjectActions.updateProject({
        project: { id: 'a', changes: { title: 'Renamed' } },
      }),
    );
    expect(state.folder).toBe(folder);
    state = reduce(state, ProjectActions.archiveProject({ id: 'a' }));
    expect(state.folder).toBe(folder);
    expect(ensureProjectFolderAssociations(initialProjectState, folder)).toBe(folder);
  });
  it('Folder rename/move leave Project and MenuTree unchanged', () => {
    const data = createValidAppData();
    const state = {
      ...data,
      projects: projects(p('a')),
      folder: ensureProjectFolderAssociations(projects(p('a')), activeDomain()),
    };
    const renamed = reduce(
      state,
      FolderActions.updateFolder({
        state: state.folder,
        id,
        changes: { title: 'Folder title' },
      }),
    );
    const moved = reduce(
      { ...state, ...renamed },
      FolderActions.moveFolder({
        state: renamed.folder,
        id,
        parentId: 'INBOX_FOLDER',
        orderKey: 'F',
      }),
    );
    expect(moved.projects).toBe(state.projects);
    expect((moved as typeof state).menuTree).toBe(state.menuTree);
  });
  it('Project deletion preserves the independent hierarchy', () => {
    const project = projects(p('a'));
    const state = {
      ...createValidAppData(),
      projects: project,
      tasks: createValidAppData().task,
      tags: createValidAppData().tag,
      folder: ensureProjectFolderAssociations(project, activeDomain()),
    };
    const remove = projectFolderSeedMetaReducer(
      projectSharedMetaReducer(base),
    ) as ActionReducer<State>;
    const result = remove(
      state,
      TaskSharedActions.deleteProject({ projectId: 'a', allTaskIds: [], noteIds: [] }),
    );
    expect(result.projects.entities['a']).toBeUndefined();
    expect(result.folder).toBe(state.folder);
  });
  it('remote replay and restart produce the same seed without a Folder operation', () => {
    const action = ProjectActions.addProject({ project: p('a') });
    const operation = {
      ...op(action, { project: action.project }),
      opType: OpType.Create,
    };
    const local = reduce(undefined, action);
    const remote = replay(
      undefined,
      bulkApplyOperations({ operations: [operation], localClientId: 'other' }),
    );
    const restarted = replay(
      undefined,
      bulkApplyOperations({ operations: [operation], localClientId: 'remote' }),
    );
    expect(remote).toEqual(local);
    expect(restarted).toEqual(local);
    expect(replay(remote, bulkApplyOperations({ operations: [operation] })).folder).toBe(
      remote.folder,
    );
    expect(operation.payload).toEqual({
      actionPayload: { project: action.project },
      entityChanges: [],
    });
  });
  it('hydrates dismissed evidence and replays deletion through restart', () => {
    const state = reduce(undefined, ProjectActions.addProject({ project: p('a') }));
    const action = FolderActions.removeFolder({ state: state.folder, id });
    const operation = op(action, { folderState: action.folderState }, 'FOLDER');
    const loaded = reduce(
      undefined,
      loadAllData({
        appDataComplete: {
          ...createValidAppData(),
          project: state.projects,
          folder: state.folder,
        },
      }),
    );
    const result = replay(loaded, bulkApplyOperations({ operations: [operation] }));
    expect(result.folder.entities[id]).toBeUndefined();
    expect(
      reduce(
        undefined,
        loadAllData({
          appDataComplete: {
            ...createValidAppData(),
            project: result.projects,
            folder: result.folder,
          },
        }),
      ).folder,
    ).toEqual(result.folder);
  });
  it('reseeds a winning Folder LWW snapshot without dismissal, but honors dismissal', () => {
    const state = reduce(undefined, ProjectActions.addProject({ project: p('a') }));
    for (const dismissed of [false, true]) {
      const folder = {
        ...activeDomain(),
        ...(dismissed ? { dismissedProjectFolderIds: [id] } : {}),
      };
      const result = reduce(state, {
        ...folder,
        type: toLwwUpdateActionType('FOLDER'),
        meta: { entityType: 'FOLDER', entityId: '*', isRemote: true },
      } as Action);
      expect(!!result.folder.entities[id]).toBe(!dismissed);
      expect(ensureProjectFolderAssociations(result.projects, result.folder)).toBe(
        result.folder,
      );
    }
  });
  it('restores old backups through cutover and keeps manual state on current restore', () => {
    const project = projects(p('a'));
    const legacy = materializeProjectFolders(project, emptyMenu);
    expect(legacy.entities[id]?.title).toBe('a');
    const manual = FolderActions.addFolder({
      state: activeDomain(),
      folder: { id: 'manual', title: 'Manual', orderKey: 'F' },
    }).folderState;
    const restored = materializeProjectFolders(project, emptyMenu, manual);
    expect(restored.entities['manual']).toBe(manual.entities['manual']);
    expect(restored.entities[id]?.orderKey).toBe('V');
    expect(materializeProjectFolders(project, emptyMenu, restored)).toBe(restored);
  });
});
