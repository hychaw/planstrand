import {
  ChangeDetectionStrategy,
  Component,
  inject,
  computed,
  signal,
} from '@angular/core';
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
import { EventSeriesService } from '../../routines/event-series.service';
import { EventSeriesInput, SeriesEditResult } from '../../routines/event-series.model';
import { segmentForSlot } from '../../routines/event-series-plan';

type EditScope = 'occurrence' | 'future' | 'series';
interface EditorDraft {
  title: string;
  isAllDay: boolean;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timeZone: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  weekdays: number[];
  recurrenceEndDate: string;
  durationMinutes: number;
}

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
  private readonly _seriesCommands = inject(EventSeriesService);
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
  scope: EditScope = 'occurrence';
  frequency: EditorDraft['frequency'] = 'daily';
  interval = 1;
  weekdays: number[] = [1];
  recurrenceEndDate = '';
  durationMinutes = 60;
  readonly busy = signal(false);
  readonly seriesError = signal<string | null>(null);
  readonly weekdayOptions = [
    T.F.EVENT.MONDAY,
    T.F.EVENT.TUESDAY,
    T.F.EVENT.WEDNESDAY,
    T.F.EVENT.THURSDAY,
    T.F.EVENT.FRIDAY,
    T.F.EVENT.SATURDAY,
    T.F.EVENT.SUNDAY,
  ];
  private readonly _drafts: Partial<Record<EditScope, EditorDraft>> = {};
  private readonly _baselines: Partial<Record<EditScope, EditorDraft>> = {};
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
    if (this.busy()) return;
    if (this.occurrenceKey && this.scope !== 'occurrence') {
      void this._saveSeries();
      return;
    }
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

  changeScope(scope: EditScope): void {
    if (this.busy() || !this.occurrenceKey || !this.occurrence()) return;
    this._drafts[this.scope] = this._draft();
    const draft = this._drafts[scope] ?? this._seriesDraft(scope);
    if (!draft) return;
    this._baselines[scope] ??= structuredClone(draft);
    Object.assign(this, structuredClone(draft));
    this.scope = scope;
    this.invalid = false;
    this.seriesError.set(null);
  }

  setWeekday(day: number, checked: boolean): void {
    this.weekdays = checked
      ? [...this.weekdays.filter((value) => value !== day), day].sort((a, b) => a - b)
      : this.weekdays.filter((value) => value !== day);
  }

  private _draft(): EditorDraft {
    const {
      title,
      isAllDay,
      date,
      startTime,
      endDate,
      endTime,
      timeZone,
      frequency,
      interval,
      weekdays,
      recurrenceEndDate,
      durationMinutes,
    } = this;
    return {
      title,
      isAllDay,
      date,
      startTime,
      endDate,
      endTime,
      timeZone,
      frequency,
      interval,
      weekdays: [...weekdays],
      recurrenceEndDate,
      durationMinutes,
    };
  }

  private _seriesDraft(scope: EditScope): EditorDraft | null {
    const key = this.occurrenceKey!;
    const series = this._series()[key.seriesId];
    const original = resolveEventOccurrence(series, key);
    if (!series || !original) return null;
    const segment =
      scope === 'series' ? series.segments[0] : segmentForSlot(series, key.slot)!;
    const { recurrence, timing } = segment;
    // Series defaults come from the schedule definition, never an occurrence override.
    return {
      ...this._draft(),
      title: scope === 'series' ? series.title : (segment.title ?? series.title),
      date: scope === 'series' ? recurrence.startDate : original.scheduledDate,
      isAllDay: timing.kind === 'allDay',
      startTime: timing.kind === 'timed' ? timing.localTime : '09:00',
      timeZone:
        timing.kind === 'timed'
          ? timing.timeZone
          : (resolveIanaTimeZone(this._configuredTimeZone) ?? 'UTC'),
      durationMinutes: timing.kind === 'timed' ? timing.durationMs / 60000 : 60,
      frequency: recurrence.frequency,
      interval: recurrence.interval,
      weekdays: recurrence.frequency === 'weekly' ? [...recurrence.weekdays] : [1],
      recurrenceEndDate: recurrence.endDate ?? '',
    };
  }

  private _seriesChanges(): Partial<EventSeriesInput> | null {
    const baseline = this._baselines[this.scope]!;
    const draft = this._draft();
    const changes: Partial<EventSeriesInput> = {};
    if (draft.title.trim() !== baseline.title) changes.title = draft.title.trim();
    if (!draft.title.trim()) return null;
    const recurrenceFields = (form: EditorDraft): unknown[] => [
      form.date,
      form.frequency,
      form.interval,
      form.recurrenceEndDate,
      form.frequency === 'weekly' ? form.weekdays : [],
    ];
    if (
      JSON.stringify(recurrenceFields(draft)) !==
      JSON.stringify(recurrenceFields(baseline))
    ) {
      changes.recurrence = {
        interval: this.interval,
        startDate: this.date,
        ...(this.recurrenceEndDate ? { endDate: this.recurrenceEndDate } : {}),
        ...(this.frequency === 'weekly'
          ? { frequency: 'weekly' as const, weekdays: [...this.weekdays] }
          : { frequency: this.frequency }),
      };
    }
    const timingFields = (form: EditorDraft): unknown[] =>
      form.isAllDay
        ? [true]
        : [false, form.startTime, form.timeZone, form.durationMinutes];
    if (JSON.stringify(timingFields(draft)) !== JSON.stringify(timingFields(baseline))) {
      changes.timing = this.isAllDay
        ? { kind: 'allDay' }
        : {
            kind: 'timed',
            localTime: this.startTime,
            timeZone: this.timeZone,
            durationMs: this.durationMinutes * 60000,
          };
    }
    if (
      (changes.recurrence || changes.timing) &&
      !this.isAllDay &&
      zonedDateTimeToTimestamp(this.date, this.startTime, this.timeZone) === null
    )
      return null;
    return changes;
  }

  private async _saveSeries(): Promise<void> {
    this.seriesError.set(null);
    const changes = this._seriesChanges();
    if (!changes) {
      this.seriesError.set(T.F.EVENT.SERIES_INVALID);
      return;
    }
    const key = this.occurrenceKey!;
    const scope = this.scope;
    const apply = (retain?: 'retain'): SeriesEditResult =>
      scope === 'series'
        ? this._seriesCommands.editEntire(key.seriesId, changes, retain)
        : this._seriesCommands.editThisAndFuture(key.seriesId, key.slot, changes, retain);
    let result = apply();
    if (!result.ok && result.reason === 'exception-decision-required') {
      this.busy.set(true);
      try {
        const confirmed = await this._confirm(
          T.F.EVENT.RETAIN_EXCEPTIONS_CONFIRM,
          T.F.EVENT.RETAIN_EXCEPTIONS,
        );
        if (!confirmed) return;
        result = apply('retain');
      } finally {
        this.busy.set(false);
      }
    }
    if (result.ok) this._ref.close(true);
    else
      this.seriesError.set(
        result.reason === 'invalid'
          ? T.F.EVENT.SERIES_INVALID
          : result.reason === 'atomic-clear-unsupported'
            ? T.F.EVENT.CLEAR_UNSUPPORTED
            : result.reason === 'exception-decision-required'
              ? T.F.EVENT.RETAIN_EXCEPTIONS_CONFIRM
              : T.F.EVENT.OCCURRENCE_UNAVAILABLE,
      );
  }

  private async _confirm(message: string, okTxt: string): Promise<boolean> {
    return !!(await firstValueFrom(
      this._dialog
        .open(DialogConfirmComponent, {
          data: { message, cancelTxt: T.G.CANCEL, okTxt },
        })
        .afterClosed(),
    ));
  }

  async deleteEntireSeries(): Promise<void> {
    if (!this.occurrenceKey || !this.occurrence() || this.busy()) return;
    this.busy.set(true);
    try {
      if (await this._confirm(T.F.EVENT.DELETE_SERIES_CONFIRM, T.F.EVENT.DELETE_SERIES)) {
        if (this._seriesCommands.deleteEntire(this.occurrenceKey.seriesId))
          this._ref.close(true);
        else this.seriesError.set(T.F.EVENT.OCCURRENCE_UNAVAILABLE);
      }
    } finally {
      this.busy.set(false);
    }
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
    if (this.busy()) return;
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
    if (this.busy()) return;
    const key = this.occurrenceKey;
    const current = this.occurrence();
    if (key && current && current.kind !== 'inherit' && this._exceptions.restore(key))
      this._ref.close(true);
  }
}
