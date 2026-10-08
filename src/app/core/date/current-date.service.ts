import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  Signal,
  signal,
  untracked,
} from '@angular/core';
import { BehaviorSubject, fromEvent, merge, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { IS_ELECTRON } from '../../app.constants';
import { ipcResume$ } from '../ipc-events';
import { getDbDateStr } from '../../util/get-db-date-str';
import {
  calendarAddDays,
  calendarDate,
  calendarDayStart,
} from '../../util/calendar-date';

/** One runtime clock for civil dates. Never persisted or recorded in the operation log. */
@Injectable({ providedIn: 'root' })
export class CurrentDateService {
  private readonly _now = signal(Date.now(), { equal: () => false });
  readonly now = this._now.asReadonly();
  readonly today = computed(() => getDbDateStr(this.now()));
  private readonly _today = new BehaviorSubject(this.today());
  readonly today$ = this._today.asObservable();
  private readonly _zones = new Map<object, string>();
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private readonly _active = new Subscription();

  constructor() {
    this._active.add(
      merge(
        fromEvent(window, 'focus'),
        fromEvent(document, 'visibilitychange').pipe(filter(() => !document.hidden)),
        ipcResume$.pipe(filter(() => IS_ELECTRON)),
      ).subscribe(() => this.refresh()),
    );
    this.refresh();
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this._timer);
      this._active.unsubscribe();
      this._today.complete();
    });
  }

  /** Read at user intent time, even if Chromium suspended the scheduled callback. */
  resolveToday(): string {
    this.refresh();
    return this.today();
  }

  /** Calendar display zones share the same clock, including their own midnight. */
  dateInZone(zone: Signal<string>): Signal<string> {
    const key = {};
    effect((onCleanup) => {
      this._zones.set(key, zone());
      untracked(() => this.refresh());
      onCleanup(() => this._zones.delete(key));
    });
    return computed(() => calendarDate(this.now(), zone()));
  }

  refresh(): void {
    const now = Date.now();
    this._now.set(now);
    const today = getDbDateStr(now);
    if (today !== this._today.value) this._today.next(today);
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    let next = midnight.getTime();
    for (const zone of this._zones.values()) {
      next = Math.min(
        next,
        calendarDayStart(calendarAddDays(calendarDate(now, zone), 1), zone),
      );
    }
    clearTimeout(this._timer);
    // No browser event exists for a system clock/timezone change. An hourly
    // checkpoint catches these while continuously foregrounded; focus/resume is immediate.
    this._timer = setTimeout(
      () => this.refresh(),
      Math.max(1, Math.min(next - now, 3600000)),
    );
  }
}
