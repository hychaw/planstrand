import { isValidWeeklyTemplateState } from '../../features/routines/weekly-template.validation';
import { MetaReducer } from '@ngrx/store';
import { isValidEventSeriesState } from '../../features/routines/event-series.validation';
import { RootState } from '../root-state';

export const eventSeriesIntegrityMetaReducer: MetaReducer<RootState> =
  (reducer) => (state, action) => {
    const next = reducer(state, action);
    if (
      next.eventSeries !== state?.eventSeries &&
      next.eventSeries !== undefined &&
      !isValidEventSeriesState(next.eventSeries)
    )
      throw new Error('Invalid EventSeries state');
    if (
      next.weeklyTemplate !== state?.weeklyTemplate &&
      next.weeklyTemplate !== undefined &&
      !isValidWeeklyTemplateState(next.weeklyTemplate)
    )
      throw new Error('Invalid WeeklyTemplate state');
    return next;
  };
