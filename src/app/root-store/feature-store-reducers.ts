import { ActionReducer } from '@ngrx/store';
import {
  OCCURRENCE_EXCEPTION_FEATURE_NAME,
  occurrenceExceptionReducer,
} from '../features/routines/store/occurrence-exception.reducer';
import {
  EVENT_SERIES_FEATURE_NAME,
  eventSeriesReducer,
} from '../features/routines/store/event-series.reducer';
import {
  WEEKLY_TEMPLATE_FEATURE_NAME,
  weeklyTemplateReducer,
} from '../features/routines/store/weekly-template.reducer';
import { EVENT_FEATURE_NAME, eventReducer } from '../features/event/store/event.reducer';
import {
  PLANNING_FEATURE_NAME,
  planningReducer,
} from '../features/planning/store/planning.reducer';
import {
  FOLDER_FEATURE_NAME,
  folderReducer,
} from '../features/folder/store/folder.reducer';
import {
  LAYOUT_FEATURE_NAME,
  layoutReducer,
} from '../core-ui/layout/store/layout.reducer';
import {
  CONFIG_FEATURE_NAME,
  globalConfigReducer,
} from '../features/config/store/global-config.reducer';
import {
  FOCUS_MODE_FEATURE_KEY,
  focusModeReducer,
} from '../features/focus-mode/store/focus-mode.reducer';
import { IDLE_FEATURE_KEY, idleReducer } from '../features/idle/store/idle.reducer';
import { issueProvidersFeature } from '../features/issue/store/issue-provider.reducer';
import {
  METRIC_FEATURE_NAME,
  metricReducer,
} from '../features/metric/store/metric.reducer';
import { NOTE_FEATURE_NAME, noteReducer } from '../features/note/store/note.reducer';
import {
  PROJECT_FEATURE_NAME,
  projectReducer,
} from '../features/project/store/project.reducer';
import {
  menuTreeFeatureKey,
  menuTreeReducer,
} from '../features/menu-tree/store/menu-tree.reducer';
import {
  SIMPLE_COUNTER_FEATURE_NAME,
  simpleCounterReducer,
} from '../features/simple-counter/store/simple-counter.reducer';
import {
  SECTION_FEATURE_NAME,
  sectionReducer,
} from '../features/section/store/section.reducer';
import { TAG_FEATURE_NAME, tagReducer } from '../features/tag/store/tag.reducer';
import {
  TASK_REPEAT_CFG_FEATURE_NAME,
  taskRepeatCfgReducer,
} from '../features/task-repeat-cfg/store/task-repeat-cfg.reducer';
import { TASK_FEATURE_NAME, taskReducer } from '../features/tasks/store/task.reducer';
import { WORK_CONTEXT_FEATURE_NAME } from '../features/work-context/store/work-context.selectors';
import { workContextReducer } from '../features/work-context/store/work-context.reducer';
import { boardsFeature } from '../features/boards/store/boards.reducer';
import { timeTrackingFeature } from '../features/time-tracking/store/time-tracking.reducer';
import { plannerFeature } from '../features/planner/store/planner.reducer';
import { appStateFeature } from './app-state/app-state.reducer';
import {
  PLUGIN_USER_DATA_FEATURE_NAME,
  pluginUserDataReducer,
} from '../plugins/store/plugin-user-data.reducer';
import {
  PLUGIN_METADATA_FEATURE_NAME,
  pluginMetadataReducer,
} from '../plugins/store/plugin-metadata.reducer';
import {
  REMINDER_FEATURE_NAME,
  reminderReducer,
} from '../features/reminder/store/reminder.reducer';
import {
  WORK_SESSION_FEATURE_NAME,
  workSessionReducer,
} from '../features/work-session/store/work-session.reducer';

/** The client and isolated operator reader share every feature registration. */
export const FEATURE_STORE_REDUCERS: Record<string, ActionReducer<any>> = {
  [FOLDER_FEATURE_NAME]: folderReducer,
  [appStateFeature.name]: appStateFeature.reducer,
  [LAYOUT_FEATURE_NAME]: layoutReducer,
  [CONFIG_FEATURE_NAME]: globalConfigReducer,
  [FOCUS_MODE_FEATURE_KEY]: focusModeReducer,
  [IDLE_FEATURE_KEY]: idleReducer,
  [issueProvidersFeature.name]: issueProvidersFeature.reducer,
  [METRIC_FEATURE_NAME]: metricReducer,
  [NOTE_FEATURE_NAME]: noteReducer,
  [PROJECT_FEATURE_NAME]: projectReducer,
  [menuTreeFeatureKey]: menuTreeReducer,
  [SIMPLE_COUNTER_FEATURE_NAME]: simpleCounterReducer,
  [SECTION_FEATURE_NAME]: sectionReducer,
  [WORK_SESSION_FEATURE_NAME]: workSessionReducer,
  [EVENT_FEATURE_NAME]: eventReducer,
  [OCCURRENCE_EXCEPTION_FEATURE_NAME]: occurrenceExceptionReducer,
  [EVENT_SERIES_FEATURE_NAME]: eventSeriesReducer,
  [WEEKLY_TEMPLATE_FEATURE_NAME]: weeklyTemplateReducer,
  [PLANNING_FEATURE_NAME]: planningReducer,
  [TAG_FEATURE_NAME]: tagReducer,
  [TASK_REPEAT_CFG_FEATURE_NAME]: taskRepeatCfgReducer,
  [TASK_FEATURE_NAME]: taskReducer,
  [WORK_CONTEXT_FEATURE_NAME]: workContextReducer,
  [boardsFeature.name]: boardsFeature.reducer,
  [timeTrackingFeature.name]: timeTrackingFeature.reducer,
  [plannerFeature.name]: plannerFeature.reducer,
  [PLUGIN_USER_DATA_FEATURE_NAME]: pluginUserDataReducer,
  [PLUGIN_METADATA_FEATURE_NAME]: pluginMetadataReducer,
  [REMINDER_FEATURE_NAME]: reminderReducer,
};
