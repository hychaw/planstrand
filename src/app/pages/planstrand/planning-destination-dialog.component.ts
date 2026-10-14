import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { DatePickerInputComponent } from '../../ui/date-picker-input/date-picker-input.component';
import { selectLocalizationConfig } from '../../features/config/store/global-config.reducer';
import { planningWeekStart } from '../../features/planning/planning-commands';
import { getDbDateStr } from '../../util/get-db-date-str';
import { PlanningPlacement } from '../../features/planning/planning.model';

@Component({
  selector: 'planstrand-planning-destination-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    TranslatePipe,
    DatePickerInputComponent,
  ],
  template: `
    <h2 mat-dialog-title>
      {{
        (data.type === 'DAY' ? 'PLANSTRAND.CHOOSE_DATE' : 'PLANSTRAND.CHOOSE_WEEK')
          | translate
      }}
    </h2>
    <mat-dialog-content>
      <date-picker-input
        [label]="'PLANSTRAND.WHEN' | translate"
        [ngModel]="selected()"
        (ngModelChange)="selected.set($event)"
        [required]="true"
      />
      @if (data.type === 'WEEK' && week()) {
        <p>
          {{ 'PLANSTRAND.WEEK_OF' | translate: { date: (week() | date: 'MMM d, y') } }}
        </p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        (click)="dialog.close()"
      >
        {{ 'G.CANCEL' | translate }}
      </button>
      <button
        mat-flat-button
        [disabled]="!validDate()"
        (click)="save()"
      >
        {{ 'G.SAVE' | translate }}
      </button>
    </mat-dialog-actions>
  `,
})
export class PlanningDestinationDialogComponent {
  readonly data = inject<{ type: 'DAY' | 'WEEK'; date: string }>(MAT_DIALOG_DATA);
  readonly dialog =
    inject<MatDialogRef<PlanningDestinationDialogComponent, PlanningPlacement['target']>>(
      MatDialogRef,
    );
  private readonly localization = inject(Store).selectSignal(selectLocalizationConfig);
  readonly selected = signal<Date | null>(new Date(this.data.date + 'T12:00:00'));
  readonly validDate = computed(() => {
    const date = this.selected();
    return date && Number.isFinite(date.getTime()) ? date : null;
  });
  readonly week = computed(() =>
    this.validDate()
      ? planningWeekStart(
          getDbDateStr(this.validDate()!),
          this.localization().firstDayOfWeek ?? 1,
        )
      : '',
  );
  save(): void {
    const date = this.validDate();
    if (date)
      this.dialog.close({
        type: this.data.type,
        key: this.data.type === 'WEEK' ? this.week() : getDbDateStr(date),
      });
  }
}
