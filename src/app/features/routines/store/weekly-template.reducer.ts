import { createEntityAdapter } from '@ngrx/entity';
import { Action, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { WeeklyTemplate, WeeklyTemplateState } from '../weekly-template.model';
import {
  isValidWeeklyTemplate,
  isValidWeeklyTemplateInput,
  isValidWeeklyTemplateState,
} from '../weekly-template.validation';
import {
  addWeeklyTemplate,
  updateWeeklyTemplate,
  deleteWeeklyTemplate,
} from './weekly-template.actions';

export const WEEKLY_TEMPLATE_FEATURE_NAME = 'weeklyTemplate';
export const weeklyTemplateAdapter = createEntityAdapter<WeeklyTemplate>();
export const initialWeeklyTemplateState: WeeklyTemplateState = {
  ...weeklyTemplateAdapter.getInitialState(),
  ids: [],
};
const valid = (template: WeeklyTemplate): WeeklyTemplate => {
  if (!isValidWeeklyTemplate(template)) throw new Error('Invalid WeeklyTemplate');
  return template;
};
const reducer = createReducer(
  initialWeeklyTemplateState,
  on(loadAllData, (_state, { appDataComplete }) => {
    if (!Object.hasOwn(appDataComplete, 'weeklyTemplate'))
      return initialWeeklyTemplateState;
    const slice = (appDataComplete as { weeklyTemplate: unknown }).weeklyTemplate;
    if (!isValidWeeklyTemplateState(slice))
      throw new Error('Invalid WeeklyTemplate state');
    return slice;
  }),
  on(addWeeklyTemplate, (state, { weeklyTemplate }) => {
    valid(weeklyTemplate);
    return state.entities[weeklyTemplate.id]
      ? state
      : weeklyTemplateAdapter.addOne(weeklyTemplate, state);
  }),
  on(updateWeeklyTemplate, (state, { id, changes, modified }) => {
    if (!isValidWeeklyTemplateInput(changes))
      throw new Error('Invalid WeeklyTemplate input');
    const current = state.entities[id];
    if (!current || current.deletedAt !== undefined) return state;
    // Complete definition; omitting the optional end clears an existing bound.
    return weeklyTemplateAdapter.setOne(
      valid({ id: current.id, created: current.created, ...changes, modified }),
      state,
    );
  }),
  on(deleteWeeklyTemplate, (state, { weeklyTemplate }) => {
    valid(weeklyTemplate);
    if (weeklyTemplate.deletedAt === undefined)
      throw new Error('Missing WeeklyTemplate tombstone');
    const current = state.entities[weeklyTemplate.id];
    if (current && current.created !== weeklyTemplate.created)
      throw new Error('Immutable WeeklyTemplate metadata');
    return weeklyTemplateAdapter.setOne(weeklyTemplate, state);
  }),
);

/** Compensation cannot resurrect live parents; complete tombstones may precede creation. */
export const weeklyTemplateReducer = (
  state: WeeklyTemplateState | undefined,
  action: Action,
): WeeklyTemplateState => {
  if (action.type !== '[WEEKLY_TEMPLATE] LWW Update') return reducer(state, action);
  const payload = { ...action } as unknown as Record<string, unknown>;
  delete payload['type'];
  delete payload['meta'];
  const next = valid(payload as unknown as WeeklyTemplate);
  const current = state?.entities[next.id];
  if (!current)
    return next.deletedAt !== undefined
      ? weeklyTemplateAdapter.setOne(next, state ?? initialWeeklyTemplateState)
      : (state ?? initialWeeklyTemplateState);
  if (current.deletedAt !== undefined && next.deletedAt === undefined) return state!;
  if (current.created !== next.created)
    throw new Error('Immutable WeeklyTemplate metadata');
  return weeklyTemplateAdapter.setOne(next, state!);
};
