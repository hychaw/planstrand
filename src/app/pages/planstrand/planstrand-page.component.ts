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
import { selectCanonicalTasks, selectMasterTaskGroups } from './planstrand.selectors';
import { INBOX_FOLDER_ID } from '../../features/folder/folder.const';
import { selectAllPlacements } from '../../features/planning/store/planning.selectors';
import {
  selectTaskFeatureState,
  mapSubTasksToTask,
} from '../../features/tasks/store/task.selectors';
import {
  planningCommands,
  planningWeekStart,
} from '../../features/planning/planning-commands';
import { PlanningPlacement } from '../../features/planning/planning.model';
import { TaskWithSubTasks } from '../../features/tasks/task.model';
import { CurrentDateService } from '../../core/date/current-date.service';
import { selectLocalizationConfig } from '../../features/config/store/global-config.reducer';
import { calendarAddDays, calendarDate } from '../../util/calendar-date';
import { calendarDisplayZone } from '../../features/schedule/calendar-time';

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
  private readonly dates = inject(CurrentDateService);
  private readonly localization = this.store.selectSignal(selectLocalizationConfig);
  private readonly displayZone = computed(() =>
    calendarDisplayZone(this.localization()?.timeZone),
  );
  private readonly calendarToday = this.dates.dateInZone(this.displayZone);
  readonly today = computed(() =>
    this.mode() === 'today' ? this.calendarToday() : this.dates.today(),
  );
  private readonly groups = this.store.selectSignal(selectMasterTaskGroups);
  private readonly placements = this.store.selectSignal(selectAllPlacements);
  private readonly taskState = this.store.selectSignal(selectTaskFeatureState);
  private readonly allTasks = this.store.selectSignal(selectCanonicalTasks);
  readonly weekOffset = signal(0);
  readonly days = computed(() => {
    const start = planningWeekStart(
      calendarAddDays(this.today(), this.weekOffset() * 7),
      this.localization().firstDayOfWeek ?? 1,
    );
    return Array.from({ length: 7 }, (_, i) => calendarAddDays(start, i));
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
  readonly focusTasks = computed(
    () => this.sections()[0]?.tasks.filter((t) => !t.isDone) ?? [],
  );
  readonly completedTasks = computed(
    () => this.sections()[0]?.tasks.filter((t) => t.isDone) ?? [],
  );
  readonly captureTasks = computed(() => {
    const planned = new Set(this.placements().map((p) => p.id));
    return this.allTasks().filter((t) => !planned.has(t.id) && !t.isDone);
  });

  addTask(target: PlanningPlacement['target']): void {
    void this.ui.createTask(
      this.inboxId,
      undefined,
      this.mode() === 'today'
        ? () => ({ type: 'DAY', key: this.resolveToday() })
        : target,
    );
  }

  moveTask(event: { task: TaskWithSubTasks; index: number }, folderId: string): void {
    if (
      this.groups()
        .get(folderId)
        ?.some((t) => t.id === event.task.id)
    ) {
      this.ui.reorderTask(event.task, event.index, this.groups().get(folderId) ?? []);
    } else {
      this.ui.moveTask(event.task, folderId);
    }
  }
  planDrop(
    event: { task: TaskWithSubTasks; index: number },
    target: PlanningPlacement['target'],
  ): void {
    let index = event.index;
    if (this.mode() === 'today') {
      const others = (this.sections()[0]?.tasks ?? []).filter(
        (task) => task.id !== event.task.id,
      );
      const anchor = others.filter((task) => !task.isDone)[index];
      index = anchor ? others.findIndex((task) => task.id === anchor.id) : others.length;
    }
    planningCommands(this.store).placeAt(
      event.task.id,
      this.mode() === 'today' ? { type: 'DAY', key: this.resolveToday() } : target,
      index,
    );
  }
  unplannedDrop(event: { task: TaskWithSubTasks; index: number }): void {
    if (this.captureTasks().some((t) => t.id === event.task.id))
      this.ui.reorderTask(event.task, event.index, this.captureTasks());
    else planningCommands(this.store).unplan(event.task.id);
  }
  private resolveToday(): string {
    this.dates.refresh();
    return calendarDate(Date.now(), this.displayZone());
  }
  reorderUnderlying(
    event: { task: TaskWithSubTasks; direction: -1 | 1 },
    tasks: TaskWithSubTasks[],
  ): void {
    this.ui.reorderTask(
      event.task,
      tasks.findIndex((t) => t.id === event.task.id) + event.direction,
      tasks,
    );
  }
  reorder(
    event: { task: TaskWithSubTasks; direction: -1 | 1 },
    tasks: TaskWithSubTasks[],
    target: PlanningPlacement['target'],
  ): void {
    const index = tasks.findIndex((t) => t.id === event.task.id);
    if (
      index < 0 ||
      index + event.direction < 0 ||
      index + event.direction >= tasks.length
    )
      return;
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
