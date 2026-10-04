import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { CdkDrag, CdkDropList, CdkDragDrop } from '@angular/cdk/drag-drop';
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
  imports: [TaskComponent, CdkDrag, CdkDropList, MatButton, TranslatePipe, FormsModule],
  template: `
    <div
      cdkDropList
      [cdkDropListData]="tasks()"
      [cdkDropListEnterPredicate]="taskDragPredicate"
      (cdkDropListDropped)="drop($event)"
      class="task-list"
    >
      @for (entry of entries(); track entry.task.id) {
        @let task = entry.task;
        <div
          cdkDrag
          [cdkDragData]="task"
          class="task-entry"
        >
          <task
            [task]="task"
            [isShowProjectTagNever]="true"
          />
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
                (ngModelChange)="plan(task, $event)"
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
        </div>
      } @empty {
        <p>
          {{
            (planning() ? 'PLANSTRAND.EMPTY_PLANNING' : 'PLANSTRAND.EMPTY') | translate
          }}
        </p>
      }
    </div>
  `,
  styles: `
    .task-list {
      min-height: var(--s4);
    }
    .commands {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--s);
      padding: var(--s-half) var(--s);
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
    .task-entry {
      margin-bottom: var(--s);
    }
  `,
})
export class PlanstrandTaskListComponent {
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
  readonly dropped = output<{ task: TaskWithSubTasks; index: number }>();
  readonly reordered = output<{ task: TaskWithSubTasks; direction: -1 | 1 }>();

  drop(event: CdkDragDrop<TaskWithSubTasks[]>): void {
    const task: unknown = event.item.data;
    if (task && typeof task === 'object' && 'id' in task)
      this.dropped.emit({ task: task as TaskWithSubTasks, index: event.currentIndex });
  }
  readonly taskDragPredicate = (drag: CdkDrag<unknown>): boolean =>
    !!drag.data && typeof drag.data === 'object' && 'id' in drag.data;
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
