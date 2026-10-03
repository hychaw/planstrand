# Planstrand Implementation Plan

This audit compares the current repository at `feature/architecture-audit` with `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, and `docs/UPSTREAM.md`. It is an implementation plan, not an authorization to change production code. Paths and symbols below were verified in the current source tree.

## 1. Current Architecture Map

### Application shell and dependency boundaries

- `src/main.ts` bootstraps `AppComponent`, installs `StoreModule.forRoot(undefined, { metaReducers: META_REDUCERS })`, root effects, the service worker, Material/theme providers, and `FeatureStoresModule`.
- `src/app/root-store/feature-stores.module.ts` registers feature reducers and effects. Important registrations include Task, Project, Tag, Section, TaskRepeatCfg, Planner, TimeTracking, Reminder, MenuTree, plugin data, calendar integration effects, and platform effects.
- `src/app/app.routes.ts`, `src/app/routes/pages.routes.ts`, and `src/app/routes/context.routes.ts` define the current route surface. There are routes for project/tag task views, Planner, Schedule, scheduled list, boards, habits, search, settings, and work-context subpages. There are no dedicated Master Tasks, This Week, Weekly Template, or Trash routes.
- `src/app/app.component.ts` composes the main shell. `MagicSideNavComponent` in `src/app/core-ui/magic-side-nav/magic-side-nav.component.ts`, `MainHeaderComponent`, right-side panels, the router outlet, and `MobileBottomNavComponent` form the responsive navigation shell.
- The intended import direction is documented in `src/app/README.md`: shell/routes use feature domains; features use core/UI/util; persistence and sync observe persistent NgRx actions rather than owning view state.

### Tasks and task state

- `src/app/features/tasks/task.model.ts` defines `TaskCopy`, immutable `Task`, `TaskState`, `TaskWithSubTasks`, due/deadline refinements, archive types, and `DEFAULT_TASK`. `TaskCopy` extends the public plugin `Task` from `packages/plugin-api/src/types.ts` and adds application fields.
- A Task currently owns `projectId`, `tagIds`, `parentId`/`subTaskIds`, `timeEstimate`, `timeSpent`, `timeSpentOnDay`, completion state, attachments, issue-provider fields, reminder fields, recurrence linkage, and scheduling fields.
- Scheduling is encoded directly on Task through mutually exclusive `dueDay` and `dueWithTime`; `hasPlannedTime` is an optional compatibility flag. Deadlines are separate optional `deadlineDay`/`deadlineWithTime` fields.
- `TaskPriority` is already persisted as optional `1 | 2 | 3` with Low/Medium/High semantics. `src/app/features/tasks/task-priority.const.ts`, `TaskPriorityIndicatorComponent`, task context menus, and `TaskBulkActionService.setPriority()` provide UI and bulk editing. This does not match Planstrand's None/P1/P2/P3/P4 scale.
- `timeEstimate` remains required by the plugin API and `DEFAULT_TASK` sets it to `0`; `DEFAULT_GLOBAL_CONFIG.timeTracking.defaultEstimate` is also `0`. The UI therefore does not yet have a reliable semantic distinction between unknown and a real zero estimate.
- `src/app/features/tasks/store/task.reducer.ts` is the normalized NgRx entity reducer. `src/app/features/tasks/store/task.selectors.ts` provides `selectAllTasks`, hierarchy/subtask selectors, scheduled/overdue/deadline selectors, reminder selectors, and task lookup selectors.
- `src/app/features/tasks/task.service.ts` (`TaskService`) is the main CRUD/schedule facade. Cross-model mutations use `TaskSharedActions` from `src/app/root-store/meta/task-shared.actions.ts` and ordered meta-reducers rather than independent effect chains.
- `TaskInternalEffects`, `TaskRelatedModelEffects`, `TaskReminderEffects`, `TaskUiEffects`, `TaskDueEffects`, `TaskElectronEffects`, and `ShortSyntaxEffects` live under `src/app/features/tasks/store/`.
- `TaskComponent`, `TaskListComponent`, `TaskDetailPanelComponent`, `AddTaskBarComponent`, task context menus, and multi-select components live under `src/app/features/tasks/`. `TaskListComponent` contains substantial Angular CDK drag-and-drop logic for ordering, parent/subtask conversion, and touch behavior.
- Subtasks are recursive Task relationships, not organizational folders. Reusing them as folders would conflate “part of this task” with “stored in this category” and would violate Planstrand's domain model.

### Projects, tags, sections, and hierarchy

- `src/app/features/project/project.model.ts` defines normalized `ProjectState`, `Project`, and `ProjectBasicCfg`. Projects own ordered `taskIds` and `backlogTaskIds`, notes, completion/archive flags, issue integration configuration, and work-context appearance/settings.
- `INBOX_PROJECT` in `src/app/features/project/project.const.ts` is a built-in stable Inbox (`id: 'INBOX_PROJECT'`). New Task defaults already target it through `DEFAULT_GLOBAL_CONFIG.tasks.defaultProjectId`.
- `src/app/features/tag/tag.model.ts` defines normalized `TagState`. Tasks and tags maintain a many-to-many relationship through `Task.tagIds` and `Tag.taskIds`.
- `TODAY_TAG` in `src/app/features/tag/tag.const.ts` is virtual. Its `taskIds` stores order, while membership is derived from Task scheduling fields and must not appear in `Task.tagIds`.
- `src/app/features/work-context/store/work-context.selectors.ts` hydrates active Project/Tag contexts and derives Today, trackable, scheduled, and timeline collections. Today currently inherits the upstream due/scheduling semantics; it is not an independent Planstrand planning membership.
- `src/app/features/section/section.model.ts` defines normalized `Section { id, contextId, contextType, title, isExpanded?, taskIds }`. Sections are flat groupings within a Project/Tag work context, not recursively nested task containers.
- `src/app/features/menu-tree/store/menu-tree.model.ts` defines recursive `MenuTreeFolderNode` nodes with `children`, plus Project and Tag nodes. `MenuTreeService` and `NavListTreeComponent` render/reorder this structure. These folders organize sidebar links only: they do not own Tasks and cannot directly become Planstrand Folder records without a migration and canonical task-folder relationship.
- Project, Tag, Section, and menu-tree cross-entity consistency is enforced by reducers under `src/app/root-store/meta/task-shared-meta-reducers/`, notably `project-shared.reducer.ts`, `tag-shared.reducer.ts`, and `section-shared.reducer.ts`.

### Planner, scheduling, deadlines, and drag-and-drop

- `src/app/features/planner/store/planner.reducer.ts` defines persistent `PlannerState.days: Record<string, string[]>` plus dialog state. The day arrays store Task IDs and ordering. `PlannerActions` and `plannerSharedMetaReducer` keep Planner, Today, and Task due fields aligned.
- `src/app/features/planner/planner.service.ts` (`PlannerService`) combines Task IDs, `TaskRepeatCfg` projections, deadlines, Today membership, and external calendar events into rolling Planner days. The current UI builds 15 days on larger screens and 5 on mobile; it is not a dedicated This Week workspace.
- `src/app/features/planner/planner.model.ts` defines `PlannerDay`, `ScheduleItem`, `ScheduleItemTask`, `ScheduleItemRepeatProjection`, and `ScheduleItemEvent`. These are view models, not independent persisted Event or WorkSession entities.
- `src/app/features/schedule/schedule/schedule.component.ts` (`ScheduleComponent`) exposes Day, Week, and Month and retains the chosen view in `LayoutService.selectedTimeView`/local storage. Year view is absent.
- `ScheduleService` in `src/app/features/schedule/schedule.service.ts` combines tasks, repeat projections, calendar events, planner membership, work boundaries, and lunch into `ScheduleDay`/`SVE` view entries defined in `schedule.model.ts`.
- `ScheduleWeekComponent`, `ScheduleMonthComponent`, `ScheduleDayPanelComponent`, and `ScheduleEventComponent` render schedule views. `ScheduleEventComponent` has drag and resize behavior; `ScheduleWeekDragService` maps those gestures back to Task scheduling and `timeEstimate`, or to provider-backed calendar updates.
- `PlannerDayComponent` supports CDK reordering/transfers. `ScheduleDayPanelComponent` accepts external task drags and computes a timestamp. `MagicSideNavComponent` also accepts Task drops onto Projects, Tags, and Today.
- The interaction and geometry code is valuable, but its persistent target is wrong for Planstrand: dragging a Task to time creates/mutates the Task's one `dueWithTime` block, and resizing changes `timeEstimate`. It must eventually create or mutate a WorkSession instead.

### Calendar events and integrations

- `src/app/features/calendar-integration/calendar-integration.model.ts` defines `CalendarIntegrationEvent`, a provider projection with provider ID, external ID, start, duration, all-day flag, URL, color, and capabilities metadata. It is not a canonical local Event.
- `CalendarIntegrationService` in `calendar-integration.service.ts` fetches iCalendar and plugin-provider events, caches raw events in local storage, filters hidden/linked events, and maps them for Planner/Schedule.
- `CalendarEventActionsService` performs provider-supported create/update/move operations, creates a local Task from an external event, hides events, and links provider items.
- `src/app/features/calendar-integration/time-block/time-block-sync.effects.ts` (`TimeBlockSyncEffects`) optionally exports the current single Task time block to a compatible provider. It is not WorkSession synchronization.
- `src/app/features/schedule/ical/get-relevant-events-from-ical.ts` expands iCalendar recurrence and exclusions.
- Bundled Google Calendar and CalDAV providers live under `packages/plugin-dev/google-calendar-provider/` and `packages/plugin-dev/caldav-calendar-provider/`, registered through `src/app/plugins/bundled-plugins.const.ts`. Core iCal support and legacy issue-provider integrations also exist.
- There is no normalized, persisted local Event store and no single `CalendarDisplayItem` selector consumed by every calendar view. Schedule's `SVE` union is the closest current presentation abstraction.

### Recurrence and weekly schedules

- `src/app/features/task-repeat-cfg/task-repeat-cfg.model.ts` defines normalized `TaskRepeatCfgState` and `TaskRepeatCfg`, supporting daily/weekly/monthly/yearly rules, weekday selections, start date/time, intervals, nth weekday/last day, repeat-from-completion, wait-for-completion, inherited subtasks, skipped/deleted occurrence dates, and overdue skipping.
- `TaskRepeatCfgService`, `TaskRepeatCfgEffects`, `TaskRepeatCleanupEffects`, and recurrence utilities under the same feature create or project recurring Task instances.
- This is a mature recurrence calculation base, but its aggregate is “a recipe that generates Tasks.” It does not represent a standalone recurring Event, a reusable WeeklyTemplate, split-series edits (“this and future”), or WorkSession occurrences.
- Provider-owned recurring calendar events are expanded in the calendar adapter path rather than stored as Planstrand recurrence series.

### Reminders and notifications

- `src/app/features/reminder/reminder.model.ts` defines an array-backed `Reminder` with a single timestamp and only `type: 'NOTE' | 'TASK'`; `recurringConfig` is explicitly unfinished.
- `ReminderService`, `ReminderCountdownEffects`, `TaskReminderEffects`, and `src/app/features/reminder/reminder.worker.ts` manage web/worker reminders. `NotifyService` in `src/app/core/notify/notify.service.ts` supplies browser/Electron delivery.
- `CapacitorReminderService` and `CapacitorNotificationService` in `src/app/core/platform/` plus `MobileNotificationEffects` bridge native local notifications for Android/iOS.
- Tasks currently have one normal reminder and one deadline reminder; repeat configurations carry one reminder preset. There is no multiple-reminder collection and no Event or WorkSession reminder target.

### NgRx, operation capture, persistence, and validation

- `src/app/root-store/meta/meta-reducer-registry.ts` defines the critical meta-reducer order. `operationCaptureMetaReducer` surrounds cross-model reducers, `bulkOperationsMetaReducer` replays bulk/hydration actions, shared reducers enforce atomic relationships, and `lwwUpdateMetaReducer` applies last-write-wins replacements.
- `src/app/op-log/capture/operation-capture.service.ts` and `operation-log.effects.ts` convert eligible local actions into durable operations. `LOCAL_ACTIONS` lets persistence, backup, and sync react without blocking reducers.
- `src/app/op-log/core/operation.types.ts` narrows the shared operation format to application `ActionType` and `EntityType`, vector clocks, multi-entity payloads, imports, and repairs.
- `src/app/op-log/core/entity-registry.ts` is the runtime registry for adapter, singleton, map, and array entities. It maps Task, Project, Tag, Section, Reminder, Planner, etc. to their NgRx features and payload keys.
- `src/app/op-log/model/model-config.ts` defines `AllModelConfig`, `AppDataComplete`, `MODEL_CONFIGS`, `CROSS_MODEL_VERSION`, defaults, repair hooks, archive slices, and `withDefaultModelSlices()` for partial legacy data.
- `OperationLogStoreService` in `src/app/op-log/persistence/operation-log-store.service.ts` persists operations, snapshots, vector clocks, client ID, recovery snapshots, and archives through `IndexedDbOpLogAdapter`. `db-keys.const.ts` names the `SUP_OPS` database and its stores. The adapter factory currently chooses IndexedDB on all application platforms; a SQLite path is not active.
- `OperationLogHydratorService`, `OperationLogSnapshotService`, `OperationLogCompactionService`, `OperationLogMigrationService`, and `OperationLogRecoveryService` implement boot replay, snapshots, compaction, migration, and recovery.
- `src/app/core/persistence/legacy-pf-db.service.ts` reads the pre-operation-log `pf` IndexedDB for migration.
- `SchemaMigrationService` delegates state/operation migrations to `packages/shared-schema/src/migrations/`. `CURRENT_SCHEMA_VERSION` is 4. The repository's explicit policy in `packages/shared-schema/src/schema-version.ts` warns that a version bump alone does not make incompatible operations safe for older released clients.
- `ValidateStateService`, Typia validation in `src/app/op-log/validation/validation-fn.ts`, payload validation, and `data-repair.ts` protect hydration and sync checkpoints. Full-state repair produces a durable Repair operation.

### Synchronization, SuperSync, encryption, and accounts

- `OperationLogSyncService`, `OperationLogUploadService`, `OperationLogDownloadService`, `RemoteOpsProcessingService`, `ConflictResolutionService`, `VectorClockService`, `SyncImportFilterService`, `SyncCycleGuardService`, and `SyncSessionValidationService` under `src/app/op-log/sync/` form the operation-sync pipeline.
- `SyncProviderManager`, `WrappedProviderService`, and `FileBasedSyncAdapterService` under `src/app/op-log/sync-providers/` abstract SuperSync and file-based WebDAV/Nextcloud/Dropbox/OneDrive/local-file providers. Shared provider implementations live in `packages/sync-providers/`; generic clock/encryption/operation logic lives in `packages/sync-core/`.
- `packages/shared-schema/src/entity-types.ts` is a client/server allow-list. SuperSync rejects unknown entity types in `packages/super-sync-server/src/sync/services/validation.service.ts`. A new WorkSession, Event, Folder, WeeklyTemplate, or generalized Reminder entity therefore requires coordinated client, shared package, and server work.
- `OperationEncryptionService` encrypts operation payloads before upload and authenticates metadata on decrypt. `packages/sync-core/src/encryption.ts` uses AES-256-GCM with Argon2id-derived keys and legacy PBKDF2 fallback. Metadata such as operation/entity identity remains server-visible; personal payload content is encrypted.
- `packages/super-sync-server/` is a Fastify/PostgreSQL/Prisma service. `prisma/schema.prisma` persists users, passkeys, pending passkey registrations, encrypted operation payloads, sync snapshots, and advisory `SyncDevice` rows.
- `packages/super-sync-server/docs/authentication.md`, `packages/super-sync-server/src/api.ts`, `packages/super-sync-server/src/auth.ts`, and `packages/super-sync-server/src/passkey.ts` verify production passkey and email magic-link registration/login/recovery. Traditional passwords remain only as legacy/test-compatible nullable fields, not the production flow.
- `SuperSyncDevicesService` and `DialogSyncDevicesComponent` list devices and support “sign out all other devices.” Selective device revocation is intentionally absent because current JWTs are account-wide (`tokenVersion`); deleting a `SyncDevice` row would not revoke access.
- Account authentication and encryption-password setup are separate. `SuperSyncEncryptionSetupService`, encryption-toggle/change-password dialogs, `SyncCredentialStore`, and restore flows preserve that boundary. A recovery key/file or trusted-device key-transfer design is not implemented.

### Backups, import/export, archive, and deletion

- `BackupService` in `src/app/op-log/backup/backup.service.ts` exports/imports complete snapshots, fills missing legacy slices, validates/repairs data, captures pre-replacement recovery points, and writes a full-state `BACKUP_IMPORT` operation.
- `StateSnapshotService` captures synchronized model state including IndexedDB archives. `migrate-legacy-backup.ts` handles older backup shapes.
- `FileImexComponent` in `src/app/imex/file-imex/` downloads readable JSON backups and privacy exports and restores files.
- `LocalBackupService` in `src/app/imex/local-backup/local-backup.service.ts` makes debounced/periodic automatic backups on Electron and native Android/iOS. Electron uses rotated files; mobile uses guarded two-slot rings. Browser/PWA does not receive an automatic external file backup from this service, although the operation database maintains up to three recovery points around destructive state replacement.
- `BackupSourcesService` and `DialogBackupsListComponent` combine operation recovery points, Electron files, and mobile slots for restore.
- `ArchiveService` and `ArchiveModel` under `src/app/features/archive/` move completed Tasks and historical time tracking into young/old archives. Archive is a performance/history mechanism, not Trash.
- Task deletion is hard deletion from active state with short-lived Undo support via `undoTaskDeleteMetaReducer`; there is no synced soft-deletion state, retention window, or general Task/Folder/Event restore workflow.
- Current JSON backups are readable plaintext unless a user separately protects the file. There is no Planstrand encrypted backup container and no CSV export.

### Platforms and responsive UI

- Electron support is under `electron/` (`main.ts`, `ipc-handler.ts`, preload and window/tray/update helpers) with `build/electron-builder*.yaml`. It provides desktop backup files, global shortcuts, tray integration, file access, and Windows/macOS/Linux packaging.
- Web/PWA uses Angular's service worker configured in `src/main.ts` and `ngsw-config.json`; `e2e/pwa/offline-reload.spec.ts` and `update-activation.spec.ts` exercise offline/update behavior.
- Android is a Capacitor/native wrapper under `android/`, with share/quick-capture queues, widgets, background sync, foreground tracking/focus services, native reminder delivery, safe-area/keyboard handling, and Kotlin tests.
- iOS is under `ios/App/`, including `AppDelegate.swift`, Capacitor plugins, private filesystem/reminder bridges, and Share Extension/Share Inbox. There is no watchOS app, consistent with V1 non-goals.
- `LayoutService` in `src/app/core-ui/layout/layout.service.ts` defines only `<600px` and `<398px` breakpoints. The rest of tablet behavior is component-specific CSS/viewport logic; there is no explicit medium/tablet composition tier.
- `MagicSideNavComponent` supports desktop full/compact modes, resizable width, and a mobile overlay. `MobileBottomNavComponent` currently routes to Today and Planner, provides global Add, a panels menu, and the nav drawer; it does not implement the requested Today/Week/Tasks/Calendar set.
- Existing Task details use a side panel on desktop and touch-oriented bottom-sheet behavior in mobile code. Schedule has mobile-specific panels/gestures, but the overall Today three-pane and tablet compositions do not yet exist.

### Themes and design tokens

- `GlobalThemeService` in `src/app/core/theme/global-theme.service.ts` supports light/dark/system, project/tag coloring, platform title/status surfaces, wallpapers, and Material variable integration. Dark-mode choice is device-local in local storage.
- `CustomThemeService`, `ThemeStorageService`, `ThemeSelectorComponent`, `src/styles/_css-variables.scss`, `src/styles/themes.scss`, and themes under `src/assets/themes/` provide a mature theme system.
- `src/app/core/theme/theme-contract.const.ts` defines required/recommended surface, ink, separator, divider, and scrim tokens. This can be extended toward Planstrand's semantic design tokens without replacing it.
- No application-wide Comfortable/Compact content-density setting exists. Sidebar “compact mode” is navigation width, not density.

### Testing infrastructure

- Angular unit/integration tests are co-located as `*.spec.ts` and run through `ng test`/Karma/Jasmine. `package.json` provides focused, sharded, fast, and multiple-time-zone commands.
- Operation-log integration, regression, migration, conflict, multi-tab, encryption, and performance tests live under `src/app/op-log/testing/` and beside each service.
- `packages/sync-core/`, `packages/shared-schema/`, `packages/sync-providers/`, and `packages/super-sync-server/` have their own Node/Vitest suites; the server includes PostgreSQL/PGlite integration tests.
- Playwright E2E tests under `e2e/tests/` cover tasks, Planner, Schedule, recurring tasks, reminders, calendar imports, projects/tags, migrations, import/export, mobile, and extensive SuperSync scenarios. PWA and packaged Electron smoke suites are separate.
- Native tests exist under `android/app/src/test/` and `android/app/src/androidTest/`, including encryption compatibility, background sync, reminders/widgets, WebView behavior, and lifecycle bridges.

## 2. Reuse / Extend / Replace Matrix

“Replace” below means replace the feature's domain semantics incrementally behind existing interfaces, not rewrite Angular/NgRx or delete upstream functionality at once.

| Planstrand feature                     | Classification              | Rationale and intended seam                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recursive folders                      | New implementation required | `MenuTreeFolderNode` is recursive but owns navigation nodes, while Section is flat and Project owns Tasks. Add a normalized Folder domain with stable `parentId` and order; reuse menu-tree rendering/DnD patterns, not its persisted meaning.                                                                                                |
| Inbox                                  | Reuse largely as-is         | `INBOX_PROJECT` already gives stable, title-only capture and default routing. Later map it to the system Inbox Folder without changing Task identity.                                                                                                                                                                                         |
| Master Tasks                           | New implementation required | Existing work-context pages show one Project/Tag, not one continuous hierarchy. Build a hierarchy selector/view over canonical Task and Folder entities. Reuse Task rows, add bar, inspector, search, and DnD primitives.                                                                                                                     |
| This Week                              | Refactor                    | Planner day arrays are a useful ordered-membership base, but current semantics couple planning to due/scheduled fields and lack week-only membership. Evolve planning membership independently from calendar scheduling.                                                                                                                      |
| Today                                  | Refactor                    | Reuse virtual Today ordering, selectors, overdue handling, and task UI, but decouple Today membership from `dueDay`/`dueWithTime` and combine it with WorkSessions in a dedicated composition.                                                                                                                                                |
| Priorities                             | Extend                      | Existing optional 3-level priority, UI, sorting hooks, and sync behavior are reusable. Migrate safely to four explicit P1-P4 levels with None and update labels/order/colors.                                                                                                                                                                 |
| Optional task estimates                | Refactor                    | Existing duration UI/time tracking is valuable, but required numeric `timeEstimate` and zero defaults erase “unknown.” Migrate legacy `0` to Unknown, preserve positive values, use nullable/optional Planstrand semantics, and expose `0` only through legacy compatibility adapters.                                                        |
| Multiple Work Sessions per Task        | New implementation required | No persisted entity exists; current Task can hold only one authoritative block. Add a normalized entity/store with `taskId` foreign key.                                                                                                                                                                                                      |
| Task/WorkSession completion separation | New implementation required | WorkSession needs its own `completedAt` and reducers. V1 completion is manual through an explicit user action; elapsed end time never completes a session, and no WorkSession transition may dispatch Task completion. Add explicit invariant tests.                                                                                          |
| Year/Month/Week/Day calendar           | Extend                      | Reuse Schedule service/view components, grid math, Day/Week/Month, drag/resize, and provider overlays. Add Year and converge all four views on a shared `CalendarDisplayItem` selector.                                                                                                                                                       |
| Deadlines                              | Reuse largely as-is         | Task deadline fields, selectors, Planner markers, reminders, and tests are already separate from due scheduling. Rename/presentation changes can wait; retain their semantics while WorkSessions replace time-block use of due fields.                                                                                                        |
| Weekly templates                       | New implementation required | `TaskRepeatCfg` has useful recurrence utilities but generates Tasks. Add WeeklyTemplate/occurrence state with date ranges, an explicit IANA timezone, multiple templates, reminders, and exception/split-series editing. V1 entries produce Event-like occurrences, never Task-linked WorkSessions.                                           |
| Recurrence                             | Extend                      | Reuse date calculations and iCal expansion concepts, but introduce a shared recurrence/exception model usable by Event and WeeklyTemplate without forcing Task generation.                                                                                                                                                                    |
| Reminders                              | Refactor                    | Reuse scheduling/delivery workers and platform adapters. Replace the one-per-Task NOTE/TASK record with normalized, multi-target reminder rules for Task, WorkSession, Event, and template/series occurrences.                                                                                                                                |
| Account system                         | Extend                      | Passkey and magic-link server flows, account deletion, auth UI, and local-without-account behavior already meet much of V1. Add Planstrand product configuration, account/settings composition, and key recovery; do not couple login to decryption.                                                                                          |
| Local-first storage                    | Reuse largely as-is         | NgRx + durable IndexedDB operation log already updates locally and syncs later across web/Electron/native wrappers. Add new slices through the same mechanism; do not introduce per-task files or a second database.                                                                                                                          |
| Encrypted sync                         | Extend                      | AES-GCM/Argon2id E2EE and encrypted operation/snapshot flows are substantial foundations. Cover all new entity payloads, preserve file-provider compatibility, and require an advertised Planstrand entity/schema capability before server upload. The recovery design remains unresolved and must be settled before making E2EE the default. |
| Device management                      | Refactor                    | Device listing and global sign-out exist. Per-device revocation requires server-side per-device sessions/tokens; deleting advisory device rows is not sufficient.                                                                                                                                                                             |
| Backups                                | Extend                      | Reuse complete snapshots, import migration/repair, recovery ring, rotated desktop/mobile backups, and restore UI. Add an encrypted backup envelope as default and explicit readable JSON/CSV exports; add a browser snapshot strategy.                                                                                                        |
| Trash                                  | New implementation required | Archive and one-action Undo are not soft deletion. Add synced deletion metadata, deletion-age display, restore relationships, and explicit permanent-delete rules without repurposing Archive. V1 performs no automatic age-based purge.                                                                                                      |
| External calendar integrations         | Extend                      | iCal, Google, CalDAV, provider capabilities, caching, and overlays are strong adapter foundations. V1 displays external events and supports explicit export of selected Planstrand Events and provider-supported WorkSessions. It does not require automatic full two-way entity sync; WorkSessions remain private by default.                |
| Desktop navigation                     | Refactor                    | Reuse shell, collapsible/resizable sidebar, keyboard shortcuts, and nav tree. Replace primary destination configuration and later bind the tree to Planstrand Folder hierarchy.                                                                                                                                                               |
| Tablet navigation                      | Extend                      | Reuse responsive sidebar/overlay and touch components, but add an explicit medium breakpoint and tested landscape/portrait two-pane rules.                                                                                                                                                                                                    |
| Mobile navigation                      | Refactor                    | Keep the bottom-nav shell, global Quick Add, sheets, safe areas, and gestures. Change destinations/compositions to Today/Week/Tasks/Calendar with secondary screens under a menu.                                                                                                                                                             |
| Responsive layout                      | Refactor                    | Preserve shared components and CSS foundations, but define phone/tablet/desktop layout contracts instead of relying almost entirely on the 600px cutoff.                                                                                                                                                                                      |
| Drag-and-drop scheduling               | Refactor                    | Reuse CDK wiring, pointer/touch fixes, calendar hit testing, move/resize geometry, and keyboard alternatives. Change the write target from Task `dueWithTime`/`timeEstimate` to WorkSession create/update actions.                                                                                                                            |

### V1 traceability

| Product-spec V1 item                 | Plan coverage                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1. Recursive folders                 | Folder entity/migration in sections 3–5; hierarchy risks in section 6.                                            |
| 2. Inbox                             | Existing `INBOX_PROJECT` reused, then mapped to system Inbox Folder.                                              |
| 3. Master hierarchical task page     | Master Tasks matrix row and Phase 5.                                                                              |
| 4. Priority                          | Four-level extension and priority migration.                                                                      |
| 5. Optional due dates                | Existing deadline/due fields retained independently of WorkSessions.                                              |
| 6. Optional estimated duration       | Legacy zero migrates to Unknown, positive values are preserved, and new estimates are nullable/optional.          |
| 7. This Week                         | Independent Planner week membership, Phases 2 and 6.                                                              |
| 8. Today                             | Independent day membership and responsive Today composition, Phases 2 and 6.                                      |
| 9. Multiple WorkSessions             | First-class WorkSession entity, Phases 1 and 3.                                                                   |
| 10. Standalone Event                 | Local Event entity and Phase 7.                                                                                   |
| 11. Year/Month/Week/Day              | Unified calendar projection plus Year in Phase 7.                                                                 |
| 12. Recurring events                 | Shared recurrence/exception model in Phase 8.                                                                     |
| 13. Weekly templates                 | WeeklyTemplate aggregate and Phase 8.                                                                             |
| 14. Drag-and-drop scheduling         | Existing gesture geometry retargeted to WorkSession in Phase 3.                                                   |
| 15. Resizable WorkSessions           | Existing resize UI retargeted to WorkSession in Phase 3.                                                          |
| 16. Manual Task completion           | Existing Task completion retained; never driven by a session reducer.                                             |
| 17. Separate WorkSession completion  | Explicit manual WorkSession completion and no Task side effect in Phases 1 and 3.                                 |
| 18. Reminders                        | Normalized multi-target Reminder and Phase 9.                                                                     |
| 19. Overdue handling                 | Existing selectors reused in the Phase 6 Today composition; daily notification policy in Phase 9.                 |
| 20. Responsive desktop/tablet/mobile | Platform inventory plus Phases 5, 6, and 13.                                                                      |
| 21. Light/dark                       | Existing `GlobalThemeService` retained.                                                                           |
| 22. Comfortable/Compact density      | New semantic density configuration/tokens in Phase 13.                                                            |
| 23. Local-first persistence          | Existing operation log/IndexedDB pipeline reused for every new entity.                                            |
| 24. Account sign-in                  | Existing passkey/magic-link system extended in Phase 11.                                                          |
| 25. Encrypted synchronization        | Existing E2EE retained and extended, with recovery in Phase 11.                                                   |
| 26. Device management                | Per-device session/revocation refactor in Phase 11.                                                               |
| 27. Backup/export/restore            | Existing snapshots/restore extended with encrypted envelopes in Phase 12.                                         |
| 28. Trash                            | Explicit soft-delete/restore and user-initiated permanent deletion in Phase 10; no V1 automatic purge.            |
| 29. Optional external calendars      | External display plus explicit selected Event/WorkSession export in Phase 13; no required automatic two-way sync. |
| 30. Public repository safety         | Existing environment/template boundary retained; no runtime secrets or user exports enter Git.                    |

## 3. Proposed Planstrand Domain Model

### Task

Extend the existing `Task` rather than replace IDs or clone records. The target shape is conceptually:

```ts
interface Task {
  id: string;
  title: string;
  isDone: boolean;
  doneOn?: number | null;
  folderId?: string | null;
  priority?: 'P1' | 'P2' | 'P3' | 'P4' | null;
  estimateMs?: number | null;
  dueDay?: string | null;
  dueWithTime?: number | null; // deadline/due semantics only after transition
  deadlineDay?: string | null; // retained during compatibility period
  deadlineWithTime?: number | null;
  tagIds: string[];
  parentId?: string; // retain upstream subtask/checklist semantics
  subTaskIds: string[];
  repeatCfgId?: string;
  deletedAt?: number | null;
  created: number;
  modified?: number;
}
```

`folderId` is organizational ownership. `parentId` remains Task/subtask composition; it must not be reused for Folder ancestry. During migration, `projectId` remains a compatibility field and existing Project/issue/plugin features continue to function. A compatibility meta-reducer or service must keep `projectId` and `folderId` coherent until Project-backed ownership can be retired deliberately.

Use `null`/absent for an unknown Planstrand estimate. During migration, legacy `timeEstimate === 0` becomes Unknown and legacy `timeEstimate > 0` preserves its millisecond value. Keep a compatibility selector/adapter that exposes Unknown as `0` only to the legacy plugin/time-tracking API where a number remains required; new Planstrand writers must not use `0` as the canonical Unknown representation.

### Folder

Add a normalized Folder entity rather than embedding recursive child arrays:

```ts
interface Folder {
  id: string;
  title: string;
  parentId: string | null;
  childFolderOrder: string[];
  taskOrder: string[];
  systemKind?: 'INBOX' | null;
  color?: string | null;
  deletedAt?: number | null;
  created: number;
  modified: number;
}
```

`parentId` supplies stable recursive identity; ordered ID arrays supply manual ordering. Enforce no cycles, no missing parent, and no duplicate order membership in validation/repair. Arbitrary practical depth should be supported, but selector/render traversal must be iterative or depth-guarded to avoid stack and pathological-sync payload failures. Expanded/collapsed state is device-local view state keyed by Folder ID; it is not part of the synchronized Folder entity and may differ by device or view.

The Inbox should be a stable system Folder mapped from `INBOX_PROJECT`. Tasks without an explicit Folder should resolve to Inbox for capture and migration. Existing menu-tree folders can inform initial Folder placement only where their contained Project nodes establish an unambiguous mapping; they must not be mistaken for existing task containers.

### Planning membership without Task duplication

General/Master Tasks is a selector over every non-trashed Task organized by `folderId`; it is not a stored copy.

This Week, Today, and calendar scheduling must remain independent:

- Keep one Task ID.
- Persist one revisioned `PlanningRecord { id: Task.id, placement: { target: { type: WEEK | DAY, key: DB date }, orderKey } | null, revision }` per Task in the `PLANNING` adapter. The placement is the conflict identity; week/day lists are derived. Legacy `PLANNER` remains solely for historical replay.
- A Task in a day list is also derived into that week's view, while a week list supports “this week, no day.” Moving from week-only to a day changes membership references, not Task identity.
- Today selects the current date's planning IDs plus overdue/scheduled/completed groupings. It does not infer intent merely from a calendar block.
- Calendar selectors read WorkSessions, Events, deadlines, template occurrences, and external adapters. A Task appears on Calendar only through a WorkSession or deadline projection.

Compatibility selectors retain the current screens, reading canonical placements after migration. Due dates, timed schedules, deadlines, and WorkSessions remain independent. A single absolute dense key plus lexical Task-ID tie-break replaces synced splice/index instructions.

### WorkSession

Add a normalized entity because one Task may have many independently editable/completable blocks. Phase 1 intentionally persists only the foundational fields:

```ts
interface WorkSession {
  id: string;
  taskId: string;
  start: number;
  end: number;
  completedAt?: number | null;
  created: number;
  modified: number;
}
```

Require `end > start` and a live `taskId`. V1 completion is manual: only an explicit user action sets or clears `completedAt`; passing `end` has no completion effect. Completion updates only WorkSession and never dispatches Task completion. Task remaining-effort selectors may sum manually completed sessions when an estimate exists.

Phase 1 is an infrastructure-only foundation and does not yet create user-visible calendar sessions. Before Phase 3 enables timed scheduling writes, WorkSession is extended with a required IANA timezone (for example `America/Vancouver`) alongside its start/end instants. Reminder linkage, Trash behavior, template provenance, external-calendar export identity, notes, and other future fields are deliberately excluded from Phase 1 and introduced only in the later phase that defines each contract.

Phase 3B adds `timeZone?: string` at the persisted-model boundary so Phase 1 snapshots and operations remain readable without backfill. New service-created sessions always persist a valid explicit IANA zone: an explicit choice wins, otherwise `LocalizationConfig.timeZone` resolves through the Phase 3A utility to the system zone. Invalid explicit/configured zones or an unavailable system zone reject creation; there is no UTC fallback. Updates may set a valid zone but cannot clear it. Completion, Task integrity, and start/end instant semantics remain unchanged.

The existing WORK_SESSION create/update operation envelopes carry this additive field without new operation vocabulary. Pre-3B Planstrand exact-key reducers reject timezone-bearing creates/updates, preserving the operation payload rather than applying different scheduling semantics. Mixed-version peers need upgraded readers before these writes can converge; the WORK_SESSION server capability alone does not establish field-level client compatibility. Phase 3B adds no capability mechanism, schema bump, migration, background repair, legacy Task conversion, or calendar projection.

### Event

Add a canonical local Event entity:

```ts
interface EventBase {
  id: string;
  title: string;
  notes?: string;
  folderId?: string | null;
  recurrenceSeriesId?: string;
  reminderIds?: string[];
  externalRefs?: ExternalCalendarRef[];
  deletedAt?: number | null;
  created: number;
  modified: number;
}

