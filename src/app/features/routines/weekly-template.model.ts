import { EntityState } from '@ngrx/entity';

/** Complete editable definition. Date bounds are inclusive civil dates. */
export interface WeeklyTemplateInput {
  title: string;
  isActive: boolean;
  startDate: string;
  endDate?: string;
}

/** Membership is derived exclusively from EventSeries.templateId. */
export interface WeeklyTemplate extends WeeklyTemplateInput {
  readonly id: string;
  readonly created: number;
  modified: number;
  /** Terminal tombstone, retained without cascading to entries or exceptions. */
  deletedAt?: number;
}

export interface WeeklyTemplateState extends EntityState<WeeklyTemplate> {
  ids: string[];
}
