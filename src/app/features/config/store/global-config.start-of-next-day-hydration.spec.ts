import { TestBed, fakeAsync } from '@angular/core/testing';
import { Action, Store, StoreModule } from '@ngrx/store';
import { Actions, EffectsModule } from '@ngrx/effects';
import { Subscription, take } from 'rxjs';
import { DateService } from '../../../core/date/date.service';
import { GlobalConfigEffects } from './global-config.effects';
import {
  CONFIG_FEATURE_NAME,
  globalConfigReducer,
  selectMiscConfig,
} from './global-config.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { GlobalConfigState, MiscConfig } from '../global-config.model';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { bulkApplyOperations } from '../../../op-log/apply/bulk-hydration.action';
import { bulkOperationsMetaReducer } from '../../../op-log/apply/bulk-hydration.meta-reducer';
import { ActionType, Operation, OpType } from '../../../op-log/core/operation.types';
import { initialTaskState, TASK_FEATURE_NAME } from '../../tasks/store/task.reducer';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  appStateFeatureKey,
  appStateReducer,
} from '../../../root-store/app-state/app-state.reducer';
import { AppStateActions } from '../../../root-store/app-state/app-state.actions';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';
import { LanguageService } from '../../../core/language/language.service';
import { SnackService } from '../../../core/snack/snack.service';
import { KeyboardLayoutService } from '../../../core/keyboard-layout/keyboard-layout.service';
import { IS_ELECTRON_TOKEN } from '../../../app.constants';
import { IS_MAC_TOKEN } from '../../../util/is-mac';

