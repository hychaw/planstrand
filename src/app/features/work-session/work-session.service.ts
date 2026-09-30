import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import {
  addWorkSession,
  completeWorkSession,
  removeWorkSession,
  uncompleteWorkSession,
  updateWorkSession,
} from './store/work-session.actions';
import { selectWorkSessionEntities } from './store/work-session.selectors';
import { WorkSessionUpdate } from './work-session.model';

@Injectable({ providedIn: 'root' })
export class WorkSessionService {
  private readonly _store = inject(Store);
  private readonly _tasks = this._store.selectSignal(selectTaskEntities);
  private readonly _sessions = this._store.selectSignal(selectWorkSessionEntities);

  create(taskId: string, start: number, end: number): string | null {
    if (this._tasks()[taskId]?.id !== taskId || !this._isValidRange(start, end))
      return null;
    const id = nanoid();
    const now = Date.now();
    this._store.dispatch(
      addWorkSession({
        workSession: {
          id,
          taskId,
          start,
          end,
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
    const taskId = changes.taskId ?? current.taskId;
    const start = changes.start ?? current.start;
    const end = changes.end ?? current.end;
    if (this._tasks()[taskId]?.id !== taskId || !this._isValidRange(start, end))
      return false;
    this._store.dispatch(updateWorkSession({ id, changes, modified: Date.now() }));
    return true;
  }

  remove(id: string): boolean {
    if (!this._sessions()[id]) return false;
    this._store.dispatch(removeWorkSession({ id }));
    return true;
  }

  complete(id: string, completedAt = Date.now()): boolean {
    if (!this._sessions()[id] || !this._isTimestamp(completedAt)) return false;
    this._store.dispatch(completeWorkSession({ id, completedAt, modified: Date.now() }));
    return true;
  }

  uncomplete(id: string): boolean {
    if (!this._sessions()[id]) return false;
    this._store.dispatch(uncompleteWorkSession({ id, modified: Date.now() }));
    return true;
  }

  private _isValidRange(start: number, end: number): boolean {
    return this._isTimestamp(start) && this._isTimestamp(end) && end > start;
  }

  private _isTimestamp(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
  }
}
