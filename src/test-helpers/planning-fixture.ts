import { Store } from '@ngrx/store';
import { take } from 'rxjs';
import { MockStore } from '@ngrx/store/testing';
import { configurePlanningWrites } from '../app/features/planning/planning-commands';
import { selectPlanningState } from '../app/features/planning/store/planning.selectors';
import { setPlacement } from '../app/features/planning/store/planning.actions';

export const configurePlanningFixture = (store: Store): void => {
  configurePlanningWrites({ getOrGenerateClientId: async () => 'planning-fixture' });
  if ('overrideSelector' in store) {
    store
      .select((state) => state)
      .pipe(take(1))
      .subscribe((state) => {
        (store as MockStore).setState({ ...state, planning: { ids: [], entities: {} } });
      });
  } else {
    const existing = store.selectSignal?.bind(store);
    store.selectSignal = ((selector: unknown) =>
      selector === selectPlanningState
        ? () => ({ ids: [], entities: {} })
        : existing?.(selector as never)) as Store['selectSignal'];
  }
};
export const flushPlanningWrites = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
export const expectPlanningDay = (
  dispatch: jasmine.Spy,
  id: string,
  day: string,
): void => {
  expect(dispatch).toHaveBeenCalledWith(
    jasmine.objectContaining({
      type: setPlacement.type,
      record: jasmine.objectContaining({
        id,
        placement: jasmine.objectContaining({ target: { type: 'DAY', key: day } }),
        revision: jasmine.objectContaining({
          counter: 1,
          clientId: 'planning-fixture',
          opId: jasmine.any(String),
        }),
      }),
    }),
  );
};
