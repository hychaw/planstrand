import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { isValidDBDateStr } from '../../../util/get-db-date-str';
import {
  isValidIanaTimeZone,
  zonedDateTimeFields,
  zonedDateTimeToTimestamp,
} from '../../../util/iana-time-zone';
import { selectWorkSessionEntities } from '../store/work-session.selectors';
import { WorkSessionService } from '../work-session.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { calendarDisplayZone } from '../../schedule/calendar-time';

@Component({
  selector: 'dialog-work-session',
  imports: [FormsModule, A11yModule, MatDialogModule, MatButtonModule, TranslatePipe],
  templateUrl: './dialog-work-session.component.html',
  styleUrl: '../../event/dialog-event/dialog-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogWorkSessionComponent {
  readonly T = T;
  readonly data = inject<{ id: string }>(MAT_DIALOG_DATA);
  private readonly _sessions = inject(Store).selectSignal(selectWorkSessionEntities);
  private readonly _service = inject(WorkSessionService);
  private readonly _ref = inject(MatDialogRef<DialogWorkSessionComponent>);
  private readonly _original = this._sessions()[this.data.id];
  readonly timeZone = calendarDisplayZone(
    inject(GlobalConfigService).localization()?.timeZone,
  );
  date = '';
  startTime = '';
  endDate = '';
  endTime = '';
  invalid = false;
  saved = false;

  constructor() {
    if (this._original && isValidIanaTimeZone(this.timeZone)) {
      const start = zonedDateTimeFields(this._original.start, this.timeZone);
      const end = zonedDateTimeFields(this._original.end, this.timeZone);
      this.date = start.date;
      this.startTime = start.time;
      this.endDate = end.date;
      this.endTime = end.time;
    }
  }

  save(): void {
    if (this.saved) return;
    this.invalid = false;
    const start = this._editedInstant(this.date, this.startTime, this._original?.start);
    const end = this._editedInstant(this.endDate, this.endTime, this._original?.end);
    if (
      !isValidDBDateStr(this.date) ||
      !isValidDBDateStr(this.endDate) ||
      start === null ||
      end === null ||
      end <= start ||
      !this._service.update(this.data.id, { start, end })
    ) {
      this.invalid = true;
      return;
    }
    this.saved = true;
    this._ref.close(true);
  }

  private _editedInstant(date: string, time: string, original?: number): number | null {
    if (!isValidIanaTimeZone(this.timeZone)) return null;
    // Keep seconds and the original repeated DST hour for an unchanged boundary.
    if (original !== undefined) {
      const fields = zonedDateTimeFields(original, this.timeZone);
      if (fields.date === date && fields.time === time) return original;
    }
    return zonedDateTimeToTimestamp(date, time, this.timeZone);
  }
}
