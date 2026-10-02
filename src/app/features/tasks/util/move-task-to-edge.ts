import { Store } from '@ngrx/store';
import { take } from 'rxjs/operators';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { moveSubTaskToTop, moveSubTaskToBottom } from '../store/task.actions';
import {
  moveProjectTaskToTopInBacklogList,
  moveProjectTaskToBottomInBacklogList,
} from '../../project/store/project.actions';
import {
  moveTaskToTopInTodayList,
  moveTaskToBottomInTodayList,
} from '../../work-context/store/work-context-meta.actions';
import { dispatchPlanningWorkContext } from '../../planning/dispatch-planning-work-context';
/** Shared edge gesture with unchanged subtask/project semantics and canonical Today order. */
export const moveTaskToEdge = (
  store: Store,
  context: WorkContextService,
  today: () => string,
  id: string,
  parentId: string | null,
  isBacklog: boolean,
  bottom: boolean,
): void => {
  if (parentId) {
    store.dispatch((bottom ? moveSubTaskToBottom : moveSubTaskToTop)({ id, parentId }));
    return;
  }
  const workContextId = context.activeWorkContextId as string;
  if (isBacklog) {
    context.undoneBacklogTaskIds$.pipe(take(1)).subscribe((ids) => {
      if (!ids) throw new Error('No undoneBacklogTaskIds found');
      store.dispatch(
        (bottom
          ? moveProjectTaskToBottomInBacklogList
          : moveProjectTaskToTopInBacklogList)({
          taskId: id,
          workContextId,
          doneBacklogTaskIds: ids,
        }),
      );
    });
  } else
    context.undoneTaskIds$.pipe(take(1)).subscribe((ids) => {
      dispatchPlanningWorkContext(
        store,
        today(),
        (bottom ? moveTaskToBottomInTodayList : moveTaskToTopInTodayList)({
          taskId: id,
          workContextId,
          workContextType: context.activeWorkContextType as WorkContextType,
          doneTaskIds: ids,
        }),
      );
    });
};
