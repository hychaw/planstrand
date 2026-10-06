import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ScheduleDayPanelComponent } from '../../features/schedule/schedule-day-panel/schedule-day-panel.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import {
  CdkDropListGroup,
  CdkDrag,
  CdkDropList,
  CdkDragDrop,
} from '@angular/cdk/drag-drop';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { PlanstrandService } from './planstrand.service';
import { PlanstrandTaskListComponent } from './planstrand-task-list.component';
import { selectMasterTaskGroups } from './planstrand.selectors';
import { INBOX_FOLDER_ID } from '../../features/folder/folder.const';
import { selectAllPlacements } from '../../features/planning/store/planning.selectors';
import {
  selectAllTasksWithSubTasks,
  selectTaskFeatureState,
  mapSubTasksToTask,
} from '../../features/tasks/store/task.selectors';
import { planningCommands } from '../../features/planning/planning-commands';
import { PlanningPlacement } from '../../features/planning/planning.model';
import { TaskWithSubTasks } from '../../features/tasks/task.model';
import { DateService } from '../../core/date/date.service';
import { selectTodayStr } from '../../root-store/app-state/app-state.selectors';
import { selectLocalizationConfig } from '../../features/config/store/global-config.reducer';
import { getWeekRange } from '../../util/get-week-range';
import { getDbDateStr } from '../../util/get-db-date-str';

@Component({
  selector: 'planstrand-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ScheduleDayPanelComponent,
    PlanstrandTaskListComponent,
    CdkDropListGroup,
    CdkDrag,
    CdkDropList,
    MatButton,
    TranslatePipe,
    RouterLink,
  ],
  templateUrl: './planstrand-page.component.html',
  styleUrl: './planstrand-page.component.scss',
})
export class PlanstrandPageComponent {
  readonly todayPane = signal<'plan' | 'schedule'>('plan');
  readonly Math = Math;
  readonly ui = inject(PlanstrandService);
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(Store);
  private readonly data = toSignal(this.route.data);
  private readonly params = toSignal(this.route.paramMap);
  readonly mode = computed(() => this.data()?.['planstrand'] as string);
  readonly inboxId = INBOX_FOLDER_ID;
  private readonly dateService = inject(DateService);
  private readonly logicalToday = this.store.selectSignal(selectTodayStr);
  readonly today = computed(() => this.logicalToday() || this.dateService.todayStr());
  private readonly localization = this.store.selectSignal(selectLocalizationConfig);
  private readonly groups = this.store.selectSignal(selectMasterTaskGroups);
  private readonly placements = this.store.selectSignal(selectAllPlacements);
  private readonly taskState = this.store.selectSignal(selectTaskFeatureState);
  private readonly allTasks = this.store.selectSignal(selectAllTasksWithSubTasks);
  readonly days = computed(() => {
    const start = getWeekRange(
      new Date(this.today() + 'T12:00:00'),
      this.localization().firstDayOfWeek ?? 1,
    ).start;
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      return getDbDateStr(date);
    });
  });
  readonly folderRows = computed(() => {
    const id = this.mode() === 'inbox' ? INBOX_FOLDER_ID : this.params()?.get('id');
    return (this.mode() === 'master' ? this.ui.visibleRows() : this.ui.rows())
      .filter((row) => this.mode() === 'master' || row.folder.id === id)
      .map((row) => ({
        ...row,
        tasks: this.groups().get(row.folder.id) ?? [],
      }));
  });
  readonly sections = computed(() => {
    const targets: PlanningPlacement['target'][] =
      this.mode() === 'today'
        ? [{ type: 'DAY', key: this.today() }]
        : [
            { type: 'WEEK', key: this.days()[0] },
            ...this.days().map((key) => ({ type: 'DAY' as const, key })),
          ];
    return targets.map((target) => ({
      target,
      tasks: this.placements()
        .filter((p) => p.target.type === target.type && p.target.key === target.key)
        .map((p) =>
          mapSubTasksToTask(this.taskState().entities[p.id] ?? null, this.taskState()),
        )
        .filter((t): t is TaskWithSubTasks => !!t),
    }));
  });
  readonly captureTasks = computed(() => {
    const planned = new Set(this.placements().map((p) => p.id));
    return this.allTasks().filter((t) => !planned.has(t.id) && !t.isDone);
  });

  moveTask(event: { task: TaskWithSubTasks; index: number }, folderId: string): void {
    this.ui.moveTask(event.task, folderId);
  }
  planDrop(
    event: { task: TaskWithSubTasks; index: number },
    target: PlanningPlacement['target'],
  ): void {
    planningCommands(this.store).placeAt(event.task.id, target, event.index);
  }
  unplan(id: string): void {
    planningCommands(this.store).unplan(id);
  }
  reorder(
    event: { task: TaskWithSubTasks; direction: -1 | 1 },
    tasks: TaskWithSubTasks[],
    target: PlanningPlacement['target'],
  ): void {
    this.planDrop(
      {
        task: event.task,
        index: tasks.findIndex((t) => t.id === event.task.id) + event.direction,
      },
      target,
    );
  }
  folderDrop(event: CdkDragDrop<unknown>, parentId: string | null): void {
    const id: unknown = event.item.data;
    if (typeof id === 'string') this.ui.moveFolder(id, parentId);
  }
  readonly folderDragPredicate = (drag: CdkDrag<unknown>): boolean =>
    typeof drag.data === 'string';
}
