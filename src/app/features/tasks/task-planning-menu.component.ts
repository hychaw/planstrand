import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { PlanningStatusComponent } from '../planning/planning-status.component';
import { TaskWithSubTasks } from './task.model';
import { TaskFocusService } from './task-focus.service';
import { TASK_ROW_MENU_ACTIONS } from './task-row-menu-actions';

/** Shared by main and nested rows so touch users retain child planning access. */
@Component({
  selector: 'task-planning-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, TranslatePipe, PlanningStatusComponent],
  template: `
    @let t = task();
    @let target = actions.planningTarget(t);
    <details
      #menu
      class="task-actions"
      name="planstrand-task-actions"
      (toggle)="revealActions(menu)"
      (keydown.escape)="closeActions(menu); $event.stopPropagation()"
    >
      <summary [attr.aria-label]="('PLANSTRAND.ACTIONS' | translate) + ': ' + t.title">
        •••
      </summary>
      <div class="commands">
        <span
          class="folder-path"
          [title]="path()"
          >{{ path() }}</span
        >
        <h3>{{ 'PLANSTRAND.PLANNING' | translate }}</h3>
        <planstrand-planning-status [target]="target" />
        <div class="quick-planning">
          @for (action of quickPlanningActions; track action.target) {
            <button
              mat-button
              (click)="actions.plan(t, action.target); closeActions(menu)"
            >
              {{ action.label | translate }}
            </button>
          }
        </div>
        <button
          mat-button
          (click)="actions.chooseDestination(t, 'DAY', target)"
        >
          {{ 'PLANSTRAND.CHOOSE_DATE' | translate }}
        </button>
        <button
          mat-button
          (click)="actions.chooseDestination(t, 'WEEK', target)"
        >
          {{ 'PLANSTRAND.CHOOSE_WEEK' | translate }}
        </button>
        <button
          mat-button
          (click)="actions.plan(t, 'UNPLAN'); closeActions(menu)"
        >
          {{ 'PLANSTRAND.UNPLAN' | translate }}
        </button>
        <h3>{{ 'PLANSTRAND.OTHER_ACTIONS' | translate }}</h3>
        <button
          mat-button
          (click)="actions.schedule(t)"
        >
          {{ 'PLANSTRAND.SCHEDULE_SESSION' | translate }}
        </button>
      </div>
    </details>
  `,
  styles: `
    :host {
      display: contents;
    }
    .task-actions {
      position: absolute;
      inset-inline-end: 0;
      top: 12px;
      z-index: 3;
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
    @media (pointer: coarse) {
      summary {
        min-height: 44px;
        min-width: 44px;
      }
    }
  `,
})
export class TaskPlanningMenuComponent {
  readonly task = input.required<TaskWithSubTasks>();
  readonly path = input('');
  readonly actions = inject(TASK_ROW_MENU_ACTIONS);
  private readonly taskFocus = inject(TaskFocusService);
  readonly quickPlanningActions = [
    { target: 'TODAY', label: 'PLANSTRAND.PLAN_TODAY' },
    { target: 'TOMORROW', label: 'PLANSTRAND.PLAN_TOMORROW' },
    { target: 'WEEK', label: 'PLANSTRAND.MOVE_THIS_WEEK' },
    { target: 'NEXT_WEEK', label: 'PLANSTRAND.MOVE_NEXT_WEEK' },
  ];
  revealActions(menu: HTMLDetailsElement): void {
    if (!menu.open) return;
    this.taskFocus.closeActiveTaskContextMenu()?.();
    requestAnimationFrame(() => {
      if (menu.open) {
        menu.querySelector('summary')?.focus();
        menu.querySelector('.commands')?.scrollIntoView({ block: 'nearest' });
      }
    });
  }
  closeActions(menu: HTMLDetailsElement): void {
    menu.open = false;
    menu.querySelector('summary')?.focus();
  }
}
