import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { OccurrenceExceptionService } from '../occurrence-exception.service';
import { selectEventSeriesEntities } from '../store/event-series.selectors';
import {
  resolveEventOccurrence,
  ResolvedEventOccurrence,
} from '../resolve-event-occurrence';
import { OccurrenceKey } from '../occurrence-key';
import { occurrenceExceptionId } from '../occurrence-exception.validation';
import { zonedDateTimeFields } from '../../../util/iana-time-zone';

@Component({
  selector: 'dialog-cancelled-occurrences',
  imports: [FormsModule, A11yModule, MatButtonModule, MatDialogModule, TranslatePipe],
  templateUrl: './dialog-cancelled-occurrences.component.html',
  styleUrl: './dialog-cancelled-occurrences.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogCancelledOccurrencesComponent {
  readonly T = T;
  readonly search = signal('');
  private readonly _exceptions = inject(OccurrenceExceptionService);
  private readonly _series = inject(Store).selectSignal(selectEventSeriesEntities);
  private readonly _ref = inject(MatDialogRef<DialogCancelledOccurrencesComponent>);
  private readonly _cancelled = computed(() =>
    Object.values(this._exceptions.entities())
      .flatMap((exception) => {
        if (!exception || exception.value.kind !== 'cancelled') return [];
        const key = { seriesId: exception.seriesId, slot: exception.slot };
        const occurrence = resolveEventOccurrence(
          this._series()[key.seriesId],
          key,
          exception,
        );
        return occurrence
          ? [{ id: exception.id, key, occurrence, timing: this.timing(occurrence) }]
          : [];
      })
      .sort(
        (a, b) =>
          a.occurrence.scheduledDate.localeCompare(b.occurrence.scheduledDate) ||
          a.id.localeCompare(b.id),
      ),
  );
  readonly entries = computed(() => {
    const search = this.search().trim().toLocaleLowerCase();
    return this._cancelled().filter((entry) =>
      `${entry.occurrence.original.title} ${entry.timing}`
        .toLocaleLowerCase()
        .includes(search),
    );
  });

  private timing(occurrence: ResolvedEventOccurrence): string {
    const event = occurrence.original;
    if (event.isAllDay) return event.date;
    const start = zonedDateTimeFields(event.start, event.timeZone);
    const end = zonedDateTimeFields(event.end, event.timeZone);
    return `${start.date} ${start.time} – ${end.date} ${end.time} (${event.timeZone})`;
  }

  restore(key: OccurrenceKey): void {
    const exception = this._exceptions.entities()[occurrenceExceptionId(key)];
    if (
      exception?.value.kind !== 'cancelled' ||
      !resolveEventOccurrence(this._series()[key.seriesId], key, exception)
    )
      return;
    // The dialog closes so Material restores focus to the persistent toolbar
    // button, even though restoring removes this row from the cancelled list.
    if (this._exceptions.restore(key)) this._ref.close(true);
  }
}
