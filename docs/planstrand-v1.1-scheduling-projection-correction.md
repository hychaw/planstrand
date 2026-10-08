# Planstrand V1.1 planned-Task scheduling correction

Clean baseline: `865512cbf204c1458e5fc73a8e5b6d29dd01c264`, branch `feature/v1.1-blue-thread`.

## Diagnosis before the production change

The duplicate is a persisted WorkSession plus an inherited automatic Task-flow projection. It is not a second persisted session, a duplicate CalendarDisplayItem, a legacy timed-Task migration, or an uncleared drag preview.

`selectPlannerDayMap` adapts canonical Planning into the retained upstream planner read model. `selectTimelineTasks.unPlanned` can also include today's Tasks. `mapToScheduleDays` fed these into `createScheduleDays`, which automatically fills available timeline space with Tasks. After a Task is explicitly scheduled, its real WorkSession arrives through CalendarDisplayItem, while the day-planned Task remains eligible for automatic flow. Depending on the available gap, that extra entry can split into `SplitTask` and `SplitTaskContinuedLast`.

The baseline browser reproduction used the actual Task → Today → My Day drag path, inspecting live NgRx entities, `SUP_OPS/ops`, the canonical facade, the day panel's events, rendered elements, and previews. It reproduced both Inbox and recursive-Folder Tasks:

| Case          | Task ID                 | WorkSession ID                           | Create operation ID                    |
| ------------- | ----------------------- | ---------------------------------------- | -------------------------------------- |
| Inbox         | `zBWFtognr0MqE3l6JjYgc` | `task-schedule:21:zBWFtognr0MqE3l6JjYgc` | `01a1175f-8b96-7a16-ae29-0170fde9fe80` |
| Nested Folder | `WgsdaOb8QuCrK2RwRhRFd` | `task-schedule:21:WgsdaOb8QuCrK2RwRhRFd` | `01a1175f-aa84-7552-b4a8-5fcbaabe34c3` |

For each Task:

- Before drop: zero WorkSessions and zero WorkSession operations. Planning is a DAY placement; `dueWithTime` is absent.
- After one drop: one WorkSession entity and one IndexedDB `WORK_SESSION` / `CRT` operation, whose payload contains exactly that session. Planning is unchanged and the Task remains incomplete.
- Canonical CalendarDisplayItem: one `workSession` item.
- My Day events: that WorkSession plus `SplitTask` and `SplitTaskContinuedLast` for the same Task.
- Rendered timeline: two visible blocks with the same title, including a legacy flow block and the real session. Zero custom drag previews remain.

The fresh profile's snapshot cache was initially empty. The durable operation log is authoritative; it must not be mistaken for a second entity store. The regression checks the persisted create payload and verifies the actual hydrated entity after reload.

## Fix and compatibility

At the schedule projection boundary, supplying canonical CalendarDisplayItems now excludes automatic Task flow, planner day-map flow and untimed repeat forecasts. An empty canonical array also owns this boundary: merely planning a Task does not reserve calendar time.

Actual WorkSessions, Events, timed legacy fallback and existing external adapters retain their paths. Legacy callers that do not supply the canonical projection retain upstream automatic-flow behavior. Multiple intentional WorkSessions for one Task remain distinct; nothing is deduplicated by title or Task ID, and no renderer/CSS filter hides a block.

The deterministic timed-Task backfill rule remains unchanged. A migrated session suppresses its exact legacy timed projection by provenance, including after moving/completing it; unrelated sessions do not erase a different legitimate legacy schedule. Current Task scheduling reuses the deterministic migrated identity when `dueWithTime` exists. New Task scheduling does not write `dueWithTime`, so hydration cannot backfill another session for it.

The pointer-release handler clears schedule mode and the active source before scheduling. Repeated mouse/touch/CDK release notifications therefore cannot create another session. Source-list cleanup does not schedule. No write path needed changing.

## Regression evidence after the fix

| Case          | Task ID                 | WorkSession ID                           | Counts before → after → reload |
| ------------- | ----------------------- | ---------------------------------------- | ------------------------------ |
| Inbox         | `h0dykCNVja3IwjfTg4jbZ` | `task-schedule:21:h0dykCNVja3IwjfTg4jbZ` | `0 → 1 → 1`                    |
| Nested Folder | `g8RDh1KwWk0k76ukp8lUm` | `task-schedule:21:g8RDh1KwWk0k76ukp8lUm` | `0 → 1 → 1`                    |

Both cases have one create operation, one canonical item, one day-panel event and one rendered WorkSession after drop. Reload preserves the same session and Planning record without new WorkSession operations. Completing the Task leaves the session, its completion state and the Planning record unchanged. The tests attach the before/after and reloaded/completed evidence, including IDs and persisted operations.

The browser diagnostic uses the existing development-only NgRx helper and Angular component inspection; run it against `npm run startFrontend:e2e`. It introduces no production test hooks.

Schema 5, persistence, Planning/WorkSession semantics, operation encoding, sync/replay and CalendarDisplayItem entities are unchanged. No data migration, cleanup of genuine sessions, UI redesign, merge or publication is required.

## Validation

- Relevant Schedule/mapping/drag, Planning, WorkSession, persistence/replay, integrity and Planstrand unit tests: 398 passed; 13 existing timezone-dependent tests skipped.
- New Inbox and nested-Folder browser regressions: both passed, including exactly one new operation across the entire log per drop and an unchanged operation list after reload.
- Planstrand browser suite: 24 passed against the development server. The remaining license-file smoke check requires the extracted production license asset and passed against the production build.
- Application and unit-test TypeScript checks passed.
- Formatting and the full repository lint hook passed, including TypeScript, SCSS, CSS variables, lint-rule tests, tool tests and icon tests.
- Production frontend build, Electron build and Windows unpacked packaging passed. The frontend retains its existing initial-bundle budget warning.
- Actual packaged Electron verification passed with an isolated profile: Inbox and nested-Folder Task creation, Plan Today, one real drag, one durable create operation, one visible WorkSession, cleared preview, unchanged operation log after reload, retained Planning and independent Task completion. No renderer errors occurred.

| Electron case | Task ID                 | WorkSession ID                           | Create operation ID                    |
| ------------- | ----------------------- | ---------------------------------------- | -------------------------------------- |
| Inbox         | `v2FoALqK3Ggg8kYY3PeAX` | `task-schedule:21:v2FoALqK3Ggg8kYY3PeAX` | `01a11770-5915-7806-a553-62141f64203f` |
| Nested Folder | `THtHVIWGTDNTIBFEaT6dM` | `task-schedule:21:THtHVIWGTDNTIBFEaT6dM` | `01a11770-6ecd-7a85-941a-7c9502db27da` |

A broader Calendar UI unit run encounters existing mocks without `ScheduleService.displayTimeZone` in `schedule.component.spec.ts`; those unrelated mocks were left unchanged. This does not affect the passing targeted schedule/mapping suite.
