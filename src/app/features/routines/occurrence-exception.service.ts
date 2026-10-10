import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { EventInput } from '../event/event.model';
import { OccurrenceKey, isValidOccurrenceKey } from './occurrence-key';
import { OccurrenceExceptionValue } from './occurrence-exception.model';
import {
  occurrenceExceptionId,
  isValidOccurrenceExceptionValue,
} from './occurrence-exception.validation';
import { setOccurrenceException } from './store/occurrence-exception.actions';
import { selectOccurrenceExceptionEntities } from './store/occurrence-exception.selectors';

@Injectable({ providedIn: 'root' })
export class OccurrenceExceptionService {
  private readonly _store = inject(Store);
  readonly entities = this._store.selectSignal(selectOccurrenceExceptionEntities);

  edit(key: OccurrenceKey, event: EventInput): boolean {
    return this._set(key, { kind: 'override', event });
  }
  cancel(key: OccurrenceKey): boolean {
    return this._set(key, { kind: 'cancelled' });
  }
  restore(key: OccurrenceKey): boolean {
    return this._set(key, { kind: 'inherit' });
  }
  updateOverride(key: OccurrenceKey, event: EventInput): boolean {
    if (
      !isValidOccurrenceKey(key) ||
      this.entities()[occurrenceExceptionId(key)]?.value.kind !== 'override'
    )
      return false;
    return this.edit(key, event);
  }
  private _set(key: OccurrenceKey, value: OccurrenceExceptionValue): boolean {
    if (!isValidOccurrenceKey(key) || !isValidOccurrenceExceptionValue(value))
      return false;
    this._store.dispatch(
      setOccurrenceException({
        occurrenceException: {
          id: occurrenceExceptionId(key),
          seriesId: key.seriesId,
          slot: key.slot,
          value: structuredClone(value),
          modified: Date.now(),
        },
      }),
    );
    return true;
  }
}