interface TimedEvent extends EventBase {
  start: number;
  end: number;
  allDay: false;
  timeZone: string; // IANA zone, e.g. America/Vancouver
}

interface AllDayEvent extends EventBase {
  allDay: true;
  startDate: string; // YYYY-MM-DD
  endDateExclusive: string; // YYYY-MM-DD
  // no midnight-UTC start/end representation
}

type Event = TimedEvent | AllDayEvent;
```

Timed Events carry their instant range and explicit IANA timezone. All-day Events use date-only semantics and must never be normalized to midnight UTC instants. New timed Events and, from Phase 3 onward, new WorkSessions default to the user's configured/default timezone unless the user chooses another.

External provider projections remain adapters. Do not copy every Google/CalDAV event into the Planstrand Event store by default. A `CalendarDisplayItem` selector should merge local Event, WorkSession, Task deadline projections, WeeklyTemplate occurrences, and `CalendarIntegrationEvent` with capability flags (`canMove`, `canResize`, `canDelete`, `isReadOnly`).

### WeeklyTemplate and recurrence

Use a normalized WeeklyTemplate aggregate plus explicit occurrence exceptions. A template represents one named schedule and contains ordered entry IDs; entries carry title, weekday(s), local start/end time, optional Folder/category, reminders, and active date range. The template has a required configured IANA timezone, and recurrence is evaluated as local wall time in that zone before occurrences are converted to instants for display. New templates default to the user's configured/default timezone unless another is chosen.

V1 WeeklyTemplate entries model baseline commitments such as lectures, labs, recurring work hours, gym, lunch, and regular meetings. They produce Event-like calendar occurrences and do not create Task-linked WorkSessions. A future recurring task-work template is a separate extension and must not be anticipated by fields in the V1 template or WorkSession model. A shared recurrence series/rule type may be justified for Event and template entries, but do not force Task recurrence into the new abstraction in the first migration.

Exceptions need stable occurrence keys based on series/template entry and original local date/time, with operations for override, cancellation, and split point. “This and future” should create a successor series/template segment and terminate the predecessor; it should not rewrite an unbounded occurrence list.

### Reminder

Refactor Reminder into normalized multi-target records:

```ts
interface Reminder {
  id: string;
  targetType: 'TASK' | 'WORK_SESSION' | 'EVENT' | 'TEMPLATE_OCCURRENCE';
  targetId: string;
  trigger:
    | { kind: 'ABSOLUTE'; at: number }
    | { kind: 'RELATIVE_START' | 'RELATIVE_DUE'; offsetMs: number };
  snoozedUntil?: number | null;
  lastDeliveredOccurrence?: string;
  deletedAt?: number | null;
}
```

Domain selectors calculate occurrences; existing web/Electron/Capacitor services deliver them. Multiple Reminder IDs may point to the same target.

## 4. Data Migration Strategy

### Migration rules and order

1. Capture a validated full snapshot/recovery point before any destructive transformation.
2. Deploy readers/defaults before writers. New clients must open older snapshots and older backups with empty/default new slices.
3. Require a successful Planstrand capability handshake before clients upload any Planstrand-specific entity operation.
4. Backfill relationships through idempotent migrations or explicit one-time operations; never mutate silently outside the operation log.
5. Keep compatibility fields and dual-read selectors until sync, backup import, plugin API, and all UI writers use the new source of truth.
6. Remove or rename legacy fields only in a later release after downgrade behavior and mixed-client sync are explicitly solved.

The current schema-version policy means a bump is not a fleet-safety mechanism: old clients can reject or historically mis-handle unknown operations. A destructive transformation would additionally require `packages/shared-schema/src/migrations/` and a carefully justified version bump, but that still does not replace the capability handshake below.

### Planstrand sync capability contract

Before Phase 1 enables even minimal WorkSession writes, an API-based sync server must advertise a machine-readable capability set or minimum compatible Planstrand schema describing the entity operation types it accepts. Capabilities must be independently checkable for `WORK_SESSION`, `FOLDER`, `EVENT`, `WEEKLY_TEMPLATE`, and any future generalized `REMINDER` entity rather than inferred from successful authentication or a generic SuperSync version string.

The upload gate must compare every pending operation's entity/schema requirement with the server-advertised capabilities. When the connected server is incompatible:

- the local Planstrand action, NgRx update, and durable local operation still succeed;
- unsupported operations remain local and pending and are not sent to that server;
- sync reports a clear, actionable compatibility limitation without repeatedly retrying a known-invalid upload;
- supported legacy operations may sync only if doing so cannot create a misleading partial state;
- the client performs no destructive downgrade, field stripping, entity conversion, or fallback to an upstream Task representation.

Authentication, TLS, and E2EE negotiation do not prove entity compatibility. In particular, an upstream SuperSync deployment must be treated as incompatible with Planstrand-specific entities until it advertises the matching capabilities. Phase 0 must define the handshake response, caching/expiry behavior, offline behavior, error UI, partial-capability policy, and upgrade transition, then test them against compatible, incompatible, stale, missing, and falsely advertised server responses.

### New empty entity slices

- Existing shape: `AppDataComplete` has no Folder, WorkSession, Event, WeeklyTemplate, generalized recurrence, or normalized multi-target Reminder slices.
- Proposed shape: add normalized NgRx slices with empty defaults in `MODEL_CONFIGS`, entity-registry entries, feature reducers/selectors, snapshot extraction, validation/repair, and operation mappings.
- Backwards compatibility: `withDefaultModelSlices()` must fill absent slices for legacy database/backup import. Normal snapshot hydration must also default an absent slice before strict Typia validation, not only the manual backup path.
- Order: server/shared allow-list and capability advertisement first; client handshake/upload gate second; client read/default/validate support third; local write actions fourth; UI fifth.
- Failure/recovery: preserve pre-migration recovery points; abort rather than install partial state when any new slice fails validation. Repair may reconstruct empty optional slices but must never erase a nonempty malformed slice without surfacing it.
- Sync: test create/update/delete/LWW/multi-entity conflict, encrypted upload/download, compaction, full-state import, file providers, and mixed snapshot versions for each entity type.

### Projects/menu tree to Folder ownership

- Existing shape: Task requires `projectId`; Project contains task/backlog arrays; menu-tree folders recursively contain Project/Tag nodes; Section separately groups Task IDs.
- Proposed shape: Folder is canonical hierarchy; Task gains optional `folderId`; Project remains during compatibility.
- Backwards compatibility: create one Planstrand Folder for every active Project, using the same ID where collision-safe; map `INBOX_PROJECT` to the system Inbox Folder; reproduce menu-tree folder nesting only where the Project-to-folder mapping is unambiguous; and place ambiguous or unfiled Tasks safely in Inbox. Preserve original Projects throughout the compatibility period, preserve Tags, and preserve Sections as Sections rather than automatically converting them to nested Folders.
- Order: create Folders; validate acyclic hierarchy; populate `folderId`; reconcile order; enable dual-read; later switch Master Tasks writers; only then consider hiding legacy Project navigation.
- Failure/recovery: migration is idempotent and records deterministic mappings. A cycle/collision falls back to a recovered top-level Folder with a report, not data loss.
- Sync: folder move plus Task move must be operation-friendly. Avoid a single unbounded multi-entity move for a large subtree; changing a Folder's `parentId` should move descendants by reference.

### Planning membership separation

- Existing shape: `PlannerState.days`, `TODAY_TAG.taskIds`, `Task.dueDay`, and `Task.dueWithTime` overlap. Scheduling reducers remove/add IDs across these stores.
- Implemented shape: normalized per-Task `PLANNING` placements. `PLANNING_V1` Set/Remove carries a complete absolute placement or its Task ID, independently of legacy scheduling.
- Backwards compatibility: schema 4 → 5 projects only date-addressable evidence: explicit Planner days, then Today ordering backed by a valid dueDay, then other valid dueDay Tasks. Tasks and schedules remain intact; ambiguous Today/time-only entries are not promoted.
- Order: migrate before authoritative selectors; redirect current gestures to Placement actions; keep legacy reducers for replay. Historical cleanup and current scheduling never mutate canonical Planning. WorkSession calendar projection remains Phase 3.
- Failure/recovery: deterministic dedupe rules choose one order per day and preserve otherwise orphaned Tasks in week/day lists. Log/report inconsistent legacy combinations.
- Sync: plan-day/week operations and session moves are different entity intents. They must not share an action whose older client interprets a day plan as a due-date change.

### Legacy scheduled Task to WorkSession

- Existing shape: one `dueWithTime` timestamp plus `timeEstimate` provides the scheduled block; repeat projections may create scheduled Task instances.
- Proposed shape: one WorkSession per legacy timed Task, referencing the same Task; future drops create additional WorkSessions.
- Backwards compatibility: use a deterministic migration ID derived from Task ID and original timestamp so repeated migration cannot duplicate sessions. Retain legacy fields during dual-read and mark migrated provenance.
- Ambiguity: the old duration may be an estimate rather than intended session length. Preserve it as the migrated block length for visual continuity, but do not infer that it is the total task estimate in the new model. This rule should be explained in release/migration UI.
- Timezone: perform this backfill in Phase 3, after the WorkSession timezone extension exists. Preserve the original instant and assign the user's configured/default IANA timezone at migration time unless reliable provider/source timezone metadata exists. Record enough migration provenance to keep retries deterministic if the user's default later changes.
- Order: add entity support; backfill; render both with dedupe; switch drag/resize; stop writing legacy timed scheduling; clear/deprecate only in a later migration.
- Failure/recovery: if duration is invalid/zero, create no silent arbitrary block; keep the Task legacy-renderable and surface a migration issue/default-length choice.
- Sync: concurrent old-client Task reschedules and new-client WorkSession edits can diverge. Gate new writers or maintain a temporary one-way compatibility bridge for the single migrated session; never let that bridge collapse additional sessions.

### Priority and estimate semantics

- Priority existing shape: absent/null or numeric Low=1, Medium=2, High=3.
- Proposed priority shape: None or P1-P4. Because numeric meanings conflict, do not reuse the same numbers without a migration marker. Store explicit strings or a versioned field; map High→P2, Medium→P3, Low→P4 by default and leave P1 available. Preserve a migration audit/test fixture.
- Estimate existing shape: required `timeEstimate: number`, usually `0`.
- Proposed estimate shape: `estimateMs?: number | null`, or an explicit `hasEstimate` discriminator while retaining numeric compatibility.
- Backwards compatibility: migrate legacy `timeEstimate === 0` to absent/null Unknown and preserve every legacy `timeEstimate > 0` value. The plugin API compatibility adapter continues returning a number and maps Unknown back to `0` only at that boundary.
- Sync: use optional additive fields and marker-aware reducers where possible; do not let old clients overwrite a new P1/P4 meaning with incompatible numeric semantics.

### Timezone and all-day normalization

- Existing shape: Task `dueWithTime` and most schedule entries are instants interpreted in the current device zone; provider events may carry provider-specific timezone/all-day information; legacy all-day paths can resemble a duration or midnight timestamp.
- Proposed shape: every timed Event and every user-visible WorkSession carries an explicit IANA timezone alongside start/end instants. WeeklyTemplate carries one configured IANA timezone and evaluates weekday/local-time recurrence in that zone. All-day Events use `startDate`/`endDateExclusive` date-only fields and never midnight UTC sentinels.
- Backwards compatibility: Phase 1 WorkSession remains an empty/minimal infrastructure slice. Phase 3 adds timezone before enabling user-visible session writes and assigns migrated legacy timed Tasks the configured/default zone while preserving their instant. Provider adapters retain a trustworthy provider zone when available. Ambiguous all-day provider records remain adapter projections until their date semantics are known; they are not silently converted into local Events.
- Migration order: establish configured/default timezone handling; add timezone-aware serializers/validators; extend WorkSession; backfill legacy sessions; then enable session/calendar UI writes. Event and WeeklyTemplate are introduced with timezone/date-only semantics from their first persisted version.
- Failure/recovery: an invalid or unavailable IANA zone blocks the affected item migration/write and surfaces a migration issue rather than falling back silently to UTC. Retain source data for retry and restore.
- Sync implications: timezone identifiers and date-only fields are encrypted domain payloads. Conflict resolution must not merge a start/end change independently from its timezone when that would alter the intended local time; recurrence exception keys include the series timezone and original local occurrence identity.

### Reminder migration

- Existing shape: array records for Task/Note plus `Task.remindAt`, `reminderId`, `deadlineRemindAt`, and repeat preset.
- Proposed shape: normalized Reminder records with target and trigger.
- Backwards compatibility: deterministically convert each valid existing reminder and deadline reminder while leaving legacy fields readable during transition. Notes can remain supported even though not central to Planstrand V1.
- Failure/recovery: invalid timestamps remain visible as migration issues; do not silently drop. Platform notification IDs must be cancelled/rescheduled only after the new record commits.
- Sync: recurrence occurrence keys and snooze state need deterministic conflict rules to avoid duplicate delivery across devices.

### Trash and soft deletion

- Existing shape: hard delete plus transient Undo; completed-task Archive is separate.
- Proposed shape: optional `deletedAt` and restore-parent/order metadata on Task, Folder, and Event, with derived Trash selectors. WorkSessions may inherit Task trash visibility and also support direct soft deletion.
- Backwards compatibility: no existing record is initially trashed. Archive remains untouched.
- Order: make all selectors ignore trashed records where appropriate; add restore; change delete actions; add deletion-age display; add explicit permanent deletion last.
- Failure/recovery: restore to original relationship when valid, otherwise Inbox/root with a user-visible explanation. Permanent purge must be explicit, backed up, and safe under concurrent restore.
- Sync: a soft deletion is delete-wins unless a causally later restore operation exists. V1 never purges automatically based on deletion age. User-requested permanent deletion needs an explicit operation, confirmation, and recovery point; automatic causal/offline-safe retention is deferred until separately designed.

### Backups and encryption

- Existing shape: complete JSON state, operation recovery snapshots, Electron/mobile automatic copies.
- Proposed shape: versioned backup envelope containing KDF parameters, salt, authenticated ciphertext, metadata sufficient to identify format, and encrypted `AppDataComplete`; readable JSON/CSV remains an explicit warning path.
- Backwards compatibility: keep importing supported upstream JSON and legacy archives indefinitely or through a documented converter. Never overwrite the source backup during migration.
- Failure/recovery: authenticate/decrypt before state replacement; then run existing migration, validation, repair, and pre-import recovery capture.
- Sync: backup restore remains a full-state operation with a fresh baseline; importing a backup must not accidentally disable E2EE or reuse a stale device identity.

## 5. Implementation Phases

### Phase 0 — Compatibility contract and test fixtures

- Objective: codify current data, operation, and mixed-client behavior and define the mandatory Planstrand server capability handshake/upload gate before adding entity writers.
- Affected code: tests around `model-config.ts`, entity registry, shared schema, hydration, backup import, SuperSync capability/status APIs and validation, provider upload gating, and representative legacy fixtures.
- New code: capability response/contract, per-entity/schema requirement mapping, client compatibility state and upload gate, clear incompatibility reporting, and fixtures.
- Dependencies: none.
- Tests: old full snapshots, partial slices, encrypted operations, unknown entity rejection, file-provider round trip, downgrade behavior, compatible/incompatible/missing/stale/false capability responses, authentication-without-capability, continued local writes, unsupported operations remaining pending, and no destructive conversion or partial upload.
- Migration risk: none. Sync risk: medium because an incorrect capability gate can stall or partially sync data. UI impact: a compatibility status/error only.

### Phase 1 — WorkSession domain scaffold (recommended first implementation)

- Objective: add an empty normalized WorkSession store and invariant-preserving CRUD through the operation log, without changing Schedule UI or defining later reminder/Trash/template/integration contracts.
- Affected code: shared entity types/server allow-list, `FeatureStoresModule`, `MODEL_CONFIGS`, `RootState`, entity registry, action mapping/conversion, validation/repair/snapshots/backups, sync tests.
- New models/services: minimal `WorkSession { id, taskId, start, end, completedAt?, created, modified }`, adapter/reducer/actions/selectors, and `WorkSessionService`. No other persisted fields belong in Phase 1.
- Dependencies: Phase 0's tested capability contract and client upload gate. Local WorkSession writes do not depend on server compatibility; remote WorkSession upload additionally requires the connected server to advertise `WORK_SESSION` support.
- Tests: CRUD, exact persisted shape, task foreign key, end-after-start, explicit manual completion/uncompletion, passage of end time causing no state transition, no Task-completion side effect, encrypted multi-client sync only after capability success, incompatible-server upload suppression, LWW/conflicts, compaction, backup restore, and missing-slice hydration.
- Migration risk: low while slice stays empty. Sync risk: high if rollout order is wrong. UI impact: none.

### Phase 2A — Operation-vocabulary compatibility prerequisite

- Objective: close the mixed-client action-vocabulary risk before independent planning writes. Older clients preserve unfamiliar action strings under known `UPD`/`MOV` types and can mark a reducer no-op as processed; Phase 0 entity/schema negotiation does not prevent this.
- Receiver: the current remote action vocabulary is the immutable `KNOWN_ACTION_TYPES` union exact synthetic `LWW_UPDATE_ACTION_TYPES` generated from shared `ENTITY_TYPES`. Synthetic conflict resolutions intentionally sit outside `ActionType` and retain their full strings through the compact codec. Stop before any other action, retaining the interpretable prefix and freezing the cursor; schema-version checks take precedence. Unknown operation types and import reasons retain their existing update-required behavior.
- Protocol fence: semantically incompatible new action families must use a stable, immutable operation type unknown to older clients. An action name or schema bump alone is insufficient. Phase 2 chooses the production family identifier; Phase 2A adds no planning actions or membership.
- Server/upload: advertise `supportedOpTypes` from the server validation vocabulary; derive entity, schema, and operation-type requirements generically. Only the immutable deployed baseline may omit explicit operation-type advertisement. Unsupported future operations remain durable/pending and block the whole upload cycle until capability refresh observes server support.
- File providers: no HTTP handshake. Screen retained operations before snapshot hydration or deduplication, leave the logical cursor/revision uncommitted, and refuse single-file writes against an unapplied baseline and both layouts' writes containing incompatible retained operations before merge, trim, append, or compaction (including cold reloads). Tests exercise both single-file and split-file paths.
- Rollout limitation: already-released file clients can bypass the operation fence when hydrating snapshot-included operations. Frozen v19.1.0 also recovers a legacy backup beside a newer same-name envelope. Phase 2B isolates the authoritative namespace and introduces a durable snapshot manifest; a same-name version bump is insufficient.
- Validation: synthetic future operation types only; normal/piggyback/paginated/encrypted receive, whole-cycle upload blocking and server refresh, validation/advertisement agreement, and file revision/write safety.
- Status: Phase 2A is complete. Phase 2 also depends on validated Phase 2B. Phase 3 still requires completed Phase 2.

### Phase 2B — Planstrand file-sync namespace and snapshot compatibility manifest

- Released baseline: SP v2 single files, v3 split files and tombstones. Frozen v19.1.0 permits a delayed cached v2 backup write even when its primary CAS fails, then recovers that backup and conditionally restores v2 over a same-name newer primary. Backup neutralization timing cannot isolate these writers.
- Namespace: every Planstrand file uses a `planstrand-` prefix, including backups, migration locks and immutable snapshot names. No dual-write. Legacy names remain untouched import/recovery history; post-cutover legacy edits are never automatically imported.
- Protocol: `product: 'planstrand'`, literal `version: 4`, matching outer prefix, and `compatibility: { requiredOpTypes: [] }` at baseline. Both single and split layouts use v4. Discriminator, finite version and manifest are checked before the layout engine can stage a cursor or return a snapshot.
- Requirements: deterministic sorted union of existing remote requirements, the immutable build-level `PLANSTRAND_REQUIRED_FILE_OP_TYPES`, and published operation types outside `SUPER_SYNC_BASELINE_OP_TYPES`. Compaction, force/BackupImport/REPAIR snapshots, archive changes and cold restarts preserve this set. A readable incompatible primary never falls back to a weaker backup. Existing recovery copies have their manifests upgraded before a stronger primary can commit.
- Discovery: Planstrand presence wins irrespective of legacy timestamps. Legacy-only folders raise `LegacyFileImportRequiredError`; the service offers explicit `importLegacy` and `startFresh`, with cancellation implemented by not invoking either. Final settings UI is outside this prerequisite.
- Import: validate/decrypt source snapshots and retained operations, capture local recovery through a mandatory host hook, materialize through the host validation/migration/replay pipeline (including unapplied split tails), recheck source revisions, create the new single-file commit with create-only CAS and verify it. Existing Planstrand targets are not imported over. No source tombstones, migration markers or deletions. Interrupted legacy split migration must be completed by a legacy client before import.
- Concurrency: primary writes remain conditional. Import checks cannot create cross-file atomicity; LocalFile offers only best-effort revision checks and is a single-writer/backup transport. Stop legacy writers during one-time import when revisions are weak. Namespace isolation protects subsequent Planstrand writes even if those legacy writers resume.
- Activation contract: Phase 2 must introduce stable immutable `PLANNING_V1` and add it to `PLANSTRAND_REQUIRED_FILE_OP_TYPES` in the same implementation. Do not extend the deployed baseline. SuperSync must advertise the family before API upload is permitted. The production-vocabulary guard test fails when a new non-baseline enum family lacks the build requirement.
- Validation: namespace discovery/import, single and split layouts, compaction, cold start, recovery/encryption, target invalidation and frozen released-reader backup/write/delete isolation. No planning semantics are added here.

### Phase 2 — Independent planning membership

- Objective: make week/day intent independent from due/schedule state while retaining current screens.
- Affected code: Planner model/actions/reducer/selectors, Today selectors, shared planner/scheduling meta-reducers.
- New code: normalized adapter, absolute dense-key commands, derived week/day/Today selectors, bounded one-time legacy projection, and deterministic revisioned register merge.
- Dependencies: Phase 0, completed Phase 2A and validated Phase 2B. The first incompatible writer must enable both the operation family and build-level file manifest requirement.
- Tests: week-only, day-without-session, Today rollover, ordering, offline/conflicting moves, no Task duplication.
- Migration risk: medium. Sync risk: medium. UI impact: minimal/behind compatibility selectors.

### Phase 3 — WorkSession calendar projection and scheduling writes

- Status: **Phase 3 ready for final merge review**. The [final audit](PHASE_3_FINAL_AUDIT.md) records completed migrated replay and synthetic LWW provider evidence, full SuperSync results (326 passed, 0 failed, 14 skipped), repaired recurrence/scheduling compatibility regressions and the fair-baseline regular E2E classification (403 passed, 21 failed, 2 skipped). The remaining twelve baseline failures are not introduced by Phase 3; nine cases exercise explicitly deferred WorkSession reminder UI. No current in-scope Phase 3 product regression remains identified. No new product or persisted-model scope is introduced.
- Current boundary: configured/default timezone resolution, session creation/rescheduling, schedule projection, move/resize and exact-session unschedule are implemented. Manual completion/uncompletion are supported by the domain actions/service; no elapsed-time completion exists. A generic multi-session manager, richer session editor, timezone picker, reminders, recurrence, provider WorkSession export and broad legacy-field removal remain deferred. Existing schedule geometry uses the local viewing zone; persisted session zones and instant ranges are retained rather than reinterpreted on move/resize.
- Phase 3H: click/tap or right-click a removable WorkSession block to open its schedule menu and unschedule that exact `sourceId` through `WorkSessionService.remove()` / `removeWorkSession`. Unscheduling removes the entity only; Task completion, planning membership, estimate, legacy fields, time tracking and other sessions remain unchanged. Task deletion/archive still requires removing every referencing session first; there is no cascade.
- Migrated-session dismissal: optional `WorkSessionState.dismissedLegacySessionIds` (absent means empty) records exact deterministic legacy IDs. The existing removal reducer removes the entity and records its ID atomically in the same WORK_SESSION Delete operation, including remote replay when the entity is already absent. Startup backfill, stale backfill installation and legacy display fallback honor these IDs. Different legacy timestamps remain eligible; explicit scheduling can create the same identity again. No effect fan-out, soft-deleted entity, continuous mirroring or Task compatibility-field clearing is introduced.
- Phase 3H compatibility: snapshots/backups retain the optional marker; old snapshots need no migration. Delete action/payload/entity vocabulary is unchanged, but older readers do not derive suppression from Delete and pre-3H exact-key state validation rejects marker-bearing snapshots. Older full-state writers can drop the marker (or the entire slice) and resurrect legacy schedules; mixed-version use requires upgraded readers/writers. No schema bump provides a shield for that limitation, so none is added. No public/plugin API changes.
- Generic Task unschedule remains a legacy compatibility command clearing Task scheduling fields, never sessions (including multi-session Tasks). The Phase 3G session scheduling dialog continues hiding unschedule; use a rendered session's menu for actual WorkSession removal. Provider/integration/read-only event routing is unchanged.

- Phase 3D: `CalendarDisplayItem` is derived read-only infrastructure (not persisted/synced). Pure projectors and `selectLocalCalendarDisplayItems` normalize WorkSessions plus the existing timeline's legacy timed Tasks; `CalendarDisplayService.items` merges these with visible integration events and current registered-provider capabilities. WorkSessions retain exact start/end, persisted optional timezone, stable session identity and Task reference; titles are looked up from current Task entities (absent Task leaves title undefined). Completed sessions remain representable. Local WorkSession move/resize/delete flags are true and read-only is false; Phase 3F/3H interactions consume this capability metadata without persisting the projection.
- Read compatibility: the projection suppresses a legacy timed Task when a session with its exact Phase 3C deterministic ID and matching Task owner exists, even if that session was subsequently moved/completed, or when that exact ID was dismissed. Unrelated sessions and newly rescheduled legacy timestamps remain visible. Legacy fallback preserves the existing remaining-effort duration, carries `sourceType: 'legacyTask'`, and does not assign a timezone. Date-only/untimed Tasks are unchanged.
- Phase 3E: `ScheduleService` consumes `selectLocalCalendarDisplayItems` through the existing blocked-block → SVE → ScheduleEvent read path. WorkSessions use projected identity, exact start/end, current Task title, existing local viewing-zone geometry, day clipping, overlap layout and timed-block styling. Completed sessions remain visible; projected legacy suppression prevents duplicate timed blocks. Integration events keep their existing provider/all-day/action path. WorkSession SVE types remain separate from Task/provider interactions, context menus and delete.
- Phase 3F: existing timezone-aware WorkSessions support persisted schedule moves and bottom-edge resizes through `WorkSessionService.update()` and the existing `updateWorkSession` operation. Move reuses schedule snapping and preserves duration; resize reuses the grid gesture/minimum and changes only `end`. Edits retain Task identity, stored timezone and completion; absent/invalid timezone blocks UI edits without resolving a default. Invalid updates restore the persisted display. Deterministic migrated-session identity continues suppressing its legacy block even after timing diverges; Task `dueWithTime` stays untouched. Phase 3G adds the Task timed-write cutover and Phase 3H adds removal; there is no continuous mirroring or provider redesign.
- Phase 3G: week-grid and day-panel timed Task drops, Planner/Today scheduling dialog, Task/Planner/context-menu/bulk timed commands and schedule placeholder selection now call `WorkSessionService.scheduleTask()`. They emit one WorkSession create/update and no Task timed-schedule action, estimate write, completion write, reminder write or planning operation. Shift/day-only planning keeps its existing commands. A newly created Task in the schedule placeholder still requires its own Task create before the session create; its existing 30-minute estimate is retained and implicit Today placement is suppressed.
- Generic Task commands target only `task-schedule:<Task-ID-length>:<Task-ID>`, or the Phase 3C deterministic identity for the Task's retained legacy timestamp. They never search sessions by Task ID alone. A missing target is created; an existing target moves with its own duration, completion and stored timezone intact. Specific WorkSession moves/resizes continue using Phase 3F. Other sessions on the Task are untouched. Creation seeds duration from a finite positive estimate; only grid/day-panel drops reuse their established 15-minute fallback. Dialog/commands have no new default and reject missing/invalid duration without a write. Task estimates remain independent.
- Phase 3G creation resolves/persists the Phase 3A/3B configured-or-system IANA zone with no UTC fallback; invalid resolution fails without a persistent operation. Existing targets require their stored valid zone and never re-resolve against the device. Legacy `dueWithTime` remains unchanged/readable. Using the exact migrated identity even when creating a previously unbackfilled legacy block preserves existing duplicate suppression and prevents startup backfill from adding a second block for the retained timestamp; unrelated sessions still do not suppress legacy rendering.
- Boundary: recurrence generation/configuration, reminder snooze/reschedule, short-syntax/add-bar Task creation, Task duplication and provider/plugin legacy scheduling contracts retain their compatibility writes; the final audit inventories these exceptions. WorkSession reminders remain deferred; exact-session removal is implemented by Phase 3H. The normal scheduling dialog hides reminder controls and hides unschedule for its session target so it cannot misleadingly clear Task fields while leaving the block. Select-due-only pickers and date-only planning retain their existing semantics. No generic session management or two-way Task timing bridge is added.
- Compatibility: Phase 3G uses the existing WORK_SESSION operation family and capability/file-manifest gates, with no new model fields or schema bump. Phase 3B+ readers can apply the writes; older exact-key WorkSession readers reject timezone-bearing payloads, and pre-WorkSession clients cannot render these blocks and may drop the slice when writing full state. The server entity capability does not prove peer field compatibility. Mixed-version writers must be upgraded/isolated; mirroring Task timing would restore coupled semantics and extra operations and is not a safe bridge. A schema bump cannot shield released readers/writers. Replay applies existing WorkSession reducers directly without invoking scheduling services or effect fan-out.
- Existing sources: integration events preserve start/duration and the current explicit-or-duration-based all-day classification without conversion; plugin update/delete support supplies capabilities, reference/iCal events remain read-only, and external resize stays disabled. No canonical local Event or WeeklyTemplate store exists yet. Deadlines remain separate Planner markers for later consolidation. The projection adds no state slice, persisted-model/op-log/wire change, schema bump, dependency or selector mutation. Event actions and legacy Task time-block integration remain on their existing adapter paths.
- Phase 3C: startup hydration backfills active legacy timed Tasks after snapshot/tail replay and failed-op retries, through the existing quiesced state-cache save. It installs additions only after validation and durable persistence; no WorkSession operation is emitted, no schema version is advanced (including legacy Planning anchors), and ordinary remote/replayed actions never trigger backfill. Snapshots/backups subsequently retain the sessions; operation-only peers backfill their materialized state at startup, preserving entities already established by seeded mutations.
- Final-review replay repair: Update/Complete/Uncomplete for canonical deterministic migrated IDs optionally carry `legacySession`, the sender's persisted pre-mutation base. The same reducer used by hydration and live application validates and atomically materializes only missing, undismissed migrated entities before applying the delta, preserving authoritative timezone/creation/completion data without receiver guesses. Existing entities retain normal delta behavior; arbitrary IDs and old seedless missing mutations remain no-ops. Root integrity still requires a live Task. One intent remains one operation; no extra Create, replay recapture, persisted field or schema bump is introduced. Old operations remain readable, but missing seedless historical edits require a sender snapshot or later seeded mutation to recover. Compatible readers/writers must be upgraded; independently materialized sessions retain existing conflict/delta semantics.
- Eligibility: a live Task with a finite nonnegative numeric `dueWithTime`, finite positive numeric `timeEstimate`, and finite `end > start`; date-only/untimed Tasks are ignored. IDs use `legacy-task-schedule:<Task-ID-length>:<Task-ID>:<original-timestamp>` without hashing. Existing IDs, including edited/completed sessions, are untouched; unrelated sessions do not block backfill. Start/end and deterministic created/modified timestamps derive from the original instant; Task scheduling/completion fields are unchanged.
- Timezone: Tasks have no trustworthy source/provider zone in this path. Phase 3A resolves configured IANA zone, otherwise system zone, with no UTC fallback. The persisted ID/session retains the first assigned zone across retries/default changes. Invalid duration or unresolved zone leaves legacy rendering/data intact; no suitable migration-choice UI exists yet, so these unresolved cases remain documented and tested rather than assigned a default duration. First materialization on devices with different unconfigured system zones can assign different zones to the same ID; an already persisted session always wins on retry.
- Compatibility limits: Phase 3B readers accept the existing session shape; pre-3B readers retain their timezone-field incompatibility, and pre-WorkSession full-state writers can drop the slice. A schema bump would not shield these clients; mixed-version use still requires compatible readers/writers, including Phase 3H dismissal support. The existing integrity guard remains: backfilled Tasks require explicit session removal before deletion/archive. Rescheduling is not mirrored; a later startup can backfill a newly encountered legacy timestamp.
- Objective: extend WorkSession with explicit IANA timezone semantics, render WorkSessions through a shared calendar item, and make drops/resizes create/update them.
- Affected code: Schedule models/services, `ScheduleWeekDragService`, day panel, event component, Planner/Today scheduling dialog, time-block integration.
- Delivered code: WorkSession timezone validation and deterministic legacy backfill, `CalendarDisplayItem` and its selector/facade, existing scheduling dialog/gesture cutover, move/resize and exact-session removal. New sessions seed duration from a valid Task estimate; only grid/day-panel drops retain their existing 15-minute fallback, and new placeholder Tasks retain their existing 30-minute estimate. There is no new general default-duration policy or session editor.
- Dependencies: Phases 1–2.
- Tests: multiple sessions per Task, configured/custom IANA zones, move/resize, overlap/date boundaries/DST, migration preserving instants, touch/keyboard alternatives, explicit manual completion, elapsed sessions remaining incomplete, and session completion leaving Task open.
- Migration risk: medium due to legacy timed Tasks. Sync risk: medium/high. UI impact: visible but localized.

### Phase 4 — Folder domain and migration bridge

- Objective: introduce canonical recursive Folder ownership while Projects remain functional.
- Affected code: new feature store; Project/menu-tree compatibility; Task selectors/actions; validation/repair; sync/backups.
- New code: Folder model/service, hierarchy/cycle utilities, migration mapping.
- Dependencies: Phase 0.
- Tests: one Folder per active Project, unambiguous menu-tree nesting, `INBOX_PROJECT` mapping, ambiguous/unfiled Task fallback to Inbox, Projects/Tags/Sections preserved, arbitrary nesting, cycle prevention, stable moves/order, sync conflicts, restore fixtures, and large trees.
- Migration risk: high. Sync risk: high. UI impact: initially none or opt-in.

### Phase 5 — Master Tasks, Inbox, search, and folder DnD

- Objective: ship the continuous hierarchical task page and Folder-aware capture.
- Affected code: routes/nav, Task rows/AddTaskBar/inspector, search/filter selectors, DnD, Folder store.
- New components: MasterTasksPage, recursive/flattened hierarchy renderer, folder row, hierarchy-aware search.
- Dependencies: Phase 4.
- Tests: ancestor preservation, device-local expand/collapse/all state that never emits sync operations, sorting versus manual order, task/folder DnD, keyboard moves, performance, and desktop/tablet/mobile E2E.
- Migration risk: low beyond Phase 4. Sync risk: low/medium. UI impact: major new screen.

### Phase 6 — This Week and Today compositions

- Objective: expose the Planstrand planning workflow and Today sections without scheduling conflation.
- Affected code: routes/nav, Planner selectors/components, Today work-context view, Schedule day panel, state preservation.
- New components: ThisWeekPage and responsive Today composition.
- Dependencies: Phases 2–3 and Folder selectors for grouping.
- Tests: week-only/day planning, rollover, grouping/filter/order, multi-pane responsiveness, drag Task to create session, no duplication.
- Migration risk: low. Sync risk: medium for concurrent membership moves. UI impact: major.

### Phase 7 — Standalone Event and unified calendar views

- Objective: add local Event CRUD and make Year/Month/Week/Day consume one normalized data source.
- Affected code: new store, Schedule components/service, editor, routes, calendar integration facade.
- New code: Event entity/service, shared occurrence projection, Year view, unified inspector model.
- Dependencies: CalendarDisplayItem from Phase 3.
- Tests: all-day date-only events with no midnight-UTC conversion, timed Events with configured/custom IANA zones, Year aggregation, same item across views, DST/timezone changes, move/resize, offline/sync/backups.
- Migration risk: low for empty slice. Sync risk: medium. UI impact: calendar expansion.

### Phase 8 — Recurrence and WeeklyTemplate

- Objective: support recurring local Events and multiple named weekly baseline commitment schedules whose entries produce Event-like occurrences with exceptions.
- Affected code: recurrence utilities, Event/Calendar projection, reminders, new template route/editor.
- New code: WeeklyTemplate store with configured IANA timezone, Event-like occurrence projection, recurrence series/rules/exceptions, and split-series service. V1 adds no Task or WorkSession reference to template entries.
- Dependencies: Phase 7. Phase 9 later attaches reminder records to stable template occurrence identities.
- Tests: lectures/labs/work-hours/gym/lunch/meeting examples, date range, recurrence evaluated in the template IANA zone, DST, Event-like output, proof that no Task-linked WorkSession is created, cancelled/overridden occurrence, this/future/all edits, concurrent exception edits, and no eager infinite expansion.
- Migration risk: low for empty slice; semantic risk high. Sync risk: high. UI impact: new primary screen/editor.

### Phase 9 — Reminder normalization and platform scheduling

- Objective: multiple reminders for Task/Event/WorkSession and inherited recurring reminders.
- Affected code: Reminder model/store/service/worker, Task effects, Electron/Web/Capacitor adapters.
- New code: target/trigger resolver, occurrence delivery ledger, snooze actions.
- Dependencies: WorkSession/Event/template identity stable.
- Tests: presets/custom, snooze, recurrence, overdue once-daily behavior, permission denial, app restart, time-zone change, duplicate prevention across platforms.
- Migration risk: medium. Sync risk: high because duplicate notification is user-visible. UI impact: editor fields/settings.

### Phase 10 — Trash and explicit permanent deletion

- Objective: soft-delete/restore Task, Folder, Event, and supported related items; display deletion age; support explicit permanent deletion; keep Archive separate. V1 performs no automatic purge.
- Affected code: entity selectors/actions, cross-entity meta-reducers, search/calendar, backup, settings.
- New code: Trash page/service, restore metadata, deletion-age presentation, and explicit permanent-delete command.
- Dependencies: stable Folder/Event/WorkSession relationships.
- Tests: recursive folder delete/restore, concurrent delete/restore, original parent missing, items remaining restorable beyond 30 days, deletion-age display, explicit permanent delete/empty Trash confirmation, and recovery point.
- Migration risk: medium. Sync risk: high. UI impact: delete behavior and new settings screen.

### Phase 11 — Account, E2EE recovery, and devices

- Objective: make existing account/E2EE flows Planstrand-ready, default-safe, recoverable, and selectively revocable.
- Affected code: SuperSync server auth/session schema, provider credentials, account/settings UI, encryption setup/restore, devices dialog.
- New code: per-device sessions/tokens and revoke endpoint; the selected recovery implementation is deferred until the unresolved recovery decision in section 8 is resolved.
- Dependencies: product decisions in section 8 and threat-model review.
- Tests: passkey/magic link, local-to-account bootstrap, default encryption, lost/new device, revoke one/all, account/data deletion, recovery, encrypted new entity payloads.
- Migration risk: high for credentials/keys. Sync risk: very high. UI impact: account/settings.

### Phase 12 — Encrypted backups and browser snapshot parity

- Objective: recommended encrypted backups, explicit readable exports, and reliable automatic snapshots on supported platforms.
- Affected code: BackupService, FileImex, LocalBackupService, backup list, crypto package.
- New code: backup envelope/version/KDF, browser persistence/export policy, CSV exporters.
- Dependencies: the unresolved E2EE-recovery and backup-key-custody decisions in section 8, plus all V1 slices registered.
- Tests: wrong password/tamper, old JSON import, all entity slices, pre-restore rollback, cross-platform files, quota failures.
- Migration risk: medium. Sync risk: medium around full-state restore. UI impact: backup/settings.

### Phase 13 — Responsive navigation, density, polish, and integration export

- Objective: finish desktop/tablet/mobile compositions and Comfortable/Compact density; display external events; and support explicit, user-controlled export of selected Planstrand Events and provider-supported WorkSessions. Automatic full two-way entity sync is outside V1.
- Affected code: layout breakpoints, shell/nav, inspectors/sheets, design tokens, calendar providers/time-block sync.
- New code: explicit layout tiers, density config/tokens, external-calendar visibility controls, provider export mappings, explicit export/re-export actions, and privacy controls that keep WorkSessions local by default.
- Dependencies: preceding domain screens and stable calendar items.
- Tests: representative phone/tablet/desktop viewports, touch DnD, keyboard/non-drag alternatives, visual/a11y tests, external display, explicit Event export, supported/unsupported WorkSession export, read-only providers, idempotent repeat export, and private-by-default sessions with no background export.
- Migration risk: low for density; medium for provider mappings. Sync risk: low for UI, medium for explicit external export identity. UI impact: broad.

## 6. Technical Risks

| Risk                                                | Consequence                                                                                                                                             | Practical mitigation                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing or false Planstrand sync capabilities       | Authentication can succeed against an upstream/incompatible SuperSync server that rejects or cannot safely replay Planstrand entities.                  | Require a machine-readable per-entity/schema handshake and gate every upload. Keep local actions durable and pending, report the limitation, test false/stale advertisements, and never downgrade or convert unsupported entities. Do not rely only on schema version.                                                                   |
| Cross-entity atomicity                              | Moving/deleting Task/Folder/Session can leave dangling references after conflicts.                                                                      | Keep one intent = one operation, use bounded multi-entity payloads/meta-reducers, validate after remote batches, and model subtree moves by parent reference rather than rewriting descendants.                                                                                                                                          |
| E2EE key loss                                       | Server cannot recover user content.                                                                                                                     | Resolve the recovery-mechanism/custody decision in section 8 before making E2EE default, then threat-model and test the chosen design. Until then, preserve the authentication/encryption separation and never invent server-side plaintext recovery.                                                                                    |
| Metadata leakage                                    | Encrypted payloads still expose operation/entity timing and identifiers.                                                                                | Document the threat model, minimize metadata, use opaque IDs/device labels, and avoid titles/calendar details outside ciphertext.                                                                                                                                                                                                        |
| Recurrence, timezone, and DST                       | Occurrences move, duplicate, or disappear across time zones/DST; all-day dates can shift if represented as UTC midnight.                                | Require IANA zones on timed Events/WorkSessions and WeeklyTemplate, evaluate templates in their configured zone, keep all-day Events date-only, use stable original-local occurrence keys and bounded expansion, and test DST/travel/default-zone changes.                                                                               |
| Calendar model divergence                           | Day/Week/Month/Year show different items or permissions.                                                                                                | One `CalendarDisplayItem` projection and capability model; view components only lay it out.                                                                                                                                                                                                                                              |
| Offline concurrent edits                            | Same session/folder/order edited on multiple devices can produce destructive LWW results.                                                               | Prefer field/intent operations, deterministic ordering identifiers where necessary, conflict tests, recovery snapshots, and a Sync Issues path for unresolved destructive cases.                                                                                                                                                         |
| Migration of timed Tasks                            | Old block duration versus total-estimate semantics are ambiguous, legacy records have no explicit IANA zone, and mixed clients can recreate divergence. | Deterministic migrated session IDs, preserve instants, assign the configured/default IANA zone with stable migration provenance, dual-read dedupe, migration issue reporting, capability gating, and never map additional sessions back into the one legacy field. Legacy estimate zero itself is not ambiguous: it migrates to Unknown. |
| Deeply nested folders                               | Cycles, stack overflow, slow full-tree recomputation.                                                                                                   | Validate cycles/depth, iterative traversal, memoized per-branch selectors, stable track IDs, performance fixtures; virtualize only after measurement.                                                                                                                                                                                    |
| Task identity duplication                           | Moving between Master/Week/Today/Calendar accidentally clones Tasks.                                                                                    | Centralize membership/session actions around Task ID and add invariant/E2E tests asserting one Task entity after every move/drop.                                                                                                                                                                                                        |
| Multiple WorkSessions                               | Existing code assumes Task ID is calendar item ID and estimate is block duration.                                                                       | Give WorkSession its own ID, update DnD/editor contracts before UI switch, and keep estimate calculations read-only/derived.                                                                                                                                                                                                             |
| WorkSession completion drift                        | Timer/end-time effects could accidentally mark a session or its Task complete.                                                                          | Make completion an explicit manual action only, keep elapsed time read-only, prohibit completion dispatches from clocks/notifications, and test that passing end time and completing a session never complete Task.                                                                                                                      |
| Responsive DnD                                      | Touch scrolling conflicts with drag/resize; inaccessible without pointer.                                                                               | Reuse current delays/handles/hit testing, add explicit schedule/move dialogs and keyboard commands, and test iOS/Android/tablet viewports.                                                                                                                                                                                               |
| External calendar export duplication/privacy        | Explicitly exported items can be exported twice, reappear as external duplicates, or leak private WorkSessions.                                         | V1 has no automatic full two-way entity sync. Keep display adapters read-only unless the user invokes export, use durable provider/calendar/external IDs and origin markers for idempotent re-export/display dedupe, check provider capabilities, and keep every WorkSession local by default.                                           |
| Notification duplication/staleness                  | Repeated alerts after sync, recurrence edits, or platform restart.                                                                                      | Stable reminder/occurrence IDs, last-delivered ledger, idempotent cancel/reschedule, bounded horizon, permission-aware reconciliation on startup/time-zone change.                                                                                                                                                                       |
| Explicit permanent deletion while peers are offline | A user-requested permanent delete on one device can race with a restore on another.                                                                     | Perform no automatic V1 purge, require explicit confirmation and a recovery point, use a distinct permanent-delete operation with deterministic causal rules, and defer age-based retention until offline-safe purge semantics are designed.                                                                                             |
| Backup false confidence                             | Sync is mistaken for backup; browser has no rotated external snapshots.                                                                                 | Clearly separate status, expose last verified backup, implement encrypted snapshot rotation/export, and retain existing pre-destructive recovery ring.                                                                                                                                                                                   |
| Plugin/public API compatibility                     | Changing Task priority/estimate/project fields breaks bundled or third-party plugins.                                                                   | Keep adapter fields, version the plugin API later, return compatible numeric/project views, and test bundled providers/importers before removing legacy fields.                                                                                                                                                                          |
| Upstream divergence                                 | Security/platform fixes become hard to integrate as core files diverge.                                                                                 | Maintain `upstream` remote, isolate Planstrand domains behind adapters/facades, record divergence, and selectively cherry-pick tested fixes rather than broad merges.                                                                                                                                                                    |

## 7. Recommended First Implementation

The smallest foundational implementation should be an **empty, first-class, intentionally minimal WorkSession domain slice with persistence and capability-gated sync support, but no calendar UI conversion yet**.

It should come first because WorkSession is the sharpest structural mismatch: current scheduling, Today, calendar resize, external time-block export, reminders, recurrence, estimates, and completion all assume the Task is the block. Establishing separate identity and invariants early prevents each new Planstrand screen from deepening that assumption. An empty additive slice also tests the entire local-first pipeline before user data is migrated.

It would touch:

- a new `src/app/features/work-session/` model, NgRx adapter/reducer/actions/selectors/service and focused tests;
- `src/app/root-store/feature-stores.module.ts` and `root-state.ts`;
- `src/app/op-log/model/model-config.ts` and missing-slice hydration/default handling;
- `src/app/op-log/core/entity-registry.ts`, operation action/entity mapping, validation, repair, snapshot, backup, and sync tests;
- `packages/shared-schema/src/entity-types.ts`, the coordinated SuperSync server package/allow-list and capability advertisement, and the client upload gate;
- fixtures proving old backups hydrate with an empty WorkSession slice.

The persisted Phase 1 model is exactly `id`, `taskId`, `start`, `end`, optional nullable `completedAt`, `created`, and `modified`. It must not include timezone, reminders, source/provenance, external references, Trash/deletion fields, notes, or other future-feature contracts. Those fields are introduced only in later phases after their semantics are finalized; timezone is the first planned extension in Phase 3 before any user-visible timed scheduling writes.

It should deliberately not change `Task.dueWithTime`, `timeEstimate`, Planner/Today behavior, Schedule rendering, drag-and-drop, recurrence, reminders, Trash, external calendars, branding, navigation, or visual design. It should not migrate any legacy timed Task yet. The only domain behavior should be safe CRUD, `taskId` referential integrity, a valid `end > start` range, and explicit manual completion/uncompletion. Wall-clock passage beyond `end` changes nothing, and WorkSession completion never completes Task.

Required tests are exact persisted-shape validation, reducer/selectors, explicit manual completion/uncompletion, elapsed-end-time no-op, no Task-completion side effect, missing Task handling, operation capture/replay, encrypted two-client SuperSync after a positive capability handshake, incompatible-server upload suppression while local work remains durable, file-provider round trip, LWW/conflict behavior, compaction/snapshot hydration, complete backup export/import, legacy backup with no slice, and strict validation/repair. Phase 0's capability contract and client upload gate are hard prerequisites. A positive server advertisement is required for remote WorkSession upload, never for local WorkSession use; authentication success alone is insufficient.

This unlocks CalendarDisplayItem, multiple sessions, Today drag-to-schedule, resize/move, session reminders, external session export, estimate-vs-worked calculations, and the eventual removal of Task-as-time-block semantics. WeeklyTemplate remains a separate Event-like recurrence aggregate rather than a WorkSession producer.

## 8. Questions / Decisions

Only the following decisions remain unresolved by the source documents, current code, and the product/architecture decisions incorporated into this plan.

### E2EE recovery mechanism and custody

- Why it matters: recovery affects onboarding, multi-device setup, encrypted backups, and the threat model.
- Options: printable recovery key/file; trusted-device transfer; passphrase-derived key; or a combination.
- Consequences: key/file is offline and operator-blind but user-managed; trusted transfer is convenient but unavailable after all devices are lost; passphrase is familiar but vulnerable to weak choices. Server escrow would change the stated privacy boundary and is not assumed.

### Backup encryption key relationship

- Why it matters: using the sync key makes backup convenient but couples two recovery domains.
- Options: independent backup password/key; reuse sync key; or offer both with independent default.
- Consequences: independent keys isolate compromise and work for local-only users but add custody burden; reuse simplifies restore but a lost sync key also loses backup access.

## 9. Upstream Capability Inventory

No capability should be removed during the audit or early domain migration.

| Classification           | Capability                                                                     | Important paths / preservation concern                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep                     | Time tracking, current-task timer, work log, idle handling                     | `src/app/features/time-tracking/`, `worklog/`, `idle/`; integrate with WorkSession only through explicit later rules.                                       |
| Keep                     | Focus mode, Pomodoro, Flowtime, breaks                                         | `src/app/features/focus-mode/`, config models, native foreground services. Valuable personal-productivity behavior outside the core planning spec.          |
| Keep                     | Notes, attachments, markdown, clipboard images                                 | `src/app/features/note/`, Task attachments/detail panel, import/export and local draft recovery.                                                            |
| Keep                     | Search, keyboard shortcuts, global shortcuts, quick capture                    | `src/app/pages/search-page/`, `src/app/core-ui/shortcut/`, and Electron/Android/iOS capture paths. Adapt search to Folder ancestors.                        |
| Keep                     | Offline PWA and platform wrappers                                              | Service worker, Electron, Capacitor Android/iOS, share extensions, widgets, notification bridges.                                                           |
| Keep                     | Operation log, vector clocks, recovery, E2EE, provider abstraction             | `src/app/op-log/`, `packages/sync-core/`, `sync-providers/`, `super-sync-server/`. These are foundational and high-risk to replace.                         |
| Keep                     | WebDAV, Nextcloud, Dropbox, OneDrive, local-file sync                          | Existing users may depend on non-account sync even if Planstrand promotes its own account service. New entities must remain provider-neutral.               |
| Keep                     | iCal/Google/CalDAV integrations                                                | Preserve as adapters and evolve behind the unified calendar facade.                                                                                         |
| Keep                     | Automatic local backups, archives, import/export, repair                       | `src/app/imex/local-backup/`, `src/app/op-log/backup/`, `features/archive/`. Do not confuse Archive with Trash.                                             |
| Keep but hide initially  | Issue integrations (Jira, GitHub/GitLab, OpenProject, Redmine, Nextcloud Deck) | `src/app/features/issue/` and plugin providers. They complicate primary UI but contain valuable upstream capability and rely on Project/Task compatibility. |
| Keep but hide initially  | Boards/Kanban/Eisenhower                                                       | `src/app/features/boards/`; not V1 core, but removing could strand user configuration.                                                                      |
| Keep but hide initially  | Habits/simple counters and metrics                                             | `src/app/features/simple-counter/`, `metric/`; V1 explicitly excludes habit expansion/advanced analytics.                                                   |
| Keep but hide initially  | Project notes, daily summary, finish-day workflow                              | Existing users may rely on them; Today/Folder work must not break their Task/archive assumptions.                                                           |
| Reconsider later         | Project/Tag work-context theming and wallpapers                                | Rich theming conflicts with the restrained design direction but is data-bearing and should remain compatible while a simpler default ships.                 |
| Reconsider later         | Sections and Project backlog                                                   | They overlap future Folder/grouping and This Week concepts. Preserve data until migration value is clear; do not silently translate them.                   |
| Reconsider later         | Plugin marketplace/user plugins and public Task API                            | Useful extensibility, but Planstrand entity/API versioning must be defined before exposing WorkSession/Event/Folder.                                        |
| Reconsider later         | Productivity evaluation, donations, onboarding/tours, celebration assets       | Product-specific surfaces can be hidden/reworked after branding decisions; they are not architectural blockers.                                             |
| Likely remove eventually | Legacy password/test-only auth surfaces and obsolete migration shims           | Only after production passkey/magic-link/recovery paths and supported-data windows make removal safe.                                                       |
| Likely remove eventually | Super Productivity-specific branding/URLs/default server names                 | Required eventually by product identity, but explicitly deferred and intertwined with packaging, OAuth, translations, and migration paths.                  |
| Likely remove eventually | Deprecated config/legacy fields after compatibility window                     | Examples include older schedule/reminder/theme flags. Removal requires migrations and mixed-client policy, never opportunistic cleanup.                     |

## 10. Architecture Dependency Map

```text
Task domain (`features/tasks`)
  ├─ Project / Tag / Section / WorkContext relationships
  │    └─ MenuTree organizes Project/Tag navigation only
  ├─ TaskRepeatCfg creates/projects recurring Tasks
  ├─ PlannerState + TODAY_TAG order planned/due Tasks
  ├─ TimeTracking / Focus / Worklog reference Task IDs
  ├─ Reminder records and Task reminder effects
  └─ Issue providers / plugin API extend and mutate Tasks
             │
             ▼
