import { inject, Injectable, Injector, signal, Signal } from '@angular/core';
import { Dictionary } from '@ngrx/entity';
import { Store } from '@ngrx/store';
import { filter, take } from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { NotifyService } from '../../core/notify/notify.service';
import { Log } from '../../core/log';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { GlobalConfigService } from '../config/global-config.service';
import { selectEventEntities } from '../event/store/event.selectors';
import { selectWorkSessionEntities } from '../work-session/store/work-session.selectors';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { T } from '../../t.const';
import { LocalEvent } from '../event/event.model';
import { WorkSession } from '../work-session/work-session.model';
import { Task } from '../tasks/task.model';

export const LOCAL_SCHEDULE_REMINDER_KEY = 'planstrand_local_schedule_reminders_v1';
export const SCHEDULE_REMINDER_GRACE_MS = 2 * 60 * 1000;
export type ScheduleReminderKind = 'event' | 'workSession';
export type ScheduleReminderOffset = 0 | 5 | 10 | 15 | 30 | 60;
export const SCHEDULE_REMINDER_OPTIONS = [
  { value: null, label: T.F.TASK.D_SCHEDULE_TASK.RO_NEVER },
  { value: 0, label: T.F.TASK.D_SCHEDULE_TASK.RO_START },
  { value: 5, label: T.F.TASK.D_SCHEDULE_TASK.RO_5M },
  { value: 10, label: T.F.TASK.D_SCHEDULE_TASK.RO_10M },
  { value: 15, label: T.F.TASK.D_SCHEDULE_TASK.RO_15M },
  { value: 30, label: T.F.TASK.D_SCHEDULE_TASK.RO_30M },
  { value: 60, label: T.F.TASK.D_SCHEDULE_TASK.RO_1H },
] as const;

interface Preference {
  offset: ScheduleReminderOffset | null;
  // Keep consumed instants even while Off, so toggling cannot replay a reminder.
  consumed: number[];
}
type Preferences = Record<string, Preference>;
interface ReminderRuntime {
  events: Signal<Dictionary<LocalEvent>>;
  sessions: Signal<Dictionary<WorkSession>>;
  tasks: Signal<Dictionary<Task>>;
  config: GlobalConfigService;
  imex: ImexViewService;
}

/** Device preferences only: never part of entities, operations, sync or JSON backups. */
@Injectable({ providedIn: 'root' })
export class LocalScheduleReminderService {
  private readonly _injector = inject(Injector);
  private _runtime?: ReminderRuntime;
  private readonly _preferences = signal<Preferences>(this._load());
  private _ready = false;
  private _initialized = false;

  init(): void {
    if (this._initialized) return;
    this._initialized = true;
    this._runtime = this._createRuntime();
    this._injector
      .get(DataInitStateService)
      .isAllDataLoadedInitially$.pipe(filter(Boolean), take(1))
      .subscribe(() => (this._ready = true));
  }

  offset(kind: ScheduleReminderKind, id: string): ScheduleReminderOffset | null {
    return this._preferences()[this._key(kind, id)]?.offset ?? null;
  }

  set(
    kind: ScheduleReminderKind,
    id: string,
    offset: ScheduleReminderOffset | null,
  ): boolean {
    if (!id || !SCHEDULE_REMINDER_OPTIONS.some((option) => option.value === offset))
      return false;
    const key = this._key(kind, id);
    if (offset === null && !this._preferences()[key]) return true;
    return this._save({
      ...this._preferences(),
      [key]: { offset, consumed: this._preferences()[key]?.consumed ?? [] },
    });
  }

