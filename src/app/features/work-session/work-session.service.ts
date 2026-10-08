import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { GlobalConfigService } from '../config/global-config.service';
import { isValidIanaTimeZone, resolveIanaTimeZone } from '../../util/iana-time-zone';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import {
  addWorkSession,
  completeWorkSession,
  removeWorkSession,
  uncompleteWorkSession,
  updateWorkSession,
} from './store/work-session.actions';
import { selectWorkSessionEntities } from './store/work-session.selectors';
import { WorkSession, WorkSessionUpdate } from './work-session.model';
import { Task } from '../tasks/task.model';
import {
  isDeterministicLegacyTaskWorkSessionId,
  legacyTaskWorkSessionId,
} from './legacy-task-work-session-backfill';

// Lookup only for sessions created by older clients / V1 migration. New scheduling
// intents have independent identities; moving a session requires its explicit ID.
export const taskScheduledWorkSessionId = (
  task: Pick<Task, 'id' | 'dueWithTime'>,
): string =>
  typeof task.dueWithTime === 'number'
    ? legacyTaskWorkSessionId(task.id, task.dueWithTime)
    : `task-schedule:${task.id.length}:${task.id}`;

@Injectable({ providedIn: 'root' })
export class WorkSessionService {
  private readonly _store = inject(Store);
  private readonly _config = inject(GlobalConfigService);
  private readonly _tasks = this._store.selectSignal(selectTaskEntities);
  private readonly _sessions = this._store.selectSignal(selectWorkSessionEntities);

  scheduledTaskSession(task: Pick<Task, 'id' | 'dueWithTime'>): WorkSession | undefined {
    const session = this._sessions()[taskScheduledWorkSessionId(task)];
    if (session?.taskId === task.id) return session;
    // Preserve the Task dialog's existing prefill when there is one unambiguous
    // reservation. This lookup never chooses a session to move or replace.
    const sessions = Object.values(this._sessions()).filter((s) => s?.taskId === task.id);
    return sessions.length === 1 ? sessions[0] : undefined;
  }

  scheduleTask(
    task: Pick<Task, 'id' | 'dueWithTime' | 'timeEstimate'>,
    start: number,
    fallbackDuration?: number,
  ): boolean {
    const duration =
      Number.isFinite(task.timeEstimate) && task.timeEstimate > 0
        ? task.timeEstimate
        : fallbackDuration;
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0)
      return false;
    return !!this.create(task.id, start, start + duration);
  }

  create(
    taskId: string,
    start: number,
    end: number,
    timeZone?: string | null,
    id = nanoid(),
  ): string | null {
    if (this._tasks()[taskId]?.id !== taskId || !this._isValidRange(start, end))
      return null;
    const resolvedTimeZone = resolveIanaTimeZone(
      timeZone ?? this._config.localization()?.timeZone,
    );
    if (!resolvedTimeZone) return null;
    if (this._sessions()[id]) return null;
    const now = Date.now();
    this._store.dispatch(
      addWorkSession({
        workSession: {
          id,
          taskId,
          start,
          end,
          timeZone: resolvedTimeZone,
          created: now,
          modified: now,
        },
      }),
    );
    return id;
  }

  update(id: string, changes: WorkSessionUpdate): boolean {
    const current = this._sessions()[id];
    if (!current) return false;
    if (
      Object.hasOwn(changes, 'timeZone') &&
      (typeof changes.timeZone !== 'string' || !isValidIanaTimeZone(changes.timeZone))
    )
      return false;
    const taskId = changes.taskId ?? current.taskId;
    const start = changes.start ?? current.start;
    const end = changes.end ?? current.end;
    if (this._tasks()[taskId]?.id !== taskId || !this._isValidRange(start, end))
      return false;
    this._store.dispatch(
      updateWorkSession({
        id,
        changes,
        modified: Date.now(),
        ...this._legacySessionSeed(current),
      }),
    );
    return true;
  }

  remove(id: string): boolean {
    if (!this._sessions()[id]) return false;
    this._store.dispatch(removeWorkSession({ id }));
    return true;
  }

  complete(id: string, completedAt = Date.now()): boolean {
    const current = this._sessions()[id];
    if (!current || !this._isTimestamp(completedAt)) return false;
    this._store.dispatch(
      completeWorkSession({
        id,
        completedAt,
        modified: Date.now(),
        ...this._legacySessionSeed(current),
      }),
    );
    return true;
  }

  uncomplete(id: string): boolean {
    const current = this._sessions()[id];
    if (!current) return false;
    this._store.dispatch(
      uncompleteWorkSession({
        id,
        modified: Date.now(),
        ...this._legacySessionSeed(current),
      }),
    );
    return true;
  }

  private _legacySessionSeed(current: WorkSession): { legacySession?: WorkSession } {
    return isDeterministicLegacyTaskWorkSessionId(current.id)
      ? { legacySession: current }
      : {};
  }

  private _isValidRange(start: number, end: number): boolean {
    return this._isTimestamp(start) && this._isTimestamp(end) && end > start;
  }

  private _isTimestamp(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
  }
}
