import { computed, inject, Injectable, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { selectFolderFeatureState } from '../../features/folder/store/folder.selectors';
import {
  addFolder,
  moveFolder,
  removeFolder,
  updateFolder,
} from '../../features/folder/store/folder.actions';
import {
  folderOrderBetween,
  getFolderChildren,
  isValidFolderParent,
} from '../../features/folder/folder.util';
import { INBOX_FOLDER_ID } from '../../features/folder/folder.const';
import { selectPlanstrandFolderRows } from './planstrand.selectors';
import { visibleFolderRows } from '../../features/folder/folder-tree';
import { TaskService } from '../../features/tasks/task.service';
import { Task } from '../../features/tasks/task.model';
import { selectTaskEntities } from '../../features/tasks/store/task.selectors';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { DialogPromptComponent } from '../../ui/dialog-prompt/dialog-prompt.component';
import { uuidv7 } from '../../util/uuid-v7';
import { lsGetJSON, lsSetItem } from '../../util/ls-util';
import { FolderPickerComponent } from './folder-picker.component';
import { resolveTaskFolderId } from '../../features/tasks/task-folder-ownership';

const COLLAPSED_KEY = 'PLANSTRAND_COLLAPSED_FOLDERS';

@Injectable({ providedIn: 'root' })
export class PlanstrandService {
  private readonly store = inject(Store);
  private readonly tasks = inject(TaskService);
  private readonly dialog = inject(MatDialog);
  readonly folders = this.store.selectSignal(selectFolderFeatureState);
  readonly rows = this.store.selectSignal(selectPlanstrandFolderRows);
  readonly paths = computed(
    () => new Map(this.rows().map((row) => [row.folder.id, row.path])),
  );
  private readonly entities = this.store.selectSignal(selectTaskEntities);
  readonly collapsed = signal(new Set(lsGetJSON<string[]>(COLLAPSED_KEY, [])));
  readonly visibleRows = computed(() => visibleFolderRows(this.rows(), this.collapsed()));

  toggle(id: string): void {
    const next = new Set(this.collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsed.set(next);
    lsSetItem(COLLAPSED_KEY, JSON.stringify([...next]));
  }

  async prompt(key: string, value = ''): Promise<string | undefined> {
    const result: unknown = await firstValueFrom(
      this.dialog
        .open(DialogPromptComponent, {
          data: { placeholder: `PLANSTRAND.${key}`, txtValue: value },
        })
        .afterClosed(),
    );
    return typeof result === 'string' && result.trim() ? result.trim() : undefined;
  }

  async createFolder(parentId: string | null = null): Promise<void> {
    const title = await this.prompt('CREATE_FOLDER');
    if (!title) return;
    const state = this.folders();
    const siblings = getFolderChildren(state, parentId);
    this.store.dispatch(
      addFolder({
        state,
        folder: {
          id: uuidv7(),
          title,
          parentId,
          orderKey: folderOrderBetween(
            siblings.at(-1)?.orderKey ?? (siblings.length ? 'V' : null),
            null,
          ),
        },
      }),
    );
  }

  async rename(id: string): Promise<void> {
    const title = await this.prompt('RENAME_FOLDER', this.folders().entities[id]?.title);
    if (title)
      this.store.dispatch(
        updateFolder({ state: this.folders(), id, changes: { title } }),
      );
  }

  moveFolder(id: string, parentId: string | null, beforeId?: string): void {
    const state = this.folders();
    if (id === INBOX_FOLDER_ID || !isValidFolderParent(state, id, parentId)) return;
    const siblings = getFolderChildren(state, parentId).filter(
      (f) => f.id !== id && f.id !== INBOX_FOLDER_ID,
    );
    const index = beforeId
      ? siblings.findIndex((f) => f.id === beforeId)
      : siblings.length;
    if (index < 0) return;
    const upper = siblings[index] ? (siblings[index].orderKey ?? 'V') : null;
    let previous = index - 1;
    while (previous >= 0 && (siblings[previous].orderKey ?? 'V') === upper) previous--;
    this.store.dispatch(
      moveFolder({
        state,
        id,
        parentId,
        orderKey: folderOrderBetween(
          previous >= 0 ? (siblings[previous].orderKey ?? 'V') : null,
          upper,
        ),
      }),
    );
  }

  reorder(id: string, direction: -1 | 1): void {
    const folder = this.folders().entities[id];
    if (!folder) return;
    const siblings = getFolderChildren(this.folders(), folder.parentId ?? null).filter(
      (f) => f.id !== INBOX_FOLDER_ID,
    );
    const at = siblings.findIndex((f) => f.id === id);
    if (at + direction < 0 || at + direction >= siblings.length) return;
    this.moveFolder(
      id,
      folder.parentId ?? null,
      siblings[at + (direction < 0 ? -1 : 2)]?.id,
    );
  }

  deleteFolder(id: string): void {
    this.store.dispatch(removeFolder({ state: this.folders(), id }));
  }

  async chooseFolderParent(id: string): Promise<void> {
    const current = this.folders().entities[id];
    if (!current) return;
    const parent: unknown = await firstValueFrom(
      this.dialog
        .open(FolderPickerComponent, {
          data: {
            label: 'PLANSTRAND.MOVE_FOLDER',
            current: current.parentId ?? '',
            allowRoot: true,
            rows: this.rows().filter((row) =>
              isValidFolderParent(this.folders(), id, row.folder.id),
            ),
          },
        })
        .afterClosed(),
    );
    if (typeof parent === 'string') this.moveFolder(id, parent || null);
  }

  async chooseTaskFolder(task: Task): Promise<void> {
    const folderId: unknown = await firstValueFrom(
      this.dialog
        .open(FolderPickerComponent, {
          data: {
            label: 'PLANSTRAND.MOVE_TASK',
            current: resolveTaskFolderId(task, this.folders()),
            allowRoot: false,
            rows: this.rows(),
          },
        })
        .afterClosed(),
    );
    if (typeof folderId === 'string') this.moveTask(task, folderId);
  }

  async createTask(folderId: string, capturedTitle?: string): Promise<void> {
    const title =
      capturedTitle === undefined ? await this.prompt('ADD_TASK') : capturedTitle.trim();
    if (!title || !this.folders().entities[folderId]) return;
    const task = this.tasks.createNewTaskWithDefaults({
      title,
      workContextId: INBOX_PROJECT.id,
      workContextType: WorkContextType.PROJECT,
      additional: { folderId },
    });
    this.store.dispatch(
      TaskSharedActions.addTask({
        task,
        workContextId: INBOX_PROJECT.id,
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: true,
      }),
    );
  }

  moveTask(task: Task, folderId: string): void {
    if (!this.folders().entities[folderId]) return;
    const seen = new Set<string>();
    let root = this.entities()[task.id];
    while (root?.parentId && !seen.has(root.id)) {
      seen.add(root.id);
      root = this.entities()[root.parentId];
    }
    if (root && root.folderId !== folderId) this.tasks.update(root.id, { folderId });
  }
}
