import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { getDbDateStr } from '../../util/get-db-date-str';
import { getStartOfNextDayDiffMs } from '../../util/start-of-next-day.util';

@Injectable({ providedIn: 'root' })
export class DateService {
  private startOfNextDayDiff: number = 0;
  private _startOfNextDayDiffChange$ = new Subject<void>();

  readonly startOfNextDayDiffChange$ = this._startOfNextDayDiffChange$.asObservable();

  setStartOfNextDayDiff(
    startOfNextDayTimeOrHour: string | number | undefined,
    legacyStartOfNextDay?: number,
  ): void {
    const startOfNextDayTime =
      typeof startOfNextDayTimeOrHour === 'string' ? startOfNextDayTimeOrHour : undefined;
    const startOfNextDay =
      typeof startOfNextDayTimeOrHour === 'number'
        ? startOfNextDayTimeOrHour
        : legacyStartOfNextDay;

    const nextStartOfNextDayDiff = getStartOfNextDayDiffMs(
      startOfNextDayTime,
      startOfNextDay,
    );
    if (this.startOfNextDayDiff === nextStartOfNextDayDiff) {
      return;
    }

    this.startOfNextDayDiff = nextStartOfNextDayDiff;
    this._startOfNextDayDiffChange$.next();
  }

  /**
   * Returns a Date representing "logical today" — Date.now() shifted backwards by
   * the start-of-next-day offset, so callers can ask "what day does this moment belong to?".
   * The returned Date's local-date components (year/month/day) are the logical day.
   */
  getLogicalTodayDate(): Date {
    return new Date(Date.now() - this.startOfNextDayDiff);
  }

  /**
   * Returns a timestamp on "logical tomorrow" (logical today + 1 calendar day).
   * Uses local-date arithmetic (setDate) so day advancement is correct across DST
   * transitions — a naive +24h would stay on the same local date during a fall-back.
   */
  getLogicalTomorrowMs(): number {
    const d = new Date(Date.now() - this.startOfNextDayDiff);
    d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  /**
   * Read-only accessor for the raw offset in ms.
   * Pure utilities (reducers, selectors) need this value as an argument.
   */
  getStartOfNextDayDiffMs(): number {
    return this.startOfNextDayDiff;
  }

  /**
   * Current system-local calendar date. Legacy workday offsets must never shift
   * Planstrand Today or the absolute date captured by a Planning command.
   */
  todayStr(date?: Date | number): string {
    return getDbDateStr(date ?? Date.now());
  }

  isToday(date: number | Date): boolean {
    const ts = typeof date === 'number' ? date : date.getTime();
    return getDbDateStr(ts) === this.todayStr();
  }

  isYesterday(date: number | Date): boolean {
    const ts = typeof date === 'number' ? date : date.getTime();
    const yesterday = new Date(Date.now());
    yesterday.setDate(yesterday.getDate() - 1);
    return getDbDateStr(ts) === getDbDateStr(yesterday);
  }
}
