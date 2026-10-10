import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import {
  EventSeries,
  EventSeriesInput,
  EventSeriesPlan,
  SeriesEditResult,
  SeriesExceptionDecision,
} from './event-series.model';
import {
  isValidEventSeriesInput,
  isValidEventSeriesPlan,
} from './event-series.validation';
import { selectEventSeriesEntities } from './store/event-series.selectors';
import {
  addEventSeries,
  replaceEventSeriesPlan,
  deleteEventSeries,
} from './store/event-series.actions';

import { selectOccurrenceExceptionEntities } from './store/occurrence-exception.selectors';
import { resolveEventOccurrence } from './resolve-event-occurrence';
import { segmentForSlot } from './event-series-plan';

@Injectable({ providedIn: 'root' })
export class EventSeriesService {
  private readonly _store = inject(Store);
  private readonly _exceptions = this._store.selectSignal(
    selectOccurrenceExceptionEntities,
  );
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

  /** Compatibility entry point; new callers can inspect the explicit failure reason. */
  update(id: string, changes: EventSeriesInput): boolean {
    return this.editEntire(id, changes).ok;
  }

  /** Schedule changes replace the complete plan with one segment at slot zero.
   * Omitted schedule fields use the first segment; no ambient zone/date is read.
   * Title-only changes preserve all schedule definitions and offsets.
   */
  editEntire(
    id: string,
    changes: Partial<EventSeriesInput>,
    decision?: SeriesExceptionDecision,
  ): SeriesEditResult {
    const current = this.entities()[id];
    if (!current || current.deletedAt !== undefined)
      return { ok: false, reason: 'unavailable' };
    const first = current.segments[0];
    const input = {
      title: current.title,
      recurrence: first.recurrence,
      timing: first.timing,
      ...changes,
    };
    if (!isValidEventSeriesInput(input)) return { ok: false, reason: 'invalid' };
    const scheduleChanged =
      ((changes.recurrence !== undefined || changes.timing !== undefined) &&
        current.segments.length > 1) ||
      (changes.recurrence !== undefined &&
        JSON.stringify(changes.recurrence) !== JSON.stringify(first.recurrence)) ||
      (changes.timing !== undefined &&
        JSON.stringify(changes.timing) !== JSON.stringify(first.timing));
    const plan: EventSeriesPlan = {
      title: input.title,
      segments: scheduleChanged
        ? [{ id: first.id, recurrence: input.recurrence, timing: input.timing }]
        : current.segments.map(({ title, ...segment }) => ({
            ...segment,
            ...(changes.title === undefined && title !== undefined ? { title } : {}),
          })),
    };
    return this._replace(current, plan, 0, decision);
  }

  /** The canonical key's slot is used even when its exception moved the event.
   * A revised recurrence explicitly supplies its new anchor. Otherwise timing
   * and title edits re-anchor the existing rule on the original scheduled date.
   */
  editThisAndFuture(
    id: string,
    slot: number,
    changes: Partial<EventSeriesInput>,
    decision?: SeriesExceptionDecision,
  ): SeriesEditResult {
    const current = this.entities()[id];
    if (!current || current.deletedAt !== undefined)
      return { ok: false, reason: 'unavailable' };
    const original = resolveEventOccurrence(current, { seriesId: id, slot });
    const segment = segmentForSlot(current, slot);
    if (!original || !segment) return { ok: false, reason: 'invalid' };
    const input = {
      title: segment.title ?? current.title,
      recurrence: { ...segment.recurrence, startDate: original.scheduledDate },
      timing: segment.timing,
      ...changes,
    };
    if (!isValidEventSeriesInput(input)) return { ok: false, reason: 'invalid' };
    const index = current.segments.indexOf(segment);
    const offset = segment.logicalSlotOffset ?? 0;
    const replacement = {
      id: slot === offset ? segment.id : nanoid(),
      logicalSlotOffset: slot,
      title: input.title,
      recurrence: input.recurrence,
      timing: input.timing,
    };
    const titleOnly = changes.recurrence === undefined && changes.timing === undefined;
    const plan: EventSeriesPlan = {
      title: current.title,
      segments: [
        ...current.segments.slice(0, index + (slot === offset ? 0 : 1)),
        replacement,
        ...(titleOnly
          ? current.segments.slice(index + 1).map((s) => ({ ...s, title: input.title }))
          : []),
      ],
    };
    return this._replace(current, plan, slot, decision);
  }

  deleteEntire(id: string): boolean {
    const current = this.entities()[id];
    if (!current) return false;
    if (current.deletedAt !== undefined) return true;
    const now = Math.max(Date.now(), current.modified);
    this._store.dispatch(
      deleteEventSeries({
        eventSeries: structuredClone({ ...current, deletedAt: now, modified: now }),
      }),
    );
    return true;
  }

  private _replace(
    current: EventSeries,
    plan: EventSeriesPlan,
    fromSlot: number,
    decision?: SeriesExceptionDecision,
  ): SeriesEditResult {
    if (
      !isValidEventSeriesPlan(plan) ||
      (decision !== undefined && decision !== 'retain' && decision !== 'clear')
    )
      return { ok: false, reason: 'invalid' };
    const next = { ...current, ...plan };
    const temporal = (series: EventSeries, slot: number): string => {
      const resolved = resolveEventOccurrence(series, { seriesId: current.id, slot });
      if (!resolved) return 'absent';
      const event = resolved.original;
      return JSON.stringify(
        event.isAllDay
          ? ['allDay', event.date]
          : ['timed', event.start, event.end, event.timeZone],
      );
    };
    const affected = Object.values(this._exceptions()).filter(
      (exception) =>
        exception &&
        exception.seriesId === current.id &&
        exception.slot >= fromSlot &&
        exception.value.kind !== 'inherit',
    );
    if (decision === 'clear' && affected.length)
      return { ok: false, reason: 'atomic-clear-unsupported' };
    const needsDecision = affected.some(
      (exception) =>
        exception && temporal(current, exception.slot) !== temporal(next, exception.slot),
    );
    if (needsDecision && decision !== 'retain')
      return { ok: false, reason: 'exception-decision-required' };
    this._store.dispatch(
      replaceEventSeriesPlan({
        id: current.id,
        plan: structuredClone(plan),
        modified: Math.max(Date.now(), current.modified),
      }),
    );
    return { ok: true };
  }
}
