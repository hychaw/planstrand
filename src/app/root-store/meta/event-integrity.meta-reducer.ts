import { ActionReducer, MetaReducer } from '@ngrx/store';
import { RootState } from '../root-state';
import { isValidEventState } from '../../features/event/store/event.reducer';
/** Generic conflict replacement must obey the same Event contract as CRUD/replay. */
export const eventIntegrityMetaReducer: MetaReducer<RootState> =
  (reducer: ActionReducer<RootState>) => (state, action) => {
    const next = reducer(state, action);
    if (
      next.event !== state?.event &&
      next.event !== undefined &&
      !isValidEventState(next.event)
    )
      throw new Error('Invalid Event state');
    return next;
  };
