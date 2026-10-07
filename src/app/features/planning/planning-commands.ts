import { Signal } from '@angular/core';
import { ClientIdService } from '../../core/util/client-id.service';
import { uuidv7 } from '../../util/uuid-v7';
import { OpLog } from '../../core/log';
import { Store } from '@ngrx/store';
import {
  PlanningState,
  PlanningRecord,
  planningPlacementView,
  PlanningPlacement,
  comparePlacements,
  planningOrderBetween,
  isPlanningDate,
} from './planning.model';
import { selectPlanningState } from './store/planning.selectors';
import { setPlacement, removePlacement } from './store/planning.actions';
import { PlannerActions } from '../planner/store/planner.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { getWeekRange } from '../../util/get-week-range';
import { getDbDateStr } from '../../util/get-db-date-str';
import { selectLocalizationConfig } from '../config/store/global-config.reducer';

let identityProvider: Pick<ClientIdService, 'getOrGenerateClientId'> | undefined;
let identityReady: () => void;
const identityAvailable = new Promise<void>((resolve) => {
  identityReady = resolve;
});
/** Wired once by the existing capture owner; every write re-resolves through ClientIdService. */
export const configurePlanningWrites = (
  provider: Pick<ClientIdService, 'getOrGenerateClientId'>,
): void => {
  identityProvider = provider;
  identityReady();
};
/** Local gesture translation. Only the resulting absolute single-Task action is synced. */
type PreparedPlanningAction =
  | ReturnType<typeof setPlacement>
  | ReturnType<typeof removePlacement>;