NgRx feature reducers + ordered shared meta-reducers
  (`feature-stores.module.ts`, `meta-reducer-registry.ts`)
             │ original local persistent action
             ▼
Operation capture (`op-log/capture`)
             │
             ▼
IndexedDB operation log + snapshots + archives + recovery ring
  (`op-log/persistence`, `op-log/backup`, `features/archive`)
             │                         └─ automatic Electron/mobile backups
             ▼
Sync orchestration / vector clocks / conflict resolution
  (`op-log/sync`, `op-log/sync-providers`)
             │
             ├─ API provider capability handshake/upload gate
             │    └─ unsupported Planstrand operations remain local and pending
             │
      ┌──────┴─────────────────────────────┐
      ▼                                    ▼
E2EE operation payloads              File-based providers
      │                               WebDAV/Nextcloud/Dropbox/
      ▼                               OneDrive/local file
SuperSync provider
      │
      ▼
SuperSync server: auth, encrypted op storage, snapshots, device metadata

Current scheduling intersection:

PlannerState + TODAY_TAG + Task.dueDay/dueWithTime + Task.timeEstimate
      │
      ├─ PlannerService / Planner components
      ├─ ScheduleService -> SVE/ScheduleEvent -> Day/Week/Month
      ├─ drag/resize writes back to the same Task
      └─ TimeBlockSyncEffects exports that one Task block

