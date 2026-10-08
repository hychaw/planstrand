import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import {
  concatMap,
  distinctUntilChanged,
  filter,
  map,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { Action, Store } from '@ngrx/store';
import { IS_MAC_TOKEN } from '../../../util/is-mac';
import {
  KeyboardLayout,
  KeyboardLayoutService,
} from '../../../core/keyboard-layout/keyboard-layout.service';
import { IS_ELECTRON_TOKEN } from '../../../app.constants';
import { T } from '../../../t.const';
import { LanguageService } from '../../../core/language/language.service';
import { DateService } from '../../../core/date/date.service';
import { SnackService } from '../../../core/snack/snack.service';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { KeyboardConfig } from '@sp/keyboard-config';
import { updateGlobalConfigSection } from './global-config.actions';
import {
  selectConfigFeatureState,
  selectLocalizationConfig,
} from './global-config.reducer';
import { mapKeyboardConfigToQwerty } from '../keyboard-shortcut.util';
import { AppStateActions } from '../../../root-store/app-state/app-state.actions';
import { Log } from '../../../core/log';
import { bulkApplyOperations } from '../../../op-log/apply/bulk-hydration.action';
import { FULL_STATE_OP_TYPES } from '../../../op-log/core/operation.types';

const LAYOUT_DETECTION_TIMEOUT_MS = 1000;

@Injectable()
export class GlobalConfigEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _languageService = inject(LanguageService);
  private _dateService = inject(DateService);
  private _snackService = inject(SnackService);
  private _store = inject(Store);
  private _keyboardLayoutService = inject(KeyboardLayoutService);
  private _isElectron = inject(IS_ELECTRON_TOKEN);
  private _isMac = inject(IS_MAC_TOKEN);

  snackUpdate$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateGlobalConfigSection),
        tap(({ sectionKey, sectionCfg, isSkipSnack }) => {
          const isPublicSection = sectionKey.charAt(0) !== '_';
          const isPublicPropUpdated = Object.keys(sectionCfg).find(
            (key) => key.charAt(0) !== '_',
          );
          if (isPublicPropUpdated && isPublicSection && !isSkipSnack) {
            this._snackService.open({
              type: 'SUCCESS',
              msg: T.F.CONFIG.S.UPDATE_SECTION,
              translateParams: { sectionKey },
            });
          }
        }),
      ),
    { dispatch: false },
  );

  updateGlobalShortcut$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateGlobalConfigSection),
        filter(
          ({ sectionKey, sectionCfg }) => this._isElectron && sectionKey === 'keyboard',
        ),
        tap(({ sectionKey, sectionCfg }) => {
          let keyboardCfg: KeyboardConfig = sectionCfg as KeyboardConfig;
          if (this._isMac) {
            keyboardCfg = mapKeyboardConfigToQwerty(
              keyboardCfg,
              this._keyboardLayoutService.layout,
            );
          }
          window.ea.registerGlobalShortcuts(keyboardCfg);
        }),
      ),
    { dispatch: false },
  );

  registerGlobalShortcutInitially$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(loadAllData),
        filter(() => this._isElectron),
        concatMap(async (action) => {
          const appDataComplete = action.appDataComplete;
          const keyboardCfg: KeyboardConfig = (
            appDataComplete.globalConfig || DEFAULT_GLOBAL_CONFIG
          ).keyboard;
          let layout: KeyboardLayout = new Map();
          if (this._isMac) {
            layout = await Promise.race([
              this._keyboardLayoutService.layoutReady,
              new Promise<KeyboardLayout>((resolve) => {
                const timeoutId = setTimeout(() => {
                  Log.log(
                    `Layout detection timed out after ${LAYOUT_DETECTION_TIMEOUT_MS}ms. Falling back to empty layout.`,
                  );
                  resolve(new Map());
                }, LAYOUT_DETECTION_TIMEOUT_MS);
                void this._keyboardLayoutService.layoutReady.then(() =>
                  clearTimeout(timeoutId),
                );
              }),
            ]);
          }
          return { keyboardCfg, layout };
        }),
        tap(({ keyboardCfg, layout }) => {
          let cfg = keyboardCfg;
          if (this._isMac) {
            cfg = mapKeyboardConfigToQwerty(keyboardCfg, layout);
          }
          window.ea.registerGlobalShortcuts(cfg);
        }),
      ),
    { dispatch: false },
  );

  // Selector-based effect to apply language from state.
  // This fires on initial load, local changes, AND remote sync.
  // Intentional: UI config should apply from any source, dispatch: false
  applyLanguageFromState$ = createEffect(
    () =>
      this._store.select(selectLocalizationConfig).pipe(
        map((config) => config.lng),
        distinctUntilChanged(),
        tap((lng) => {
          if (lng === undefined) {
            // Initial state - try autoswitch first, then detect browser language
            const autoswitched = this._languageService.tryAutoswitch();
            if (!autoswitched) this._languageService.setLng();
          } else {
            this._languageService.setLng(lng);
          }
        }),
      ),
    { dispatch: false },
  );

  // Keep legacy configuration in saved data for compatibility, but Planstrand
  // uses civil midnight. Loading/replaying it must never move Tasks or Planning.
  private _calendarToday(): Action {
    this._dateService.setStartOfNextDayDiff(0);
    return AppStateActions.setTodayString({
      todayStr: this._dateService.todayStr(),
      startOfNextDayDiffMs: 0,
    });
  }

  setStartOfNextDayDiffOnChange = createEffect(() =>
    this._actions$.pipe(
      ofType(updateGlobalConfigSection),
      filter(({ sectionKey }) => sectionKey === 'misc'),
      map(() => this._calendarToday()),
    ),
  );

  setStartOfNextDayDiffOnLoad = createEffect(() =>
    this._actions$.pipe(
      ofType(loadAllData),
      map(() => this._calendarToday()),
    ),
  );

  setStartOfNextDayDiffOnBulkApply = createEffect(() =>
    this._actions$.pipe(
      ofType(bulkApplyOperations),
      filter(({ operations }) =>
        operations.some(
          (op) =>
            (op.entityType === 'GLOBAL_CONFIG' && op.entityId === 'misc') ||
            FULL_STATE_OP_TYPES.has(op.opType),
        ),
      ),
      map(() => this._calendarToday()),
    ),
  );

  notifyElectronAboutCfgChange = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateGlobalConfigSection),
        filter(() => this._isElectron),
        withLatestFrom(this._store.select(selectConfigFeatureState)),
        tap(([action, globalConfig]) => {
          // Send the entire settings object to electron for overlay initialization
          window.ea.sendSettingsUpdate(globalConfig);
        }),
      ),
    { dispatch: false },
  );

  notifyElectronAboutCfgChangeInitially = createEffect(
    () =>
      this._actions$.pipe(
        ofType(loadAllData),
        filter(() => this._isElectron),
        tap(({ appDataComplete }) => {
          const cfg = appDataComplete.globalConfig || DEFAULT_GLOBAL_CONFIG;
          // Send initial settings to electron for overlay initialization
          window.ea.sendSettingsUpdate(cfg);
        }),
      ),
    { dispatch: false },
  );
}
