import { ConfigFormConfig, ConfigFormSection } from './global-config.model';
import { LANGUAGE_SELECTION_FORM_FORM } from './form-cfgs/language-selection-form.const';
import { MISC_SETTINGS_FORM_CFG } from './form-cfgs/misc-settings-form.const';
import { KEYBOARD_SETTINGS_FORM_CFG } from './form-cfgs/keyboard-form.const';
import { TASKS_SETTINGS_FORM_CFG } from './form-cfgs/tasks-settings-form.const';

// View-only allowlists leave inherited synced configuration intact.
const fields = (
  section: ConfigFormSection<any>,
  keys: string[],
): ConfigFormSection<any> => ({
  ...section,
  items: section.items?.filter((item) => keys.includes(String(item.key))),
});
export const PLANSTRAND_GENERAL_SETTINGS: ConfigFormConfig = [
  LANGUAGE_SELECTION_FORM_FORM,
  fields(MISC_SETTINGS_FORM_CFG, [
    'isConfirmBeforeExit',
    'isMinimizeToTray',
    'isCheckForUpdates',
    'startOfNextDayTime',
    'isDisableAnimations',
    'isDisableCelebration',
    'isUseCustomWindowTitleBar',
  ]),
  fields(KEYBOARD_SETTINGS_FORM_CFG, [
    'globalShowHide',
    'globalAddTask',
    'addNewTask',
    'focusSideNav',
    'toggleSideNavMode',
    'showSearchBar',
    'showHelp',
    'goToWorkView',
    'goToSettings',
    'goToScheduledView',
  ]),
];
export const PLANSTRAND_TASK_SETTINGS: ConfigFormConfig = [
  fields(TASKS_SETTINGS_FORM_CFG, [
    'isConfirmBeforeDelete',
    'isAutoMarkParentAsDone',
    'isMarkdownFormattingInNotesEnabled',
    'priorityIconPreset',
    'notesTemplate',
  ]),
];
