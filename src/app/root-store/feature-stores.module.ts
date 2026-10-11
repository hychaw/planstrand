import { FEATURE_STORE_REDUCERS } from './feature-store-reducers';
import { NgModule } from '@angular/core';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { LayoutEffects } from '../core-ui/layout/store/layout.effects';
import { GlobalConfigEffects } from '../features/config/store/global-config.effects';
import { IdleEffects } from '../features/idle/store/idle.effects';
import { PollToBacklogEffects } from '../features/issue/store/poll-to-backlog.effects';
import { PollIssueUpdatesEffects } from '../features/issue/store/poll-issue-updates.effects';
import { NoteEffects } from '../features/note/store/note.effects';
import { ProjectEffects } from '../features/project/store/project.effects';
import { SimpleCounterEffects } from '../features/simple-counter/store/simple-counter.effects';
import { TagEffects } from '../features/tag/store/tag.effects';
import { TaskRepeatCfgEffects } from '../features/task-repeat-cfg/store/task-repeat-cfg.effects';
import { TaskRepeatCleanupEffects } from '../features/task-repeat-cfg/store/task-repeat-cleanup.effects';
import { TaskDueEffects } from '../features/tasks/store/task-due.effects';
import { TaskInternalEffects } from '../features/tasks/store/task-internal.effects';
import { TaskRelatedModelEffects } from '../features/tasks/store/task-related-model.effects';
import { TaskReminderEffects } from '../features/tasks/store/task-reminder.effects';
import { TaskUiEffects } from '../features/tasks/store/task-ui.effects';
import { ShortSyntaxEffects } from '../features/tasks/store/short-syntax.effects';
import { IS_ELECTRON } from '../app.constants';
import { TaskElectronEffects } from '../features/tasks/store/task-electron.effects';
import { WorkContextEffects } from '../features/work-context/store/work-context.effects';
import { IS_ANDROID_WEB_VIEW } from '../util/is-android-web-view';
import { AndroidEffects } from '../features/android/store/android.effects';
import { AndroidFocusModeEffects } from '../features/android/store/android-focus-mode.effects';
import { AndroidForegroundTrackingEffects } from '../features/android/store/android-foreground-tracking.effects';
import { AndroidSyncBridgeEffects } from '../features/android/store/android-sync-bridge.effects';
import { AndroidWidgetEffects } from '../features/android/store/android-widget.effects';
import { MobileNotificationEffects } from '../features/mobile/store/mobile-notification.effects';
import { IS_IOS_NATIVE, IS_NATIVE_PLATFORM } from '../util/is-native-platform';
import { IosBackgroundTrackingEffects } from '../features/ios/store/ios-background-tracking.effects';
import { NextcloudDeckIssueEffects } from '../features/issue/providers/nextcloud-deck/nextcloud-deck-issue.effects';
import { CalendarIntegrationEffects } from '../features/calendar-integration/store/calendar-integration.effects';
import { TimeBlockSyncEffects } from '../features/calendar-integration/time-block/time-block-sync.effects';
import { ElectronEffects } from '../core/electron/electron.effects';
import { DropboxEffects } from '../imex/sync/dropbox/store/dropbox.effects';
import { FinishDayBeforeCloseEffects } from '../features/finish-day-before-close/finish-day-before-close.effects';
import { GitlabIssueEffects } from '../features/issue/providers/gitlab/gitlab-issue.effects';
import { JiraIssueEffects } from '../features/issue/providers/jira/jira-issue.effects';
import { OpenProjectEffects } from '../features/issue/providers/open-project/open-project.effects';
import { RedmineEffects } from '../features/issue/providers/redmine/redmine.effects';
import { ReminderCountdownEffects } from '../features/reminder/store/reminder-countdown.effects';
import { SyncEffects } from '../imex/sync/sync.effects';
import { ArchiveOperationHandlerEffects } from '../op-log/apply/archive-operation-handler.effects';
import { PlannerEffects } from '../features/planner/store/planner.effects';
import { AppStateEffects } from './app-state/app-state.effects';
import { PluginHooksEffects } from '../plugins/plugin-hooks.effects';
import { OperationLogEffects } from '../op-log/capture/operation-log.effects';
import { IssueTwoWaySyncEffects } from '../features/issue/two-way-sync/issue-two-way-sync.effects';
import { PluginOAuthLifecycleEffects } from '../plugins/oauth/plugin-oauth-lifecycle.effects';
import { ReducerFailureSnackEffects } from './meta/reducer-failure-snack.effects';
@NgModule({
  declarations: [],
  imports: [
    // Angular AOT needs explicit imports; keep reducer implementations shared.
    StoreModule.forFeature('folder', FEATURE_STORE_REDUCERS.folder),
    StoreModule.forFeature('appState', FEATURE_STORE_REDUCERS.appState),
    StoreModule.forFeature('layout', FEATURE_STORE_REDUCERS.layout),
    StoreModule.forFeature('globalConfig', FEATURE_STORE_REDUCERS.globalConfig),
    StoreModule.forFeature('focusMode', FEATURE_STORE_REDUCERS.focusMode),
    StoreModule.forFeature('idle', FEATURE_STORE_REDUCERS.idle),
    StoreModule.forFeature('issueProvider', FEATURE_STORE_REDUCERS.issueProvider),
    StoreModule.forFeature('metric', FEATURE_STORE_REDUCERS.metric),
    StoreModule.forFeature('note', FEATURE_STORE_REDUCERS.note),
    StoreModule.forFeature('projects', FEATURE_STORE_REDUCERS.projects),
    StoreModule.forFeature('menuTree', FEATURE_STORE_REDUCERS.menuTree),
    StoreModule.forFeature('simpleCounter', FEATURE_STORE_REDUCERS.simpleCounter),
    StoreModule.forFeature('section', FEATURE_STORE_REDUCERS.section),
    StoreModule.forFeature('workSession', FEATURE_STORE_REDUCERS.workSession),
    StoreModule.forFeature('event', FEATURE_STORE_REDUCERS.event),
    StoreModule.forFeature(
      'occurrenceException',
      FEATURE_STORE_REDUCERS.occurrenceException,
    ),
    StoreModule.forFeature('eventSeries', FEATURE_STORE_REDUCERS.eventSeries),
    StoreModule.forFeature('weeklyTemplate', FEATURE_STORE_REDUCERS.weeklyTemplate),
    StoreModule.forFeature('planning', FEATURE_STORE_REDUCERS.planning),
    StoreModule.forFeature('tag', FEATURE_STORE_REDUCERS.tag),
    StoreModule.forFeature('taskRepeatCfg', FEATURE_STORE_REDUCERS.taskRepeatCfg),
    StoreModule.forFeature('tasks', FEATURE_STORE_REDUCERS.tasks),
    StoreModule.forFeature('workContext', FEATURE_STORE_REDUCERS.workContext),
    StoreModule.forFeature('boards', FEATURE_STORE_REDUCERS.boards),
    StoreModule.forFeature('timeTracking', FEATURE_STORE_REDUCERS.timeTracking),
    StoreModule.forFeature('planner', FEATURE_STORE_REDUCERS.planner),
    StoreModule.forFeature('pluginUserData', FEATURE_STORE_REDUCERS.pluginUserData),
    StoreModule.forFeature('pluginMetadata', FEATURE_STORE_REDUCERS.pluginMetadata),
    StoreModule.forFeature('reminders', FEATURE_STORE_REDUCERS.reminders),
    EffectsModule.forFeature([OperationLogEffects, ReducerFailureSnackEffects]),
    EffectsModule.forFeature([AppStateEffects]),
    EffectsModule.forFeature([LayoutEffects]),
    EffectsModule.forFeature([GlobalConfigEffects]),
    // FocusModeEffects lazy-loaded in main.ts via requestIdleCallback
    EffectsModule.forFeature([IdleEffects]),
    EffectsModule.forFeature([PollToBacklogEffects, PollIssueUpdatesEffects]),
    EffectsModule.forFeature([NoteEffects]),
    EffectsModule.forFeature([ProjectEffects]),
    EffectsModule.forFeature([SimpleCounterEffects]),
    EffectsModule.forFeature([TagEffects]),
    EffectsModule.forFeature([TaskRepeatCfgEffects, TaskRepeatCleanupEffects]),
    EffectsModule.forFeature([
      TaskInternalEffects,
      TaskRelatedModelEffects,
      TaskReminderEffects,
      TaskUiEffects,
      ShortSyntaxEffects,
      TaskDueEffects,
      ...(IS_ELECTRON ? [TaskElectronEffects] : []),
    ]),
    EffectsModule.forFeature([WorkContextEffects]),
    EffectsModule.forFeature([ArchiveOperationHandlerEffects]),
    EffectsModule.forFeature([PlannerEffects]),
    // EFFECTS ONLY
    EffectsModule.forFeature([
      ...(IS_ANDROID_WEB_VIEW
        ? [
            AndroidEffects,
            AndroidFocusModeEffects,
            AndroidForegroundTrackingEffects,
            AndroidSyncBridgeEffects,
            AndroidWidgetEffects,
          ]
        : []),
    ]),
    EffectsModule.forFeature([...(IS_IOS_NATIVE ? [IosBackgroundTrackingEffects] : [])]),
    EffectsModule.forFeature([
      ...(IS_NATIVE_PLATFORM ? [MobileNotificationEffects] : []),
    ]),
    EffectsModule.forFeature([IssueTwoWaySyncEffects]),
    EffectsModule.forFeature([NextcloudDeckIssueEffects]),
    EffectsModule.forFeature([CalendarIntegrationEffects]),
    EffectsModule.forFeature([TimeBlockSyncEffects]),
    EffectsModule.forFeature([ElectronEffects]),
    EffectsModule.forFeature([DropboxEffects]),
    EffectsModule.forFeature([FinishDayBeforeCloseEffects]),
    EffectsModule.forFeature([GitlabIssueEffects]),
    EffectsModule.forFeature([JiraIssueEffects]),
    EffectsModule.forFeature([OpenProjectEffects]),
    EffectsModule.forFeature([RedmineEffects]),
    EffectsModule.forFeature([ReminderCountdownEffects]),
    EffectsModule.forFeature([SyncEffects]),
    EffectsModule.forFeature([PluginHooksEffects, PluginOAuthLifecycleEffects]),
  ],
})
export class FeatureStoresModule {}
