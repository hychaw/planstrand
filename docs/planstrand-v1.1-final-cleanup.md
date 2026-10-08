# Planstrand V1.1 final product cleanup

Baseline: `feature/v1.1-blue-thread`, clean working tree at
`aabfbd07f64a66ce5ed3296d782920198cad206b`. The approved visual references and
current defect screenshots were inspected before implementation. Written scope
takes precedence over the references. No release tag, development merge or
publication is part of this change.

## Dependency audit and decisions

| Surface                                                       | Dependencies retained                                                         | Product decision                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| More, Legacy Tasks/Capture, Planner, Projects, Tags, Upcoming | Menu tree, work-context resolvers, legacy routes, reducers and migrations     | Remove sidebar exposure. Four primary destinations feed the existing Planstrand Folder navigation. Disable secondary navigation shortcuts.                                                                                                           |
| Task Project/Tag controls                                     | Task relationships, migration and sync compatibility                          | Hide inherited context-menu/detail controls. Folder commands remain the normal organization workflow.                                                                                                                                                |
| Search                                                        | Existing Task search, task notes, archive lookup, Folder ownership projection | Keep global Search at the top right. Show Folder context. Open active results in their effective Planstrand Folder and task detail panel; archived results open details directly. Do not expose standalone Project/Today notes or legacy navigation. |
| Settings categories                                           | GlobalConfig/Formly storage and synced fields                                 | Use view-only field allowlists and six useful tabs. Preserve stored inherited values without exposing their switches.                                                                                                                                |
| Plugins                                                       | Plugin API, package assets, Electron IPC and authorship/licenses              | Remove Settings category, toolbar/task entries and startup activation. Keep infrastructure for compatibility.                                                                                                                                        |
| Stopwatch/focus/productivity controls                         | Task state, tracking history, services and replay support                     | Remove toolbar controls and normal activation. Runtime feature selectors disable tracking even with a restored opt-in; TaskService refuses new starts. Remove tracking controls from tray and global shortcuts.                                      |
| Idle and break recovery                                       | Electron native idle monitor, idle state and upstream services                | Host injection gate prevents idle effects/dialogs and break service activation. Runtime idle/break selectors stay disabled without rewriting persisted configuration.                                                                                |
| Utilities                                                     | Shared Task capture and existing sync state/actions                           | Keep Add Task and Sync/setup/status only. No Play, timers, notes or productivity controls.                                                                                                                                                           |
| Help/About                                                    | New lightweight routes, existing version generator and license assets         | Planstrand guidance and build/project information first; upstream acknowledgements and licenses in a secondary disclosure. No Advanced menu is needed.                                                                                               |
| Calendar and WorkSessions                                     | Existing domains, projection, persistence, operations and drag/resize         | Preserve semantics and architecture. Calendar work-hour guides remain an explicit device opt-in, disabled by default.                                                                                                                                |

## Final product surface

Expanded sidebar:

```text
Strand P · Planstrand
Today
This Week
Tasks
Calendar
Folders                       +
  Inbox
  recursive user Folders
```

Collapsed mode keeps the existing narrow rail, recognizable Strand P, centered
four icons, accessible labels/tooltips, expand control and matching content offset.
Inbox remains a Folder/capture collection.

The top right contains round Search, Utilities and person/app-menu controls.
The app menu contains Settings, Help and About, with Material keyboard navigation
and focus restoration. It presents no account or login state and no Advanced tree.

Settings tabs: General, Appearance, Tasks, Calendar, Sync & Backup, About.
General retains localization, relevant application behavior and useful shortcuts;
Tasks retains task deletion/parent completion, notes and priority preferences.
Appearance retains existing theme, density and wallpaper controls. Calendar offers
device-local work-hour guides and their start/end configuration. Sync/backup uses
the existing implementation. Plugin, idle, break, tracking, productivity and
upstream feature-enable categories are absent.

Normal host copy, error/recovery instructions and feedback destinations use
Planstrand. Genuine upstream identity remains in acknowledgements, the exact MIT
license, dependency notices and internal/plugin authorship. Existing sync folder
names and internal identifiers remain unchanged for compatibility. About serves
both license files locally; production build tooling places extracted dependency
notices inside the browser root and refreshes the offline integrity manifest.

The approved sky is a local optimized WebP (46,318 bytes), used without animation
or external runtime requests. Its original and emitted CSS asset are prefetched
for offline use. Strand P source/package/tray assets are unchanged.

## Planning and My Day

Each This Week section has a functional Add action. The shared task prompt creates
a Task in Inbox and includes an initial existing Planning record in the same
persistent Task-create action. Anytime targets the current week; each day targets
its exact date. The Planning reducer merges that record during local dispatch and
replay. There is no second local effect, separate creation operation or new
persisted Task field. JSON round-trip, idempotent replay and reload are covered.

