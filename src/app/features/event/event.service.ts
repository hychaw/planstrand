import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { EventInput } from './event.model';
import { isValidEvent } from './store/event.reducer';
import { selectEventEntities } from './store/event.selectors';
import { addEvent, updateEvent, removeEvent } from './store/event.actions';
@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly _store = inject(Store);
  readonly entities = this._store.selectSignal(selectEventEntities);
  create(input: EventInput): string | null {
    const now = Date.now();
    const event = { ...input, id: nanoid(), created: now, modified: now };
    if (!isValidEvent(event)) return null;
    this._store.dispatch(addEvent({ event }));
    return event.id;
  }
  update(id: string, changes: EventInput): boolean {
    const current = this.entities()[id];
    const modified = Date.now();
    if (!current || !isValidEvent({ ...changes, id, created: current.created, modified }))
      return false;
    this._store.dispatch(updateEvent({ id, changes, modified }));
    return true;
  }
  move(id: string, start: number): boolean {
    const current = this.entities()[id];
    if (!current || current.isAllDay) return false;
    return this.update(id, {
      title: current.title,
      isAllDay: false,
      start,
      end: start + current.end - current.start,
      timeZone: current.timeZone,
    });
  }
  resize(id: string, end: number): boolean {
    const current = this.entities()[id];
    if (!current || current.isAllDay) return false;
    return this.update(id, {
      title: current.title,
      isAllDay: false,
      start: current.start,
      end,
      timeZone: current.timeZone,
    });
  }
  remove(id: string): boolean {
    if (!this.entities()[id]) return false;
    this._store.dispatch(removeEvent({ id }));
    return true;
  }
}
