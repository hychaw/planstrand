import { Action, ActionReducer } from '@ngrx/store';
import { ProjectState } from '../../features/project/project.model';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { FolderState } from '../../features/folder/folder.model';
import { ensureProjectFolderAssociations } from '../../features/folder/ensure-project-folder-associations';
import * as ProjectActions from '../../features/project/store/project.actions';
import * as FolderActions from '../../features/folder/store/folder.actions';
import { loadAllData } from './load-all-data.action';
import { toLwwUpdateActionType } from '../../op-log/core/lww-update-action-types';

interface AssociationState {
  [PROJECT_FEATURE_NAME]?: ProjectState;
  folder?: FolderState;
}

const replacementTypes = new Set<string>([
  loadAllData.type,
  FolderActions.installLegacyFolderMigration.type,
  FolderActions.addFolder.type,
  FolderActions.updateFolder.type,
  FolderActions.moveFolder.type,
  FolderActions.removeFolder.type,
  toLwwUpdateActionType('FOLDER'),
]);
const projectTypes = new Set<string>([
  ProjectActions.addProject.type,
  ProjectActions.unarchiveProject.type,
  ProjectActions.reopenProject.type,
  ProjectActions.updateProject.type,
  toLwwUpdateActionType('PROJECT'),
]);

/** Runs inside bulk replay, after the ordinary reducers. The original Project
 * action/envelope is unchanged: no dispatch, metadata mutation or Folder op.
 */
export const projectFolderSeedMetaReducer =
  <S extends AssociationState>(reducer: ActionReducer<S>): ActionReducer<S> =>
  (state: S | undefined, action: Action): S => {
    const next = reducer(state, action);
    const project = next[PROJECT_FEATURE_NAME];
    if (!project || !next.folder) return next;
    if (!replacementTypes.has(action.type)) {
      if (!projectTypes.has(action.type)) return next;
      // A rename/archive of an already active Project does not seed anything.
      const becameActive = project.ids.some((id) => {
        const p = project.entities[id];
        const previous = state?.[PROJECT_FEATURE_NAME]?.entities[id];
        return (
          p &&
          !p.isArchived &&
          !p.isDone &&
          (!previous || previous.isArchived || previous.isDone)
        );
      });
      if (!becameActive) return next;
    }
    const folder = ensureProjectFolderAssociations(project, next.folder);
    return folder === next.folder ? next : { ...next, folder };
  };