  /** Called by the existing reminder worker, including its first tick after resume. */
  checkDue(now = Date.now()): void {
    if (!this._canDeliver()) return;
    for (const [key, preference] of Object.entries(this._preferences())) {
      if (preference.offset === null) continue;
      const current = this._current(key, preference.offset);
      if (
        !current ||
        current.remindAt > now ||
        preference.consumed.includes(current.remindAt)
      )
        continue;
      // Persist before calling the asynchronous notification API. On storage failure,
      // fail closed rather than sending something that may repeat after restart.
      if (
        !this._save({
          ...this._preferences(),
          [key]: {
            ...preference,
            consumed: [
              ...preference.consumed.filter(
                (at) => at >= now - SCHEDULE_REMINDER_GRACE_MS,
              ),
              current.remindAt,
            ],
          },
        })
      )
        continue;
      if (now - current.remindAt > SCHEDULE_REMINDER_GRACE_MS) continue;
      const stillCurrent = (): boolean => {
        const offset = this._preferences()[key]?.offset;
        const latest = offset == null ? undefined : this._current(key, offset);
        return (
          this._canDeliver() &&
          latest?.remindAt === current.remindAt &&
          latest.title === current.title &&
          Date.now() >= current.remindAt &&
          Date.now() - current.remindAt <= SCHEDULE_REMINDER_GRACE_MS
        );
      };
      void this._injector
        .get(NotifyService)
        .notifyDesktop(
          {
            title: current.title,
            body: T.F.TASK.ADDITIONAL_INFO.REMINDER,
            // The durable consumed record already deduplicates this occurrence.
            // Electron passes Chromium's tag-based ID to Windows, where long
            // entity/instant tags exceed the native toast tag limit and fail.
          },
          stillCurrent,
        )
        .catch((error) => Log.err('Schedule reminder delivery failed', error));
    }
  }

  private _canDeliver(): boolean {
    return (
      this._ready &&
      !this._runtime!.imex.isDataImportInProgress &&
      !this._runtime!.config.cfg()?.reminder?.disableReminders
    );
  }

  private _current(
    key: string,
    offset: ScheduleReminderOffset,
  ): { remindAt: number; title: string } | undefined {
    const offsetMs = offset * 60000;
    if (key.startsWith('event:')) {
      const event = this._runtime!.events()[key.slice(6)];
      if (event && !event.isAllDay)
        return { remindAt: event.start - offsetMs, title: event.title };
    } else if (key.startsWith('workSession:')) {
      const session = this._runtime!.sessions()[key.slice(12)];
      const task = session && this._runtime!.tasks()[session.taskId];
      if (session && session.completedAt == null && task)
        return { remindAt: session.start - offsetMs, title: task.title };
    }
    return undefined;
  }

  private _key(kind: ScheduleReminderKind, id: string): string {
    return `${kind}:${id}`;
  }

  private _createRuntime(): ReminderRuntime {
    const store = this._injector.get(Store);
    return {
      events: store.selectSignal(selectEventEntities),
      sessions: store.selectSignal(selectWorkSessionEntities),
      tasks: store.selectSignal(selectTaskEntities),
      config: this._injector.get(GlobalConfigService),
      imex: this._injector.get(ImexViewService),
    };
  }

  private _load(): Preferences {
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(LOCAL_SCHEDULE_REMINDER_KEY) ?? '{}',
      );
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          ([key, value]) =>
            (key.startsWith('event:') || key.startsWith('workSession:')) &&
            value &&
            SCHEDULE_REMINDER_OPTIONS.some((option) => option.value === value.offset) &&
            Array.isArray(value.consumed) &&
            value.consumed.every(
              (at: unknown) => typeof at === 'number' && Number.isFinite(at),
            ),
        ),
      );
    } catch (error) {
      Log.err('Failed to read local schedule reminders', error);
      return {};
    }
  }

  private _save(preferences: Preferences): boolean {
    try {
      localStorage.setItem(LOCAL_SCHEDULE_REMINDER_KEY, JSON.stringify(preferences));
      this._preferences.set(preferences);
      return true;
    } catch (error) {
      Log.err('Failed to persist local schedule reminders', error);
      return false;
    }
  }
}
