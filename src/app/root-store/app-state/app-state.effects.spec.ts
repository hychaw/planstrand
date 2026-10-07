import { TestBed } from '@angular/core/testing';
import { Action, provideStore, Store } from '@ngrx/store';
import { appStateReducer } from './app-state.reducer';
import { selectTodayStr } from './app-state.selectors';
import { selectTodayPlanningIds } from '../../features/planning/store/planning.selectors';
import { DEFAULT_TASK } from '../../features/tasks/task.model';
import { BehaviorSubject } from 'rxjs';
import { AppStateEffects } from './app-state.effects';
import { AppStateActions } from './app-state.actions';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { CurrentDateService } from '../../core/date/current-date.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';

describe('AppStateEffects calendar rollover', () => {
  let today$: BehaviorSubject<string>;
  let syncing$: BehaviorSubject<boolean>;
  let current: string;
  let dispatched: Action[];
  const day = (todayStr: string): Action =>
    AppStateActions.setTodayString({ todayStr, startOfNextDayDiffMs: 0 });
  beforeEach(() => {
    today$ = new BehaviorSubject('2026-10-06');
    syncing$ = new BehaviorSubject(false);
    current = '2026-10-06';
    dispatched = [];
    TestBed.configureTestingModule({
      providers: [
        AppStateEffects,
        { provide: GlobalTrackingIntervalService, useValue: { todayDateStr$: today$ } },
        { provide: CurrentDateService, useValue: { resolveToday: () => current } },
        {
          provide: HydrationStateService,
          useValue: { isInSyncWindow: () => syncing$.value, isInSyncWindow$: syncing$ },
        },
      ],
    });
    TestBed.inject(AppStateEffects).setTodayStr$.subscribe((a) => dispatched.push(a));
  });
  it('reconciles the first emission instead of skipping a hot/replayed current date', () => {
    expect(dispatched).toEqual([day('2026-10-06')]);
    current = '2026-10-07';
    today$.next(current);
    expect(dispatched).toEqual([day('2026-10-06'), day('2026-10-07')]);
  });
  it('waits for hydration and re-reads the clock rather than dispatching a queued old day', () => {
    syncing$.next(true);
    current = '2026-10-07';
    today$.next(current);
    expect(dispatched).toEqual([day('2026-10-06')]);
    current = '2026-10-08';
    syncing$.next(false);
    expect(dispatched).toEqual([day('2026-10-06'), day('2026-10-08')]);
  });
});

describe('shared clock to NgRx current-day selectors', () => {
  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 9, 6, 23, 59, 59));
    const records = ['2026-10-06', '2026-10-07'].map((key, index) => ({
      id: 'task' + index,
      placement: { target: { type: 'DAY', key }, orderKey: 'V' },
      revision: { counter: 1, clientId: 'fixture', opId: key },
    }));
    TestBed.configureTestingModule({
      teardown: { destroyAfterEach: true },
      providers: [
        AppStateEffects,
        provideStore({
          appState: appStateReducer,
          tasks: (
            state = {
              entities: Object.fromEntries(
                records.map((r) => [r.id, { ...DEFAULT_TASK, id: r.id }]),
              ),
            },
          ) => state,
          planning: (
            state = {
              ids: records.map((r) => r.id),
              entities: Object.fromEntries(records.map((r) => [r.id, r])),
            },
          ) => state,
        }),
        { provide: HydrationStateService, useValue: { isInSyncWindow: () => false } },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    jasmine.clock().uninstall();
  });
  it('updates Today membership and all selectTodayStr consumers without reloading', () => {
    const store = TestBed.inject(Store);
    const today = store.selectSignal(selectTodayStr);
    const ids = store.selectSignal(selectTodayPlanningIds);
    const sub = TestBed.inject(AppStateEffects).setTodayStr$.subscribe((action) =>
      store.dispatch(action),
    );
    expect(today()).toBe('2026-10-06');
    expect(ids()).toEqual(['task0']);
    jasmine.clock().tick(1000);
    expect(today()).toBe('2026-10-07');
    expect(ids()).toEqual(['task1']);
    sub.unsubscribe();
  });
});
