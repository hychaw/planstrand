import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { EventSeries, EventSeriesInput } from './event-series.model';
import { isValidEventSeriesInput } from './event-series.validation';
import { selectEventSeriesEntities } from './store/event-series.selectors';
import { addEventSeries, updateEventSeries } from './store/event-series.actions';

@Injectable({ providedIn: 'root' })
export class EventSeriesService {
  private readonly _store = inject(Store);
  readonly entities = this._store.selectSignal(selectEventSeriesEntities);

  create(input: EventSeriesInput): string | null {
    if (!isValidEventSeriesInput(input)) return null;
    const now = Date.now();
    const eventSeries: EventSeries = {
      id: nanoid(),
      title: input.title,
      created: now,
      modified: now,
      segments: [
        {
          id: nanoid(),
          recurrence: structuredClone(input.recurrence),
          timing: structuredClone(input.timing),
        },
      ],
    };
    this._store.dispatch(addEventSeries({ eventSeries }));
    return eventSeries.id;
  }

  update(id: string, changes: EventSeriesInput): boolean {
    const current = this.entities()[id];
    if (!current || !isValidEventSeriesInput(changes)) return false;
    this._store.dispatch(
      updateEventSeries({
        id,
        changes: structuredClone(changes),
        modified: Math.max(Date.now(), current.created),
      }),
    );
    return true;
  }
}
