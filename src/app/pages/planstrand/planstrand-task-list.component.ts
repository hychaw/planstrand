import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
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
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TaskComponent } from '../../features/tasks/task/task.component';
import { TaskWithSubTasks } from '../../features/tasks/task.model';
import { DialogScheduleTaskComponent } from '../../features/planner/dialog-schedule-task/dialog-schedule-task.component';
import { planningCommands } from '../../features/planning/planning-commands';
import { PlanstrandService } from './planstrand.service';
import { DateService } from '../../core/date/date.service';
import { selectTodayStr } from '../../root-store/app-state/app-state.selectors';
import { resolveTaskFolderId } from '../../features/tasks/task-folder-ownership';

@Component({
  selector: 'planstrand-task-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TaskComponent,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    MatButton,
    MatIcon,
    TranslatePipe,
    FormsModule,
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
            [task]="task"
            [isShowProjectTagNever]="true"
          />
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
          <details
            #actions
            class="task-actions"
            name="planstrand-task-actions"
            (keydown.escape)="actions.open = false; $event.stopPropagation()"
          >
            <summary
              [attr.aria-label]="('PLANSTRAND.ACTIONS' | translate) + ': ' + task.title"
            >
              •••
            </summary>
            <div class="commands">
              <span
                class="folder-path"
                [title]="entry.path"
                >{{ entry.path }}</span
              >
              <button
                mat-button
                (click)="ui.chooseTaskFolder(task)"
                [title]="entry.path"
              >
                {{ 'PLANSTRAND.MOVE_TASK' | translate }}
              </button>
              <label
                >{{ 'PLANSTRAND.PLAN' | translate }}
                <select
                  [ngModel]="''"
                  (ngModelChange)="plan(task, $event); actions.open = false"
                >
                  <option value="">{{ 'PLANSTRAND.CHOOSE' | translate }}</option>
                  <option [value]="today()">{{ 'PLANSTRAND.TODAY' | translate }}</option>
                  <option value="WEEK">{{ 'PLANSTRAND.THIS_WEEK' | translate }}</option>
                  @for (day of days(); track day) {
                    <option [value]="day">{{ day }}</option>
                  }
                  <option value="UNPLAN">{{ 'PLANSTRAND.UNPLAN' | translate }}</option>
                </select>
              </label>
              <button
                mat-button
                (click)="schedule(task)"
              >
                {{ 'PLANSTRAND.SCHEDULE_SESSION' | translate }}
              </button>
              @if (planning()) {
                <button
                  mat-button
                  (click)="reordered.emit({ task: task, direction: -1 })"
                  [disabled]="$first"
                  [attr.aria-label]="'PLANSTRAND.MOVE_UP' | translate"
                >
                  ↑
                </button>
                <button
                  mat-button
                  (click)="reordered.emit({ task: task, direction: 1 })"
                  [disabled]="$last"
                  [attr.aria-label]="'PLANSTRAND.MOVE_DOWN' | translate"
                >
                  ↓
                </button>
              }
            </div>
          </details>
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
    .commands {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--s);
      padding: var(--s-half) var(--s);
      border-radius: var(--radius-md);
      background: var(--surface-floating);
      box-shadow: var(--card-shadow);
      border: 1px solid var(--separator);
    }
    label {
      font-size: var(--font-size-sm);
    }
    select {
      max-width: 16em;
    }
    .folder-path {
      max-width: 100%;
      overflow-wrap: anywhere;
      font-size: var(--font-size-sm);
      color: var(--text-color-muted);
    }
    .commands label {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--s-half);
      min-width: 0;
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
    .task-actions {
      position: absolute;
      inset-inline-end: 0;
      top: 12px;
      z-index: 3;
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
    .task-entry:hover .task-drag-handle,
    .task-entry:focus-within .task-drag-handle {
      opacity: 1;
    }
    summary {
      cursor: pointer;
      list-style: none;
      padding: 8px;
      color: var(--ink-muted);
      border-radius: var(--radius-sm);
    }
    summary::-webkit-details-marker {
      display: none;
    }
    details[open] {
      width: min(100%, 420px);
      z-index: 5;
    }
    details[open] summary {
      text-align: end;
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
        padding-inline-end: 88px;
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
  private readonly dateService = inject(DateService);
  private readonly logicalToday = this.store.selectSignal(selectTodayStr);
  readonly today = computed(() => this.logicalToday() || this.dateService.todayStr());
  readonly tasks = input<TaskWithSubTasks[]>([]);
  readonly entries = computed(() => {
    const paths = this.ui.paths();
    return this.tasks().map((task) => ({
      task,
      path: paths.get(resolveTaskFolderId(task, this.ui.folders())) ?? '',
    }));
  });
  readonly folderId = input('');
  readonly days = input<string[]>([]);
  readonly planning = input(false);
  readonly acceptDrops = input(true);
  readonly dropped = output<{ task: TaskWithSubTasks; index: number }>();
  readonly reordered = output<{ task: TaskWithSubTasks; direction: -1 | 1 }>();

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
    else if (target === 'WEEK')
      commands.planWeek(task.id, new Date(this.today() + 'T12:00:00'));
    else if (target) commands.planTaskForDay({ task, day: target });
  }
  schedule(task: TaskWithSubTasks): void {
    this.dialog.open(DialogScheduleTaskComponent, {
      data: { task, isSubmitOnQuickAccess: false },
    });
  }
}
