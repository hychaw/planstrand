import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  forwardRef,
} from '@angular/core';
import {
  CdkDrag,
  CdkDragHandle,
  CdkDropList,
  CdkDragDrop,
  CdkDragStart,
} from '@angular/cdk/drag-drop';
import { ScheduleExternalDragService } from '../../features/schedule/schedule-week/schedule-external-drag.service';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TaskComponent } from '../../features/tasks/task/task.component';
import {
  DropListModelSource,
  Task,
  TaskWithSubTasks,
} from '../../features/tasks/task.model';
import { TaskService } from '../../features/tasks/task.service';
import { TASK_ROW_MENU_ACTIONS } from '../../features/tasks/task-row-menu-actions';
import { selectTaskEntities } from '../../features/tasks/store/task.selectors';
import { DialogScheduleTaskComponent } from '../../features/planner/dialog-schedule-task/dialog-schedule-task.component';
import { planningCommands } from '../../features/planning/planning-commands';
import { PlanstrandService } from './planstrand.service';
import { CurrentDateService } from '../../core/date/current-date.service';
import { resolveTaskFolderId } from '../../features/tasks/task-folder-ownership';
import { TaskPlanningMenuComponent } from '../../features/tasks/task-planning-menu.component';
import { PlanningDestinationDialogComponent } from './planning-destination-dialog.component';
import { selectAllPlacements } from '../../features/planning/store/planning.selectors';
import { PlanningPlacement } from '../../features/planning/planning.model';
import { calendarAddDays } from '../../util/calendar-date';

