import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { PlanningPlacement } from './planning.model';
import { Store } from '@ngrx/store';
import { selectAllPlacements } from './store/planning.selectors';
import { CurrentDateService } from '../../core/date/current-date.service';
import { calendarAddDays } from '../../util/calendar-date';

@Component({
  selector: 'planstrand-planning-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TranslatePipe],
  template: `
    <span
      role="group"
      class="planning-status"
      [attr.aria-label]="'PLANSTRAND.PLAN' | translate"
    >
      @if (!destination()) {
        {{ 'PLANSTRAND.UNPLANNED' | translate }}
      } @else if (destination()!.type === 'WEEK') {
        {{
          'PLANSTRAND.WEEK_OF'
            | translate: { date: (destination()!.key | date: 'MMM d, y') }
        }}
      } @else if (destination()!.key === today()) {
        {{ 'PLANSTRAND.TODAY' | translate }}
      } @else if (destination()!.key === tomorrow()) {
        {{ 'PLANSTRAND.TOMORROW' | translate }}
      } @else {
        {{ destination()!.key | date: 'MMM d, y' }}
      }
    </span>
  `,
  styles: `
    .planning-status {
      display: inline-block;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      background: var(--surface-selected);
      color: var(--ink);
      font-size: var(--font-size-sm);
    }
  `,
})
export class PlanningStatusComponent {
  readonly target = input<PlanningPlacement['target']>();
  readonly taskId = input<string>();
  private readonly placements = inject(Store).selectSignal(selectAllPlacements);
  readonly destination = computed(() =>
    this.taskId()
      ? this.placements().find((p) => p.id === this.taskId())?.target
      : this.target(),
  );
  readonly today = inject(CurrentDateService).today;
  readonly tomorrow = computed(() => calendarAddDays(this.today(), 1));
}
