import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';

import { distinctUntilChanged, map } from 'rxjs/operators';
import { AppStateActions } from './app-state.actions';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { CurrentDateService } from '../../core/date/current-date.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { waitForSyncWindow } from '../../util/wait-for-sync-window.operator';

@Injectable()
export class AppStateEffects {
  private _globalTimeTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _dates = inject(CurrentDateService);
  private _hydrationState = inject(HydrationStateService);

  // Initial subscription and rollover both reconcile runtime selectors. Re-read
  // after hydration: a laptop can sleep through more than one day during sync.
  setTodayStr$ = createEffect(() => {
    return this._globalTimeTrackingIntervalService.todayDateStr$.pipe(
      distinctUntilChanged(),
      waitForSyncWindow(this._hydrationState, 'AppStateEffects:setTodayStr$'),
      map(() =>
        AppStateActions.setTodayString({
          todayStr: this._dates.resolveToday(),
          startOfNextDayDiffMs: 0,
        }),
      ),
    );
  });
}