@Component({
  selector: 'planstrand-task-list',
  providers: [
    {
      provide: TASK_ROW_MENU_ACTIONS,
      useExisting: forwardRef(() => PlanstrandTaskListComponent),
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TaskComponent,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    MatIcon,
    TranslatePipe,
    TaskPlanningMenuComponent,
  ],
  template: `
    <div
      cdkDropList
      [cdkDropListData]="tasks()"
      [cdkDropListEnterPredicate]="taskDragPredicate"
      (cdkDropListDropped)="drop($event)"
      class="task-list"
      [class.is-folder-list]="!!folderId()"
    >
      @for (entry of entries(); track entry.task.id) {
        @let task = entry.task;
        <div
          cdkDrag
          [cdkDragData]="task"
          (cdkDragStarted)="startDrag(task, $event)"
          (cdkDragEnded)="endDrag()"
          class="task-entry"
        >
          <task
            #taskRow
            [task]="task"
            [isShowProjectTagNever]="true"
            [isShowPlanningStatus]="!planning()"
          />
          <button
            type="button"
            class="task-context-trigger"
            [attr.aria-label]="
              ('GCF.KEYBOARD.TASK_OPEN_CONTEXT_MENU' | translate) + ': ' + task.title
            "
            (click)="taskRow.openContextMenu($event)"
          >
            <mat-icon>menu_open</mat-icon>
          </button>
          @if (planning() && entry.path) {
            <span
              class="task-folder"
              [title]="entry.path"
              >{{ entry.path }}</span
            >
          }
          <button
            cdkDragHandle
            type="button"
            class="task-drag-handle"
            [attr.aria-label]="'PLANSTRAND.DRAG_TASK' | translate"
          >
            <mat-icon>drag_indicator</mat-icon>
          </button>
          <task-planning-menu
            [task]="task"
            [path]="entry.path"
          />
        </div>
      } @empty {
        <p
          class="empty-drop-target"
          [attr.aria-label]="'PLANSTRAND.EMPTY_PLANNING' | translate"
        >
          {{ planning() ? '—' : ('PLANSTRAND.EMPTY' | translate) }}
        </p>
      }
    </div>
  `,
  styles: `
    .empty-drop-target {
      color: var(--ink-muted);
      margin: 4px 12px;
      font-size: var(--font-size-sm);
    }
    .task-list {
      min-height: var(--s4);
    }
    .task-list.is-folder-list {
      min-height: calc(var(--planstrand-row-height) + 36px);
    }
    .task-folder {
      display: block;
      margin: -6px 0 10px 48px;
      color: var(--ink-muted);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .task-entry {
      position: relative;
      padding-inline-end: 72px;
      margin-block: 4px;
      border-radius: var(--radius-md);
      transition: background var(--transition-duration-s);
    }
    .task-entry:hover,
    .task-entry:focus-within {
      background: var(--surface-hover);
    }
    .task-drag-handle {
      position: absolute;
      inset-inline-end: 36px;
      top: 12px;
      border: 0;
      background: transparent;
      color: var(--ink-muted);
      cursor: grab;
      padding: 6px;
      opacity: 0;
    }
    .task-context-trigger {
      display: none;
    }
    .task-entry:hover .task-drag-handle,
    .task-entry:focus-within .task-drag-handle {
      opacity: 1;
    }
    .cdk-drag-preview {
      background: var(--surface-floating);
      box-shadow: var(--card-shadow);
    }
    .cdk-drag-placeholder {
      opacity: 0.3;
    }
    @media (pointer: coarse) {
      .task-entry {
        padding-inline-end: 132px;
      }
      .task-context-trigger {
        display: flex;
        align-items: center;
        justify-content: center;
        position: absolute;
        inset-inline-end: 88px;
        top: 12px;
        min-height: 44px;
        min-width: 44px;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--ink-muted);
      }
      .task-drag-handle {
        opacity: 1;
        min-height: 44px;
        min-width: 44px;
        inset-inline-end: 44px;
      }
      summary {
        min-height: 44px;
        min-width: 44px;
      }
    }
  `,
})
export class PlanstrandTaskListComponent {
  private readonly _externalDrag = inject(ScheduleExternalDragService);
  startDrag(task: TaskWithSubTasks, event: CdkDragStart): void {
    this._externalDrag.setCancelNextDrop(false);
    this._externalDrag.setActiveTask(task, event.source._dragRef);
  }
  endDrag(): void {
    this._externalDrag.setActiveTask(null);
  }
  readonly ui = inject(PlanstrandService);
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);
  private readonly dates = inject(CurrentDateService);
  private readonly taskService = inject(TaskService);
  private readonly taskEntities = this.store.selectSignal(selectTaskEntities);
  readonly today = this.dates.today;
  readonly tasks = input<TaskWithSubTasks[]>([]);
  private readonly placements = this.store.selectSignal(selectAllPlacements);
  readonly entries = computed(() => {
    const paths = this.ui.paths();
    const placements = new Map(this.placements().map((p) => [p.id, p.target]));
    return this.tasks().map((task) => ({
      task,
      target: placements.get(task.id),
      path: paths.get(resolveTaskFolderId(task, this.ui.folders())) ?? '',
    }));
  });
  readonly folderId = input('');
  readonly days = input<string[]>([]);
  readonly planning = input(false);
  readonly ordering = input(true);
  readonly acceptDrops = input(true);
  readonly dropped = output<{ task: TaskWithSubTasks; index: number }>();
  readonly reordered = output<{ task: TaskWithSubTasks; direction: -1 | 1 }>();

  canMoveTask(task: Task, direction: -1 | 1, isNested = false): boolean {
    if (!this.ordering() || task.isDone) return false;
    const index = this.tasks().findIndex((t) => t.id === task.id);
    if (!isNested && index >= 0) {
      const neighbor = this.tasks()[index + direction];
      return !!neighbor && (this.planning() || this.ui.canReorderTask(task, neighbor));
    }
    // Nested children stay among siblings; never move the parent at an edge.
    const parent = isNested && task.parentId && this.taskEntities()[task.parentId];
    const siblings = parent ? parent.subTaskIds : [];
    const at = siblings.indexOf(task.id);
    return at >= 0 && !!siblings[at + direction];
  }

  moveTask(task: Task, direction: -1 | 1, isNested = false): void {
    if (!this.canMoveTask(task, direction, isNested)) return;
    const root = !isNested && this.tasks().find((t) => t.id === task.id);
    if (root) this.reordered.emit({ task: root, direction });
    else if (task.parentId) {
      const ids = [...this.taskEntities()[task.parentId]!.subTaskIds];
      const index = ids.indexOf(task.id);
      ids.splice(index, 1);
      ids.splice(index + direction, 0, task.id);
      // The existing drag reorder accepts parent IDs at runtime for subtask lists.
      this.taskService.move(
        task.id,
        task.parentId as DropListModelSource,
        task.parentId as DropListModelSource,
        ids,
      );
    }
  }

  moveTaskToFolder(task: Task): void {
    void this.ui.chooseTaskFolder(task);
  }

  planningTarget(task: Task): PlanningPlacement['target'] | undefined {
    return this.placements().find((placement) => placement.id === task.id)?.target;
  }

  drop(event: CdkDragDrop<TaskWithSubTasks[]>): void {
    if (!event.isPointerOverContainer || this._externalDrag.isCancelNextDrop()) {
      this._externalDrag.setCancelNextDrop(false);
      return;
    }
    const task: unknown = event.item.data;
    if (task && typeof task === 'object' && 'id' in task)
      this.dropped.emit({ task: task as TaskWithSubTasks, index: event.currentIndex });
  }
  readonly taskDragPredicate = (drag: CdkDrag<unknown>): boolean =>
    this.acceptDrops() &&
    !!drag.data &&
    typeof drag.data === 'object' &&
    'id' in drag.data;
  plan(task: TaskWithSubTasks, target: string): void {
    const commands = planningCommands(this.store);
    if (target === 'UNPLAN') commands.unplan(task.id);
    else if (target === 'WEEK' || target === 'NEXT_WEEK')
      commands.planWeek(
        task.id,
        new Date(
          calendarAddDays(this.dates.resolveToday(), target === 'NEXT_WEEK' ? 7 : 0) +
            'T12:00:00',
        ),
      );
    else if (target)
      commands.planTaskForDay({
        task,
        day:
          target === 'TODAY'
            ? this.dates.resolveToday()
            : target === 'TOMORROW'
              ? calendarAddDays(this.dates.resolveToday(), 1)
              : target,
      });
  }
  chooseDestination(
    task: TaskWithSubTasks,
    type: 'DAY' | 'WEEK',
    current?: PlanningPlacement['target'],
  ): void {
    this.dialog
      .open(PlanningDestinationDialogComponent, {
        width: '360px',
        maxWidth: 'calc(100vw - 32px)',
        data: { type, date: current?.key ?? this.days()[0] ?? this.dates.resolveToday() },
      })
      .afterClosed()
      .subscribe((target: PlanningPlacement['target'] | undefined) => {
        if (target) planningCommands(this.store).placeAt(task.id, target, Infinity);
      });
  }
  schedule(task: TaskWithSubTasks): void {
    this.dialog.open(DialogScheduleTaskComponent, {
      data: { task, isSubmitOnQuickAccess: false },
    });
  }
}