describe('legacy day-start preferences across Planstrand operation replay', () => {
  const misc = (startOfNextDay: number, startOfNextDayTime: string): MiscConfig => ({
    ...DEFAULT_GLOBAL_CONFIG.misc,
    startOfNextDay,
    startOfNextDayTime,
  });

  const appDataWithMisc = (miscCfg: MiscConfig): AppDataComplete =>
    ({
      globalConfig: {
        ...DEFAULT_GLOBAL_CONFIG,
        misc: miscCfg,
      } as GlobalConfigState,
    }) as unknown as AppDataComplete;

  const configOp = (miscCfg: MiscConfig, clientId = 'client1'): Operation => ({
    id: `op-cfg-misc-${clientId}`,
    opType: OpType.Update,
    entityType: 'GLOBAL_CONFIG',
    entityId: 'misc',
    actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
    payload: {
      actionPayload: { sectionKey: 'misc', sectionCfg: miscCfg },
      entityChanges: [],
    },
    vectorClock: { [clientId]: 1 },
    clientId,
    timestamp: 1_700_000_000_000,
    schemaVersion: 1,
  });

  const fullStateOp = (miscCfg: MiscConfig, clientId = 'client2'): Operation => ({
    id: `op-full-state-${clientId}`,
    opType: OpType.SyncImport,
    entityType: 'ALL',
    actionType: ActionType.LOAD_ALL_DATA,
    payload: appDataWithMisc(miscCfg),
    vectorClock: { [clientId]: 1 },
    clientId,
    timestamp: 1_700_000_000_000,
    schemaVersion: 1,
  });

  const repairOp = (miscCfg: MiscConfig, clientId = 'client2'): Operation => ({
    ...fullStateOp(miscCfg, clientId),
    id: `op-repair-${clientId}`,
    opType: OpType.Repair,
    actionType: ActionType.REPAIR_AUTO,
    payload: {
      appDataComplete: appDataWithMisc(miscCfg),
      repairSummary: {
        entityStateFixed: 1,
        orphanedEntitiesRestored: 0,
        invalidReferencesRemoved: 0,
        relationshipsFixed: 0,
        structureRepaired: 0,
        typeErrorsFixed: 0,
      },
    },
  });

  let store: Store;
  let dateService: DateService;
  let observedActions: Action[];
  let actionsSubscription: Subscription;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        StoreModule.forRoot(
          {
            [CONFIG_FEATURE_NAME]: globalConfigReducer,
            [TASK_FEATURE_NAME]: () => initialTaskState,
            [appStateFeatureKey]: appStateReducer,
          },
          { metaReducers: [bulkOperationsMetaReducer] },
        ),
        EffectsModule.forRoot([GlobalConfigEffects]),
      ],
      providers: [
        {
          provide: LanguageService,
          useValue: { setLng: (): void => undefined, tryAutoswitch: (): boolean => true },
        },
        { provide: SnackService, useValue: { open: (): void => undefined } },
        { provide: KeyboardLayoutService, useValue: new KeyboardLayoutService() },
        { provide: IS_ELECTRON_TOKEN, useValue: false },
        { provide: IS_MAC_TOKEN, useValue: false },
      ],
    });

    store = TestBed.inject(Store);
    dateService = TestBed.inject(DateService);
    observedActions = [];
    actionsSubscription = TestBed.inject(Actions).subscribe((action) =>
      observedActions.push(action),
    );
  });

  afterEach(() => actionsSubscription.unsubscribe());

  const readStoreHour = (): number => {
    let hour = -1;
    store
      .select(selectMiscConfig)
      .pipe(take(1))
      .subscribe((cfg) => (hour = cfg.startOfNextDay));
    return hour;
  };

  const readAppStateOffset = (): number => {
    let offset = -1;
    store
      .select(selectStartOfNextDayDiffMs)
      .pipe(take(1))
      .subscribe((value) => (offset = value));
    return offset;
  };

  const bootFromSnapshotAt = (miscCfg: MiscConfig): void => {
    store.dispatch(loadAllData({ appDataComplete: appDataWithMisc(miscCfg) }));
    observedActions = [];
  };

  const replay = (operations: Operation[], localClientId = 'client1'): void => {
    store.dispatch(bulkApplyOperations({ operations, localClientId }));
  };

  const expectCalendarToday = (): void => {
    expect(readStoreHour()).toBe(6);
    expect(dateService.getStartOfNextDayDiffMs()).toBe(0);
    expect(readAppStateOffset()).toBe(0);
    expect(dateService.todayStr()).toBe('2026-10-07');
    store
      .select(selectTodayStr)
      .pipe(take(1))
      .subscribe((today) => {
        expect(today).toBe('2026-10-07');
      });
    expect(
      observedActions.some(
        (action) => action.type === TaskSharedActions.updateTasks.type,
      ),
    ).toBeFalse();
  };

  it('retains the preference but uses calendar midnight after startup replay', fakeAsync(() => {
    spyOn(Date, 'now').and.returnValue(new Date(2026, 9, 7, 1).getTime());
    bootFromSnapshotAt(misc(0, '00:00'));

    replay([configOp(misc(6, '06:00'), 'client1')]);

    expectCalendarToday();
  }));

  it('retains the preference but uses calendar midnight after remote config replay', fakeAsync(() => {
    spyOn(Date, 'now').and.returnValue(new Date(2026, 9, 7, 1).getTime());
    bootFromSnapshotAt(misc(0, '00:00'));

    replay([configOp(misc(6, '06:00'), 'client2')]);

    expectCalendarToday();
  }));

  it('retains the preference but uses calendar midnight after full-state replay', fakeAsync(() => {
    spyOn(Date, 'now').and.returnValue(new Date(2026, 9, 7, 1).getTime());
    bootFromSnapshotAt(misc(0, '00:00'));

    replay([fullStateOp(misc(6, '06:00'))]);

    expectCalendarToday();
  }));

  it('retains the preference but uses calendar midnight after repair replay', fakeAsync(() => {
    spyOn(Date, 'now').and.returnValue(new Date(2026, 9, 7, 1).getTime());
    bootFromSnapshotAt(misc(0, '00:00'));

    replay([repairOp(misc(6, '06:00'))]);

    expectCalendarToday();
  }));

  it('does not re-mint task updates while replaying the config operation', () => {
    bootFromSnapshotAt(misc(0, '00:00'));

    replay([configOp(misc(6, '06:00'))]);

    expect(
      observedActions.some(
        (action) => action.type === TaskSharedActions.updateTasks.type,
      ),
    ).toBeFalse();
  });

  it('ignores bulk operations that cannot change the day-start config', () => {
    bootFromSnapshotAt(misc(0, '00:00'));
    const unrelatedOp: Operation = {
      ...configOp(misc(6, '06:00')),
      id: 'op-cfg-sound-client1',
      entityId: 'sound',
      payload: {
        actionPayload: { sectionKey: 'sound', sectionCfg: {} },
        entityChanges: [],
      },
    };

    replay([unrelatedOp]);

    expect(dateService.getStartOfNextDayDiffMs()).toBe(0);
    expect(
      observedActions.some(
        (action) => action.type === AppStateActions.setTodayString.type,
      ),
    ).toBeFalse();
  });
});
