import { Store } from '@ngrx/store';
import { PersistentAction } from '../../op-log/core/persistent-action.interface';
import { planningCommands } from './planning-commands';
import * as actions from '../work-context/store/work-context-meta.actions';
/** Current Today gestures become single-Task absolute placements. Project/tag order stays independent. */
export const dispatchPlanningWorkContext = (
  store: Store,
  day: string,
  action: PersistentAction,
): void => {
  const p = action as PersistentAction & {
    taskId: string;
    workContextId: string;
    workContextType: string;
    afterTaskId?: string | null;
    doneTaskIds?: string[];
  };
  if (p.workContextId !== 'TODAY' || p.workContextType !== 'TAG') {
    store.dispatch(action);
    return;
  }
  const commands = planningCommands(store);
  if (action.type === actions.moveTaskInTodayList.type) {
    commands.moveAfterInDay(p.taskId, day, p.afterTaskId ?? null);
    return;
  }
  const ordered = commands.orderedDayIds(day).filter((id) => p.doneTaskIds?.includes(id));
  const index = ordered.indexOf(p.taskId);
  if (index < 0) return;
  let target = index;
  switch (action.type) {
    case actions.moveTaskUpInTodayList.type:
      target = Math.max(0, index - 1);
      break;
    case actions.moveTaskDownInTodayList.type:
      target = Math.min(ordered.length - 1, index + 1);
      break;
    case actions.moveTaskToTopInTodayList.type:
      target = 0;
      break;
    case actions.moveTaskToBottomInTodayList.type:
      target = ordered.length - 1;
      break;
    default:
      store.dispatch(action);
      return;
  }
  if (target === index) return;
  const without = ordered.filter((id) => id !== p.taskId);
  commands.moveAfterInDay(p.taskId, day, without[target - 1] ?? null);
};