The stale creation preview came from a trailing throttled mousemove callback:
mouseleave cleared the preview, then the queued callback recreated the old slot.
Disable that trailing callback; validate slot bounds and clear previews on pointer
or mouse exit, drag exit/drop, scroll/wheel, drag transitions, schedule-view changes
and destruction. Child-to-child dragleave does not masquerade as leaving the grid.

The drop guidance is now an overlay shown only during relevant Task dragging in
the scheduling area. It consumes no permanent timeline space. Existing drop-time
calculation and WorkSession creation remain intact. Browser and Electron checks
confirmed exactly one WorkSession per drop, persistence and independent Task
completion. Browser coverage also exercises Event/WorkSession movement and resize.

`CURRENT_SCHEMA_VERSION = 5`, NgRx, IndexedDB, durable operation log, sync pipeline,
Task/Folder/Planning/Event/WorkSession domains and CalendarDisplayItem projection
remain intact. Remote/replayed creation applies the carried absolute Planning
register without generating local commands. No operation-log redesign or migration
was introduced.

## Verification

Validation completed on Windows with Node 22.18.0 and installed Chrome. Browser
contexts use an explicit Europe/Berlin timezone because this host reports no IANA
timezone by default. Counts below are per test run and include overlapping suites.

| Check                                                                               | Result                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted Folder, Task/Planning, WorkSession, scheduling, policy and Settings suites | 720 passed; 13 pre-existing skips                                                                                                                                                                                   |
| Idle/break/Search suites                                                            | 60 passed                                                                                                                                                                                                           |
| TaskService and ConfigPage                                                          | 81 passed                                                                                                                                                                                                           |
| Navigation shortcuts                                                                | 10 passed                                                                                                                                                                                                           |
| Final Search routing/ownership/subtask/archive regressions                          | 34 passed                                                                                                                                                                                                           |
| Application and test TypeScript                                                     | Passed                                                                                                                                                                                                              |
| Full Planstrand browser suite                                                       | 19 passed, including menu keyboard focus, Search routes, week capture/reload, Folder workflows, Task movement, scheduling, Event/WorkSession drag/resize, offline reload, Year/responsive views, themes and density |
| Full lint                                                                           | Passed: TypeScript, SCSS, CSS variables and bundled rule/tool/icon checks                                                                                                                                           |
| Changed-file formatting and Git whitespace                                          | Passed                                                                                                                                                                                                              |
| Production frontend and Electron compilation                                        | Passed                                                                                                                                                                                                              |
| Windows unpacked package                                                            | Built successfully; unsigned, no publishing                                                                                                                                                                         |
| Offline notices/background                                                          | HTTP responses and service-worker hashes verified; exact files verified inside app.asar                                                                                                                             |

Production emits a non-failing initial bundle warning: approximately 5.57 MB
against the 5.50 MB warning budget. The inherited Chrome 107 Browserslist warning
also remains. No unrelated WebDAV/CI issue was changed.

The actual packaged Electron application passed automated UI checks for expanded
and collapsed navigation, Search, Utilities, Settings/Help/About, week Add to
Anytime/Monday/Thursday and reload, Task-to-My-Day drop creating exactly one
WorkSession, Task completion independence, hover exit, Day/Week/Month/Year,
default-hidden work markers, Dark/Light and Compact/Comfortable. Renderer errors:
none. An eight-minute real idle observation (481 seconds, native system idle up
to 1,192 seconds) produced neither idle classification nor break recovery.

Native desktop inspection timed out waiting for app approval, so Windows
taskbar/tray visual checks were not completed. A subsequent launch of the rebuilt
executable was blocked by Windows Device Guard. The earlier Electron run preceded
the final Search route adjustment and offline-notice repack; those final changes
were verified in browser/type/unit/build/package checks, not in a fresh Electron
launch. Stable browser screenshots were visually inspected, alongside Electron
renderer screenshots from the successful run. No device policy was modified.

## Remaining limits

- Live cross-device sync was unavailable; deterministic operation replay, JSON
  transport shape and local durability were tested. Existing sync transport is
  unchanged.
- Final executable launch and Windows taskbar/tray appearance need verification
  on a device permitting the unsigned package. Source icon assets are unchanged.
- Legacy routes and internals remain for data/architectural compatibility. They
  have no normal sidebar, Settings, app-menu or Search-result entry point.
- Existing application package version remains the inherited build number;
  About explicitly identifies the Planstrand V1.1 preview and reports revision
  and branch. This change does not publish a release.
- Recurring Events, WeeklyTemplate, recurrence exceptions, reminders, Trash,
  accounts/E2EE, backup redesign and external calendar export remain excluded.
