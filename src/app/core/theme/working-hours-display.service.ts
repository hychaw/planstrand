import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import { isValidSplitTime } from '../../util/is-valid-split-time';
import { getHoursFromClockString } from '../../util/get-hours-from-clock-string';

const KEY = 'PLANSTRAND_SHOW_WORKING_HOURS';

/** Explicit device-local display opt-in; legacy scheduler defaults are not consent. */
@Injectable({ providedIn: 'root' })
export class WorkingHoursDisplayService {
  private readonly _document = inject(DOCUMENT);
  readonly enabled = signal(false);
  hoursFor(cfg?: {
    workStart: string;
    workEnd: string;
  }): { workStart: number; workEnd: number } | null {
    return this.enabled() &&
      cfg &&
      isValidSplitTime(cfg.workStart) &&
      isValidSplitTime(cfg.workEnd)
      ? {
          workStart: getHoursFromClockString(cfg.workStart),
          workEnd: getHoursFromClockString(cfg.workEnd),
        }
      : null;
  }
  constructor() {
    try {
      this.enabled.set(this._document.defaultView?.localStorage.getItem(KEY) === 'true');
    } catch {
      /* Storage is optional. */
    }
  }
  setEnabled(enabled: boolean): void {
    this.enabled.set(enabled);
    try {
      this._document.defaultView?.localStorage.setItem(KEY, String(enabled));
    } catch {
      /* Session-only when storage is unavailable. */
    }
  }
}
