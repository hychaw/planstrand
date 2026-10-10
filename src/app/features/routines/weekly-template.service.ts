import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { EventSeriesInput } from './event-series.model';
import { EventSeriesService } from './event-series.service';
import { WeeklyTemplateInput } from './weekly-template.model';
import { isValidWeeklyTemplateInput } from './weekly-template.validation';
import { selectWeeklyTemplateEntities } from './store/weekly-template.selectors';
import {
  addWeeklyTemplate,
  updateWeeklyTemplate,
  deleteWeeklyTemplate,
} from './store/weekly-template.actions';

@Injectable({ providedIn: 'root' })
export class WeeklyTemplateService {
  private readonly _store = inject(Store);
  private readonly _series = inject(EventSeriesService);
  readonly entities = this._store.selectSignal(selectWeeklyTemplateEntities);

  create(input: WeeklyTemplateInput): string | null {
    if (!isValidWeeklyTemplateInput(input)) return null;
    const now = Date.now();
    const template = {
      ...structuredClone(input),
      id: nanoid(),
      created: now,
      modified: now,
    };
    this._store.dispatch(addWeeklyTemplate({ weeklyTemplate: template }));
    return template.id;
  }
  rename(id: string, title: string): boolean {
    return this._update(id, { title });
  }
  setActive(id: string, isActive: boolean): boolean {
    return this._update(id, { isActive });
  }
  updateDateWindow(id: string, startDate: string, endDate?: string): boolean {
    const current = this.entities()[id];
    if (!current) return false;
    return this._update(
      id,
      {
        title: current.title,
        isActive: current.isActive,
        startDate,
        ...(endDate !== undefined ? { endDate } : {}),
      },
      true,
    );
  }
  delete(id: string): boolean {
    const current = this.entities()[id];
    if (!current) return false;
    if (current.deletedAt !== undefined) return true;
    const now = Math.max(Date.now(), current.modified);
    this._store.dispatch(
      deleteWeeklyTemplate({
        weeklyTemplate: structuredClone({ ...current, deletedAt: now, modified: now }),
      }),
    );
    return true;
  }
  createEntry(templateId: string, input: EventSeriesInput): string | null {
    const parent = this.entities()[templateId];
    if (
      !parent ||
      parent.deletedAt !== undefined ||
      input?.recurrence?.frequency !== 'weekly'
    )
      return null;
    return this._series.create(input, templateId);
  }
  private _update(
    id: string,
    changes: Partial<WeeklyTemplateInput>,
    replace = false,
  ): boolean {
    const current = this.entities()[id];
    if (!current || current.deletedAt !== undefined) return false;
    const definition: WeeklyTemplateInput = {
      title: current.title,
      isActive: current.isActive,
      startDate: current.startDate,
      ...(current.endDate !== undefined ? { endDate: current.endDate } : {}),
    };
    const input = replace ? changes : { ...definition, ...changes };
    if (!isValidWeeklyTemplateInput(input)) return false;
    this._store.dispatch(
      updateWeeklyTemplate({
        id,
        changes: structuredClone(input),
        modified: Math.max(Date.now(), current.modified),
      }),
    );
    return true;
  }
}
