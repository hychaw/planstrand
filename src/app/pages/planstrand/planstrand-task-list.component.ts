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
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TaskComponent } from '../../features/tasks/task/task.component';
import { TaskWithSubTasks } from '../../features/tasks/task.model';
import { DialogScheduleTaskComponent } from '../../features/planner/dialog-schedule-task/dialog-schedule-task.component';
import { planningCommands } from '../../features/planning/planning-commands';
import { PlanstrandService } from './planstrand.service';
import { CurrentDateService } from '../../core/date/current-date.service';
import { resolveTaskFolderId } from '../../features/tasks/task-folder-ownership';
import { PlanningStatusComponent } from '../../features/planning/planning-status.component';
import { PlanningDestinationDialogComponent } from './planning-destination-dialog.component';
import { selectAllPlacements } from '../../features/planning/store/planning.selectors';
import { PlanningPlacement } from '../../features/planning/planning.model';
import { calendarAddDays } from '../../util/calendar-date';

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
    PlanningStatusComponent,
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
            [isShowPlanningStatus]="!planning()"
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
            (toggle)="revealActions(actions)"
            (keydown.escape)="closeActions(actions); $event.stopPropagation()"
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
              <h3>{{ 'PLANSTRAND.PLANNING' | translate }}</h3>
              <planstrand-planning-status [target]="entry.target" />
              <div class="quick-planning">
                @for (action of quickPlanningActions; track action.target) {
                  <button
                    mat-button
                    (click)="plan(task, action.target); closeActions(actions)"
                  >
                    {{ action.label | translate }}
                  </button>
                }
              </div>
              <button
                mat-button
                (click)="chooseDestination(task, 'DAY', entry.target)"
              >
                {{ 'PLANSTRAND.CHOOSE_DATE' | translate }}
              </button>
              <button
                mat-button
                (click)="chooseDestination(task, 'WEEK', entry.target)"
              >
                {{ 'PLANSTRAND.CHOOSE_WEEK' | translate }}
              </button>
              <button
                mat-button
                (click)="plan(task, 'UNPLAN'); closeActions(actions)"
              >
                {{ 'PLANSTRAND.UNPLAN' | translate }}
              </button>
              <h3>{{ 'PLANSTRAND.OTHER_ACTIONS' | translate }}</h3>
              <button
                mat-button
                (click)="ui.chooseTaskFolder(task)"
                [title]="entry.path"
              >
                {{ 'PLANSTRAND.MOVE_TASK' | translate }}
              </button>
              <button
                mat-button
                (click)="schedule(task)"
              >
                {{ 'PLANSTRAND.SCHEDULE_SESSION' | translate }}
              </button>
              @if (ordering()) {
                <button
                  mat-button
                  (click)="
                    reordered.emit({ task: task, direction: -1 }); closeActions(actions)
                  "
                  [disabled]="
                    $first ||
                    (!planning() && !ui.canReorderTask(task, tasks()[$index - 1]))
                  "
                  [attr.aria-label]="'PLANSTRAND.MOVE_UP' | translate"
                >
                  {{ 'PLANSTRAND.MOVE_UP' | translate }}
                </button>
                <button
                  mat-button
                  (click)="
                    reordered.emit({ task: task, direction: 1 }); closeActions(actions)
                  "
                  [disabled]="
                    $last ||
                    (!planning() && !ui.canReorderTask(task, tasks()[$index + 1]))
                  "
                  [attr.aria-label]="'PLANSTRAND.MOVE_DOWN' | translate"
                >
                  {{ 'PLANSTRAND.MOVE_DOWN' | translate }}
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
      flex-direction: column;
      align-items: stretch;
      gap: var(--s-half);
      padding: var(--s);
      border-radius: var(--radius-md);
      background: var(--surface-floating);
      box-shadow: var(--card-shadow);
      border: 1px solid var(--separator);
      max-height: 65vh;
      scroll-margin-block: 72px;
      overflow-y: auto;
    }
    .commands h3 {
      margin: var(--s-half) 0;
      color: var(--ink-strong);
      font-size: var(--font-size-sm);
    }
    .commands h3:not(:first-of-type) {
      border-top: 1px solid var(--separator);
      padding-top: var(--s);
    }
    .quick-planning {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .commands button {
      font-size: var(--font-size-sm);
    }
    .folder-path {
      max-width: 100%;
      overflow-wrap: anywhere;
      font-size: var(--font-size-sm);
      color: var(--ink-muted);
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
      width: min(320px, 100%);
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
  readonly quickPlanningActions = [
    { target: 'TODAY', label: 'PLANSTRAND.PLAN_TODAY' },
    { target: 'TOMORROW', label: 'PLANSTRAND.PLAN_TOMORROW' },
    { target: 'WEEK', label: 'PLANSTRAND.MOVE_THIS_WEEK' },
    { target: 'NEXT_WEEK', label: 'PLANSTRAND.MOVE_NEXT_WEEK' },
  ];
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
  revealActions(actions: HTMLDetailsElement): void {
    if (actions.open)
      requestAnimationFrame(() => {
        if (actions.open)
          actions.querySelector('.commands')?.scrollIntoView({ block: 'nearest' });
      });
  }
  closeActions(actions: HTMLDetailsElement): void {
    actions.open = false;
    actions.querySelector('summary')?.focus();
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
