import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { Store } from '@ngrx/store';
import { OccurrenceKey, isValidOccurrenceKey } from '../../routines/occurrence-key';
import { OccurrenceExceptionService } from '../../routines/occurrence-exception.service';
import { occurrenceExceptionId } from '../../routines/occurrence-exception.validation';
import { selectEventSeriesEntities } from '../../routines/store/event-series.selectors';
import { resolveEventOccurrence } from '../../routines/resolve-event-occurrence';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { DateService } from '../../../core/date/date.service';
import { GlobalConfigService } from '../../config/global-config.service';
import {
  resolveIanaTimeZone,
  zonedDateTimeFields,
  zonedDateTimeToTimestamp,
} from '../../../util/iana-time-zone';
import { isValidDBDateStr } from '../../../util/get-db-date-str';
import { EventInput } from '../event.model';
import { EventService } from '../event.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { firstValueFrom } from 'rxjs';

export interface EventDialogData {
  id?: string;
  date?: string;
  start?: number;
  occurrence?: OccurrenceKey;
}
@Component({
  selector: 'dialog-event',
  imports: [FormsModule, MatDialogModule, MatButtonModule, TranslatePipe, A11yModule],
  templateUrl: './dialog-event.component.html',
  styleUrl: './dialog-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogEventComponent {
  readonly T = T;
  readonly data = inject<EventDialogData>(MAT_DIALOG_DATA);
  private readonly _events = inject(EventService);
  private readonly _ref = inject(MatDialogRef<DialogEventComponent>);
  private readonly _dialog = inject(MatDialog);
  private readonly _translate = inject(TranslateService);
  private readonly _exceptions = inject(OccurrenceExceptionService);
  private readonly _series = inject(Store).selectSignal(selectEventSeriesEntities);
  // Copy only ownership fields; never use an Event id or a day-slice timestamp.
  readonly occurrenceKey = this.data.occurrence
    ? { seriesId: this.data.occurrence.seriesId, slot: this.data.occurrence.slot }
    : undefined;
  readonly occurrence = computed(() => {
    const key = this.occurrenceKey;
    return key && isValidOccurrenceKey(key)
      ? resolveEventOccurrence(
          this._series()[key.seriesId],
          key,
          this._exceptions.entities()[occurrenceExceptionId(key)],
        )
      : null;
  });
  private readonly _initialOccurrence = this.occurrence();
  private readonly _existing = this.occurrenceKey
    ? this._initialOccurrence?.effective
    : this.data.id
      ? this._events.entities()[this.data.id]
      : undefined;
  title = this._existing?.title ?? '';
  isAllDay = this._existing?.isAllDay ?? false;
  private readonly _configuredTimeZone =
    inject(GlobalConfigService).localization()?.timeZone;
  timeZone =
    this._existing && !this._existing.isAllDay
      ? this._existing.timeZone
      : this._initialOccurrence && !this._initialOccurrence.original.isAllDay
        ? this._initialOccurrence.original.timeZone
        : (resolveIanaTimeZone(this._configuredTimeZone) ??
          (this._configuredTimeZone ? '' : 'UTC'));
  date = this._existing?.isAllDay
    ? this._existing.date
    : (this.data.date ?? inject(DateService).todayStr());
  startTime = '09:00';
  endDate = this.date;
  endTime = '10:00';
  invalid = false;
  constructor() {
    const event = this._existing;
    const start = event && !event.isAllDay ? event.start : this.data.start;
    if (start !== undefined && this.timeZone) {
      const a = zonedDateTimeFields(start, this.timeZone);
      const b = zonedDateTimeFields(
        event && !event.isAllDay ? event.end : start + 3600000,
        this.timeZone,
      );
      this.date = a.date;
      this.startTime = a.time;
      this.endDate = b.date;
      this.endTime = b.time;
    }
  }
  save(): void {
    this.invalid = false;
    if (
      this.occurrenceKey &&
      (!this.occurrence() || this.occurrence()?.kind === 'cancelled')
    ) {
      this.invalid = true;
      return;
    }
    let input: EventInput;
    if (this.isAllDay)
      input = { title: this.title.trim(), isAllDay: true, date: this.date };
    else {
      const original =
        this._existing && !this._existing.isAllDay ? this._existing : undefined;
      const start = this._editedInstant(this.date, this.startTime, original?.start);
      const end = this._editedInstant(this.endDate, this.endTime, original?.end);
      if (
        !isValidDBDateStr(this.date) ||
        !isValidDBDateStr(this.endDate) ||
        start === null ||
        end === null
      ) {
        this.invalid = true;
        return;
      }
      input = {
        title: this.title.trim(),
        isAllDay: false,
        start,
        end,
        timeZone: this.timeZone,
      };
    }
    const saved = this.occurrenceKey
      ? this._exceptions.edit(this.occurrenceKey, input)
      : this.data.id
        ? this._events.update(this.data.id, input)
        : this._events.create(input);
    if (saved) this._ref.close(true);
    else this.invalid = true;
  }
  private _editedInstant(date: string, time: string, original?: number): number | null {
    // Preserve seconds and the repeated-hour choice when only title/other fields changed.
    if (
      original !== undefined &&
      this._existing &&
      !this._existing.isAllDay &&
      this.timeZone === this._existing.timeZone
    ) {
      const fields = zonedDateTimeFields(original, this.timeZone);
      if (fields.date === date && fields.time === time) return original;
    }
    return zonedDateTimeToTimestamp(date, time, this.timeZone);
  }
  async remove(): Promise<void> {
    if (this.occurrenceKey || !this.data.id) return;
    const confirmed = await firstValueFrom(
      this._dialog
        .open(DialogConfirmComponent, {
          data: {
            message: this._translate.instant(T.F.EVENT.DELETE_CONFIRM),
            cancelTxt: T.G.CANCEL,
            okTxt: T.G.DELETE,
          },
        })
        .afterClosed(),
    );
    if (confirmed && this._events.remove(this.data.id)) this._ref.close(true);
  }

  async cancelOccurrence(): Promise<void> {
    const key = this.occurrenceKey;
    if (!key || !this.occurrence() || this.occurrence()?.kind === 'cancelled') return;
    const confirmed = await firstValueFrom(
      this._dialog
        .open(DialogConfirmComponent, {
          data: {
            message: this._translate.instant(T.F.EVENT.CANCEL_OCCURRENCE_CONFIRM),
            cancelTxt: T.G.CANCEL,
            okTxt: T.F.EVENT.CANCEL_OCCURRENCE,
          },
        })
        .afterClosed(),
    );
    if (confirmed && this.occurrence() && this._exceptions.cancel(key))
      this._ref.close(true);
  }

  restoreOccurrence(): void {
    const key = this.occurrenceKey;
    const current = this.occurrence();
    if (key && current && current.kind !== 'inherit' && this._exceptions.restore(key))
      this._ref.close(true);
  }
}