External calendar intersection:

iCal / Google / CalDAV provider adapters
      -> CalendarIntegrationService cache/projection
      -> PlannerService + ScheduleService
      -> external events displayed as adapter projections
      -> explicit selected Event/WorkSession export when provider-capable
         (no automatic full two-way Planstrand entity sync in V1)

Target Planstrand insertion points:

Folder ───────────────┐
Task ── planning IDs ─┼─> pure view selectors: Master / This Week / Today
Task ──< WorkSession ─┤
Event ────────────────┼─> CalendarDisplayItem selector
WeeklyTemplate/rules ─┤       -> Event-like occurrences -> Year / Month / Week / Day
External adapters ────┘       -> platform-specific drag/editor composition

All new persistent entities
  -> NgRx normalized store
  -> operation capture/entity registry
  -> IndexedDB snapshot/backup/validation
  -> encrypted provider-neutral sync
     -> API upload only after matching entity/schema capability advertisement
  -> remote replay through the same reducers

Reminder domain
  -> occurrence/trigger resolver
  -> web worker / Electron NotifyService / Capacitor notification adapters

Platform shells
  -> shared routes/selectors/components
  -> Electron desktop | Web/PWA | Android Capacitor | iOS Capacitor/share extension
```

The core architectural rule for implementation is therefore: introduce each Planstrand concept once as canonical normalized domain state, pass it through the existing operation/persistence/sync pipeline, and derive Master, Week, Today, Calendar, responsive layouts, and provider exports from that state. Do not make a view, provider, or platform wrapper a second source of truth.

### Phase 2 migration contract and ordering limitation

Schema 5 persists one revisioned PlanningRecord per Task:

```text
PlanningRecord {
  id: Task.id,
  placement: {
    target: { type: DAY | WEEK, key: DB date },
    orderKey
  } | null,
  revision: {
    counter,
    clientId,
    opId
  }
}
```

Active placement and tombstone records are retained. Selectors hide Planning records whose Tasks are absent.

Legacy evidence never becomes current authority. Snapshot projection prefers the earliest lexically sorted valid Planner day for duplicate memberships and preserves that day's list order. For each day, Planner order precedes eligible TODAY_TAG order, then dueDay-only Task IDs sorted lexically using JavaScript string comparison (no locale, timestamp, timezone, wall clock or object iteration). Base-62 fractional string keys allow repeated insertion without renumbering siblings; equal keys sort by Task ID.

| Legacy evidence                                                   | Result                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Explicit valid Planner day                                        | One DAY placement at that day                                            |
| Valid dueDay, optionally TODAY_TAG order                          | One DAY placement at dueDay                                              |
| TODAY_TAG only, or TODAY_TAG with dueWithTime but no valid dueDay | No placement                                                             |
| dueWithTime/deadline/reminder/WorkSession alone                   | No placement                                                             |
| Multiple Planner days                                             | Earliest valid day wins; duplicate count reported by the pure projection |

Legacy TODAY_TAG membership without a recoverable planning date is ambiguous because released scheduling actions could add/remove Today membership using transient local-date state. Phase 2 migrates only date-addressable planning evidence. Scheduled-only Tasks retain their schedule but are not promoted to canonical planning. Diagnostics contain aggregate ambiguous-entry, invalid-reference and duplicate-membership counts; no titles, notes or decrypted content.

Released schema 4 is the legacy migration source; schema 5 is the Planstrand cutover. Complete legacy state/history and supported local unsynced edits are materialized before schema4→5 projection, validation, recovery creation and durable checkpoint preparation. The checkpoint binds baseServerSeq; the schema-5 clean-slate replacement is CAS-protected. Response-loss retry reuses the original checkpoint/operation; stale checkpoints require reconciliation. Compaction remains deferred until confirmation.

After confirmation, PLANNING_V1 and revisioned PlanningRecords are authoritative. Ordinary schema-5 hydration/replay never projects Planner, Today or due fields into Planning. Legacy runtime translation, prefix permissions, synthetic Planning compensation and physical removal are absent. Old clients cannot live-upload schema 4. Unfinished Phase-2 development formats (revisionless placements, earlier payload shapes and temporary compensation formats) are unsupported.

One-time migration evidence precedence is explicit PlannerState.days membership/order, then valid dueDay with usable Today order, then valid dueDay with deterministic lexical Task-ID fallback, otherwise no active placement. Duplicate Planner membership chooses the earliest valid date deterministically. Today-only, dueWithTime-only, WorkSession, reminders, deadlines and transient current-Today context provide no placement evidence. Migration revisions use counter 0; authored counter-1 writes and tombstones beat them.

File sync preserves the explicit one-time boundary: legacy namespace → full import/materialization → schema-5 state → Planstrand namespace. It never automatically re-reads the legacy namespace afterward.

Phase 3 remains gated on passing the real multi-client SuperSync convergence matrix and the remaining Phase 2 verification; an unavailable provider is a failed prerequisite, never a successful skip.

Recovery coverage must identify operations by their entity/action/operation IDs: Today Task creation can persist a Task Create and a separate canonical Planning placement. Retry assertions must prove exactly one matching Task Create per entity and exactly one acceptance per original operation ID, while retaining the legitimate Planning operation. Rewind fixtures must preserve both operations when asserting recovered Today membership. Request observers must distinguish capability/cutover probes from actual operation-page/recovery downloads by request semantics before rewriting pagination; probes cannot satisfy recovery assertions. File observers recognize the authoritative Planstrand namespace and explicitly supported legacy filenames.