class PlanningCommands {
  private readonly state: Signal<PlanningState>;
  async preparePlanningWrite(
    id: string,
    placement: PlanningRecord['placement'],
  ): Promise<void> {
    this.store.dispatch(await this.prepare(id, placement));
  }
  private queue: Promise<unknown> = Promise.resolve();
  private prepare(
    id: string,
    intent: PlanningRecord['placement'] | (() => PlanningRecord['placement']),
  ): Promise<PreparedPlanningAction> {
    const run = this.queue.then(async () => {
      await identityAvailable;
      const clientId = await identityProvider!.getOrGenerateClientId();
      const placement = typeof intent === 'function' ? intent() : intent;
      const counter = this.state().entities[id]?.revision.counter ?? 0;
      if (counter === Number.MAX_SAFE_INTEGER)
        throw new Error('Planning counter exhausted; write stopped');
      const record: PlanningRecord = {
        id,
        placement,
        revision: { counter: counter + 1, clientId, opId: uuidv7() },
      };
      return placement === null ? removePlacement({ record }) : setPlacement({ record });
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  private dispatchPrepared(action: Promise<PreparedPlanningAction>): void {
    void action
      .then((prepared) => this.store.dispatch(prepared))
      .catch((error: unknown) => {
        OpLog.err('Planning write stopped', error);
      });
  }
  constructor(private readonly store: Store) {
    this.state = store.selectSignal<PlanningState>(selectPlanningState);
  }
  private list(
    target: PlanningPlacement['target'],
    excluding?: string,
  ): PlanningPlacement[] {
    return Object.values(this.state().entities)
      .map(planningPlacementView)
      .filter(
        (p): p is PlanningPlacement =>
          !!p &&
          p.id !== excluding &&
          p.target.type === target.type &&
          p.target.key === target.key,
      )
      .sort(comparePlacements);
  }
  placementAction(
    id: string,
    target: PlanningPlacement['target'],
    index: number,
  ): Promise<ReturnType<typeof setPlacement>> {
    if (!isPlanningDate(target.key)) throw new Error('Invalid Planning target');
    return this.prepare(id, () => {
      const list = this.list(target, id),
        at = Math.max(0, Math.min(index, list.length));
      const upper = list[at]?.orderKey ?? null;
      let previous = at - 1;
      // Equal-key peers form a deterministic block: before an anchor means before its block.
      while (previous >= 0 && list[previous].orderKey === upper) previous--;
      const orderKey = planningOrderBetween(list[previous]?.orderKey ?? null, upper);
      return { target, orderKey };
    }).then((action) => {
      if (action.type !== setPlacement.type)
        throw new Error('Invalid prepared placement');
      return action;
    });
  }
  private place(id: string, target: PlanningPlacement['target'], index: number): void {
    this.dispatchPrepared(this.placementAction(id, target, index));
  }
  /** Single placement operation for day/week drops and accessible reorder commands. */
  placeAt(id: string, target: PlanningPlacement['target'], index: number): void {
    this.place(id, target, index);
  }
  dayAction(
    p: Omit<ReturnType<typeof PlannerActions.planTaskForDay>, 'type' | 'meta'>,
  ): Promise<ReturnType<typeof setPlacement>> {
    return this.placementAction(
      p.task.id,
      { type: 'DAY', key: p.day },
      p.isAddToTop === true ? 0 : Infinity,
    );
  }
  planTaskForDay(
    p: Omit<ReturnType<typeof PlannerActions.planTaskForDay>, 'type' | 'meta'>,
  ): void {
    this.place(
      p.task.id,
      { type: 'DAY', key: p.day },
      p.isAddToTop === true ? 0 : Infinity,
    );
  }
  transferTask(
    p: Omit<ReturnType<typeof PlannerActions.transferTask>, 'type' | 'meta'>,
  ): void {
    if (!isPlanningDate(p.newDay)) {
      this.unplan(p.task.id);
      return;
    }
    const target = { type: 'DAY' as const, key: p.newDay },
      others = this.list(target, p.task.id);
    const anchor = p.targetTaskId ? others.findIndex((x) => x.id === p.targetTaskId) : -1;
    this.place(p.task.id, target, anchor >= 0 ? anchor : p.targetIndex);
  }
  moveInList(
    p: Omit<ReturnType<typeof PlannerActions.moveInList>, 'type' | 'meta'>,
  ): void {
    const target = { type: 'DAY' as const, key: p.targetDay },
      list = this.list(target);
    if (
      p.fromIndex < 0 ||
      p.toIndex < 0 ||
      p.fromIndex >= list.length ||
      p.toIndex >= list.length
    )
      return;
    this.place(list[p.fromIndex].id, target, p.toIndex);
  }
  moveBeforeTask(
    p: Omit<ReturnType<typeof PlannerActions.moveBeforeTask>, 'type' | 'meta'>,
  ): void {
    const anchor = planningPlacementView(this.state().entities[p.toTaskId]);
    if (!anchor) return;
    this.place(
      p.fromTask.id,
      anchor.target,
      this.list(anchor.target, p.fromTask.id).findIndex((x) => x.id === anchor.id),
    );
  }
  moveTaskInTodayTagList(
    p: Omit<ReturnType<typeof TaskSharedActions.moveTaskInTodayTagList>, 'type' | 'meta'>,
  ): void {
    const from = planningPlacementView(this.state().entities[p.fromTaskId]),
      to = planningPlacementView(this.state().entities[p.toTaskId]);
    if (
      !from ||
      !to ||
      from.target.type !== 'DAY' ||
      to.target.type !== 'DAY' ||
      from.target.key !== to.target.key
    )
      return;
    this.place(
      from.id,
      from.target,
      this.list(from.target, from.id).findIndex((x) => x.id === to.id),
    );
  }
  planTasksForToday(
    p: Omit<ReturnType<typeof TaskSharedActions.planTasksForToday>, 'type' | 'meta'>,
  ): void {
    if (!isPlanningDate(p.today))
      throw new Error('Planning Today requires a captured date');
    for (const id of new Set(p.taskIds))
      this.place(id, { type: 'DAY', key: p.today }, Infinity);
  }
  orderedDayIds(day: string): string[] {
    return this.list({ type: 'DAY', key: day }).map((p) => p.id);
  }
  moveAfterInDay(id: string, day: string, afterId: string | null): void {
    const from = planningPlacementView(this.state().entities[id]);
    if (from?.target.type !== 'DAY' || from.target.key !== day) return;
    const others = this.list(from.target, id);
    const at = afterId === null ? -1 : others.findIndex((p) => p.id === afterId);
    if (afterId !== null && at < 0) return;
    this.place(id, from.target, at + 1);
  }
  /** Genuine current UI unplanning; unrelated to undated legacy Today-list removal. */
  unplan(id: string): void {
    this.dispatchPrepared(this.prepare(id, null));
  }
  /** Protect future/week placements when a Today menu was opened before state changed. */
  unplanDay(id: string, day: string): void {
    const placement = planningPlacementView(this.state().entities[id]);
    if (placement?.target.type === 'DAY' && placement.target.key === day) this.unplan(id);
  }
  planWeek(id: string, date: Date): void {
    const cfg = this.store.selectSignal(selectLocalizationConfig)();
    this.place(
      id,
      {
        type: 'WEEK',
        key: getDbDateStr(getWeekRange(date, cfg.firstDayOfWeek ?? 1).start),
      },
      Infinity,
    );
  }
}
const commands = new WeakMap<Store, PlanningCommands>();
export const planningCommands = (store: Store): PlanningCommands => {
  let facade = commands.get(store);
  if (!facade) {
    facade = new PlanningCommands(store);
    commands.set(store, facade);
  }
  return facade;
};
