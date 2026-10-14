import { MatDialog } from '@angular/material/dialog';
import { DialogEventComponent } from '../../event/dialog-event/dialog-event.component';
import { WorkSessionService } from '../../work-session/work-session.service';
import { planningCommands } from '../../planning/planning-commands';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostBinding,
  HostListener,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  Signal,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { Store } from '@ngrx/store';
import { zonedDateTimeToTimestamp } from '../../../util/iana-time-zone';
import { ScheduleService } from '../schedule.service';
import { ShortTimeHtmlPipe } from '../../../ui/pipes/short-time-html.pipe';
import { SelectTaskMinimalComponent } from '../../tasks/select-task/select-task-minimal/select-task-minimal.component';
import { devError } from '../../../util/dev-error';
import { SnackService } from '../../../core/snack/snack.service';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { first } from 'rxjs';

type Timeout = NodeJS.Timeout | number | undefined;

@Component({
  selector: 'create-task-placeholder',
  imports: [
    MatIcon,
    LocaleDatePipe,
    ShortTimeHtmlPipe,
    SelectTaskMinimalComponent,
    TranslatePipe,
  ],
  templateUrl: './create-task-placeholder.component.html',
  styleUrl: './create-task-placeholder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateTaskPlaceholderComponent implements OnDestroy {
  T: typeof T = T;

  private _taskService = inject(TaskService);
  private readonly _eventDialog = inject(MatDialog);
  private readonly _element = inject<ElementRef<HTMLElement>>(ElementRef);
  newEvent(ev: MouseEvent): void {
    ev.stopPropagation();
    const origin = ev.currentTarget as HTMLElement | null;
    const calendar = this._element.nativeElement.closest<HTMLElement>('schedule-week');
    const ref = this._eventDialog.open(DialogEventComponent, {
      data: { date: this.date(), start: this.due() },
      restoreFocus: false,
    });
    ref
      .afterClosed()
      .pipe(first())
      .subscribe(() => {
        if (origin?.isConnected) origin.focus();
        else if (calendar?.isConnected) {
          calendar.tabIndex = -1;
          calendar.focus();
        }
      });
    this.editEnd.emit();
  }
  private readonly _workSessionService = inject(WorkSessionService);
  private readonly _scheduleService = inject(ScheduleService);
  private _store = inject(Store);
  private readonly _snackService = inject(SnackService);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);

  // Exposed so the template can pass the reactive locale to the now-pure
  // `localeDate` pipe, preserving re-render on a locale change.
  readonly locale = this._dateTimeFormatService.currentLocale;

  isEditMode = input.required<boolean>();
  isInMyDay = input(false);
  time = input<string>();
  date = input<string>();

  // Task selection state
  selectedTask = signal<Task | null>(null);
  newTaskTitle = signal<string>('');
  isCreate = signal<boolean>(false);
  isForDayMode = signal<boolean>(false);
  due: Signal<number> = computed(() => {
    if (this.date() && this.time()) {
      // Log.log(this.date(), this.time());
      const formattedTime = this._formatTimeWithLeadingZero(this.time() as string);
      const day = this.isInMyDay() ? this._scheduleService.today() : this.date()!;
      return (
        zonedDateTimeToTimestamp(
          day,
          formattedTime,
          this._scheduleService.displayTimeZone(),
        ) ?? 0
      );
    }
    return 0;
  });

  editEnd = output<void>();

  readonly selectTaskMinimal = viewChild('selectTaskMinimal', { read: ElementRef });

  private _interactionState: 'Idle' | 'Editing' | 'Selecting' = 'Idle';
  private _blurTimeout: Timeout;
  private _selectionTimeout: Timeout;

  // Timeout constants for better maintainability
  private readonly BLUR_DELAY = 150;
  private readonly SELECTION_DELAY = 100;

  @HostBinding('class.edit-mode')
  get isEditModeClass(): boolean {
    return this.isEditMode();
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    event.stopPropagation();
    this._setState('Editing');
    this._focusSelectTaskMinimal();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isEditMode()) {
      const target = event.target as HTMLElement;
      const component = target.closest('create-task-placeholder');
      const autocompleteOption = target.closest('mat-option');

      // If click is outside the component and not on an autocomplete option, close it
      if (!component && !autocompleteOption) {
        this._closeAndReset();
      }
    }
  }

  constructor() {
    effect(() => {
      if (this.isEditMode()) {
        this._focusSelectTaskMinimal();
      }
    });
  }

  ngOnDestroy(): void {
    this._clearTimeouts();
    this.editEnd.emit();
  }

  async onTaskSelected(task: Task): Promise<void> {
    this._setState('Selecting');
    this.selectedTask.set(task);
    this.newTaskTitle.set('');
    this.isCreate.set(false);

    if (this.due()) {
      await this.addTask();
      this._closeAndReset();
    } else {
      this._setState('Idle');
    }
  }

  onTextChanged(text: string): void {
    this.isCreate.set(true);
    this.newTaskTitle.set(text);
    this.selectedTask.set(null);
  }

  onSimpleTaskInputBlur(): void {
    this._clearTimeouts();
    // Only close if we're in idle state (not editing autocomplete or selecting)
    if (this._interactionState === 'Idle') {
      this._blurTimeout = window.setTimeout(() => this._closeAndReset(), this.BLUR_DELAY);
    }
  }

  private _clearTimeouts(): void {
    window.clearTimeout(this._blurTimeout);
    window.clearTimeout(this._selectionTimeout);
  }

  private _resetTaskState(): void {
    this.newTaskTitle.set('');
    this.selectedTask.set(null);
    this.isCreate.set(false);
  }

  private _setState(state: 'Idle' | 'Editing' | 'Selecting'): void {
    this._interactionState = state;
    if (state === 'Editing') {
      this._clearTimeouts();
    }
  }

  private _closeAndReset(): void {
    this._clearTimeouts();
    this._resetTaskState();
    this._setState('Idle');
    this.editEnd.emit();
  }

  onAutocompleteOpened(): void {
    this._setState('Editing');
  }

  onAutocompleteClosed(): void {
    // Add a small delay to ensure option selection is processed first
    this._selectionTimeout = setTimeout(() => {
      if (this._interactionState !== 'Selecting') {
        this._setState('Idle');
      }
    }, this.SELECTION_DELAY);
  }

  async onSelectTaskKeyDown(event: KeyboardEvent): Promise<void> {
    if (
      event.key === 'Enter' &&
      this.due() &&
      (this.selectedTask() || this.newTaskTitle())
    ) {
      await this.addTask();
      this._closeAndReset();
    } else if (event.key === 'Escape') {
      this._closeAndReset();
    } else if (event.key === '1' && event.ctrlKey) {
      this.isForDayMode.set(!this.isForDayMode());
    }
  }

  private _focusSelectTaskMinimal(): void {
    // Try immediate focus, fallback to next tick if needed
    if (!this._tryFocus()) {
      setTimeout(() => this._tryFocus(), 0);
    }
  }

  private _tryFocus(): boolean {
    const selectTaskInput =
      this.selectTaskMinimal()?.nativeElement?.querySelector('input');
    if (selectTaskInput) {
      selectTaskInput.focus();
      return true;
    }
    return false;
  }

  private async addTask(): Promise<void> {
    if (this._isSubmitting) return;
    this._isSubmitting = true;
    try {
      if (this.isCreate() && this.newTaskTitle()) {
        // Create new task
        await this.createNewTask(this.newTaskTitle());
      } else if (!this.isCreate() && this.selectedTask()) {
        // Schedule existing task
        await this.scheduleExistingTask(this.selectedTask()!);
      }
    } finally {
      this._isSubmitting = false;
    }
  }

  private _isSubmitting = false;

  private async createNewTask(title: string): Promise<void> {
    try {
      if (this.isForDayMode()) {
        // Plan task for day (no specific time)
        const id = this._taskService.add(title, false, {
          timeEstimate: 30 * 60 * 1000,
          dueDay: null,
        });
        const task = await this._taskService.getByIdOnce$(id).toPromise();
        if (!task) {
          throw new Error(`Failed to retrieve task after creation. Task ID: ${id}`);
        }
        this._store.dispatch(
          await planningCommands(this._store).dayAction({
            task: task,
            day: this.isInMyDay() ? this._scheduleService.getTodayStr() : this.date()!,
          }),
        );
      } else {
        // Schedule task with specific time
        const id = this._taskService.add(title, undefined, {
          timeEstimate: 30 * 60 * 1000,
          dueDay: null,
        });
        const task = await this._taskService.getByIdOnce$(id).toPromise();
        if (!this._workSessionService.scheduleTask(task, this.due())) {
          throw new Error('WorkSession scheduling failed');
        }
        if (this.isInMyDay()) {
          this._store.dispatch(
            await planningCommands(this._store).dayAction({
              task,
              day: this._scheduleService.getTodayStr(),
            }),
          );
        }
      }
    } catch (error) {
      devError(`Failed to create or schedule task: ${error}`);
      this._snackService.open({
        type: 'ERROR',
        msg: 'Failed to create or schedule task',
      });
    }
  }

  private async scheduleExistingTask(task: Task): Promise<void> {
    if (this.isForDayMode()) {
      // Plan existing task for day
      planningCommands(this._store).planTaskForDay({
        task: task,
        day: this.date()!,
      });
    } else {
      // Schedule existing task with specific time
      this._workSessionService.scheduleTask(task, this.due());
    }
  }

  private _formatTimeWithLeadingZero(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
}
