import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import {
  PLANSTRAND_GENERAL_SETTINGS,
  PLANSTRAND_TASK_SETTINGS,
} from './planstrand-settings';
import {
  selectAppFeaturesConfig,
  selectIdleConfig,
  selectTakeABreakConfig,
} from './store/global-config.reducer';

describe('Planstrand product policy', () => {
  it('ignores inherited tracking opt-ins without rewriting stored configuration', () => {
    const state = {
      globalConfig: {
        ...DEFAULT_GLOBAL_CONFIG,
        appFeatures: {
          ...DEFAULT_GLOBAL_CONFIG.appFeatures,
          isTimeTrackingEnabled: true,
          isFocusModeEnabled: true,
        },
        idle: { ...DEFAULT_GLOBAL_CONFIG.idle, isEnableIdleTimeTracking: true },
        takeABreak: { ...DEFAULT_GLOBAL_CONFIG.takeABreak, isTakeABreakEnabled: true },
      },
    };
    const before = JSON.stringify(state);
    expect(selectAppFeaturesConfig(state).isTimeTrackingEnabled).toBeFalse();
    expect(selectAppFeaturesConfig(state).isFocusModeEnabled).toBeFalse();
    expect(selectIdleConfig(state).isEnableIdleTimeTracking).toBeFalse();
    expect(selectTakeABreakConfig(state).isTakeABreakEnabled).toBeFalse();
    expect(JSON.stringify(state)).toBe(before);
  });
  it('exposes only useful configuration fields', () => {
    const fields = [...PLANSTRAND_GENERAL_SETTINGS, ...PLANSTRAND_TASK_SETTINGS].flatMap(
      (section) => section.items?.map((item) => item.key) ?? [],
    );
    for (const key of [
      'startOfNextDayTime',
      'isTimeTrackingEnabled',
      'isEnableIdleTimeTracking',
      'isTakeABreakEnabled',
      'defaultProjectId',
      'taskEditTags',
      'globalToggleTaskStart',
    ])
      expect(fields).not.toContain(key);
  });
});
