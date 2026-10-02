# Phase 3 final audit

## Final-review migrated seed ownership hardening

Audit date: 2026-10-02. Base HEAD:
`e55ad67935ee31979a89859588a739095b66300c`, branch
`feature/phase-3-work-session-timezone`. The working tree was clean before this
increment. This section supersedes earlier readiness statements below.

Final review reproduced a second materialization defect: a canonical ID such as
`legacy-task-schedule:6:task-1:100` could carry a seed with `taskId: task-2`.
The reducer checked ID syntax, seed ID equality and session shape, while root
integrity checked only that the referenced Task was live. With both Tasks live,
Update, Complete and Uncomplete established the wrong owner and prevented later
correct backfill.

`parseLegacyTaskWorkSessionId` now returns the encoded Task ID and original
timestamp only for canonical, round-trippable IDs. The boolean predicate delegates
to this parser. Length prefixes, delimiter placement and timestamps retain the
existing generator's semantics, including colon-containing Task IDs, fractional
timestamps and canonical exponent notation. No ID format changed.
Missing-entity materialization additionally requires the validated seed's Task ID
to equal the parsed owner. Wrong-owner mutations are no-ops: no entity, mutation
or dismissal marker is installed. Normal startup backfill can recover the correct
entity. Matching seeds still pass unchanged shape validation and root live-Task
integrity; missing referenced Tasks remain reducer failures. Existing entities
are returned before seed validation, preserving delta semantics for unused stale
or wrong-owner seeds. Valid seeds retain sender-authoritative range, timezone,
creation metadata and completion; replay never consults receiver configuration.

Permanent regression evidence:

- Before runtime changes, the migrated replay integration suite ran with the new
  regressions: **6 failed, 15 passed**, no skips. Three failures reproduced
  wrong-owner Update/Complete/Uncomplete and blocked correct backfill recovery;
  three asserted that mismatched missing-Task seeds should be ignored rather
  than reaching the root rejection boundary.
- Expanded integration coverage exercises valid missing seeded mutations,
  wrong-owner mutations through production live replay and hydration,
  existing-entity deltas, missing encoded Task rejection, mismatched missing seed
  Task, dismissal, siblings and startup recovery. Real IndexedDB, snapshots,
  restart and operation-count checks remain.
- Final Chrome Headless 154 / Windows focused run: **255 passed, zero skips**.
  Suites: migrated replay integration, WorkSession reducer, parser/backfill,
  persistence/encrypted transport, root integrity, capture meta-reducer, capture
  effects and operation conversion. An intermediate run had three test assertion
  failures: reducer rejection is reported in `reducerFailures`, not `failedOp`.
  Correcting that assertion required no runtime change; the final run includes it.
- `checkFile` passed for all four modified TypeScript files; `git diff --check`
  passed. No action/model/wire shape changed, so frozen-state coverage was not
  rerun. One intent remains one operation; no synthetic Create, effect fan-out,
  replay recapture, operation/envelope change, dependency or schema bump.

The focused SuperSync E2E was inspected and retained unchanged. Ownership attacks
are covered deterministically in integration tests; the provider test retains
its original two-client missing-materialization replay sequence.

The required command was attempted:

```text
npm run e2e:supersync:file e2e/tests/sync/supersync-migrated-work-session-replay.spec.ts -- --retries=0
```

It failed before execution because `npm` is unavailable on PATH. Invoking the
same saved package script through the installed Git shell exited 1 with
`docker: command not found`. The documented manual development alternative in
`packages/super-sync-server/README.md` requires PostgreSQL through Prisma. No
PostgreSQL executable/service or database listener on 5432/55432 was available;
no process `DATABASE_URL` or root/server `.env` was configured. Frontend 4242 and
SuperSync 1901 were also unavailable. PGlite SQL unit fixtures are not a supported
provider-server replacement. No dependency or alternate harness was added.

**SuperSync failing-before: not executed. SuperSync passing-after: not executed.**
No revision was temporarily reverted and no worktree was created, because the
server prerequisite prevents either revision from producing provider evidence.
In a server-enabled environment, run the unchanged E2E against parent pre-repair
behavior (`2fcad48ccbdc341d7de7809eaf2df3867c405c4a`) in isolation and repaired
behavior without rewriting history. Discovery and startup failures provide no
correctness evidence. Root and E2E contributor rules require provider
failing-before/passing-after evidence; IndexedDB coverage does not waive that gate
for a provider with an existing harness.

Status: **Phase 3 still not merge-ready**. The Task-owner code blocker is fixed;
required SuperSync E2E failing-before/passing-after evidence remains unavailable.
Earlier mixed-version/seedless-history limitations remain unchanged. No commit,
push, merge or rebase was performed in this increment.

## Final-review replay blocker follow-up

Reviewed base: `2fcad48ccbdc341d7de7809eaf2df3867c405c4a`, on
`feature/phase-3-work-session-timezone`. The working tree was clean before this
focused fix. This follow-up supersedes the historical merge-readiness statement
below.

Final review reproduced a replay gap: startup backfill persists deterministic
migrated WorkSessions without Create operations. Update/Complete previously
ignored an absent entity, so a receiving client could lose edits/completion and
later backfill the original legacy range. Delete already persisted dismissal.

Update, Complete and Uncomplete now optionally carry `legacySession`, the sender's
persisted pre-mutation WorkSession, for canonical deterministic migrated IDs.
Capture retains that base in the same operation payload. The normal reducer
atomically materializes a missing, undismissed migrated entity from this exact
validated base and applies the mutation. Its timezone, identity, creation and
completion semantics come from the sender, never receiver configuration/system
timezone. Root integrity still requires a live Task. Existing entities retain
normal delta behavior and ignore the seed; arbitrary/malformed IDs and seedless
missing mutations remain no-ops. Dismissed missing entities never resurrect.
Subsequent startup backfill preserves the materialized entity unchanged.

There is still one action/operation per move, resize or completion intent, no
replay recapture, no startup Create fan-out, no persisted entity/state field
change, and no schema bump. The action types and operation envelope are unchanged;
`legacySession` is an optional payload addition. Old seedless operations remain
readable, but cannot reconstruct an absent entity's authoritative base. Lost
historical edits need a sender snapshot or a later seeded mutation. Pre-fix peers
cannot use the new missing-entity behavior; compatible upgraded readers/writers
are required. Independently materialized existing sessions retain existing delta
semantics; this fix introduces no conflict-resolution policy.

Permanent evidence:

- `src/app/features/work-session/migrated-work-session-replay.integration.spec.ts`
  ran before implementation: **8 failed, 4 passed**, reproducing the loss through
  production hydration and live operation application. After the fix: **12 passed**.
  It uses real IndexedDB, state-cache persistence, tail replay, snapshot save and
  restart. It covers missing Update/Complete/Delete, update then complete,
  complete then uncomplete, dismissal followed by late mutations, sender/receiver
  timezone differences, backfill idempotency and absence of recapture.
- Reducer, integrity, deterministic-ID and capture regressions cover existing
  entities, old seedless operations, arbitrary/malformed IDs, exact seed validation,
  live Task references, completion/creation preservation and one captured operation.
  The persistence integration suite also covers the seed through encrypted
  upload/download and production bulk replay. After adding that transport case,
  both persistence integration suites ran together: **22 passed, no skips**
  (`.tmp/phase3-replay-encryption-validation.log`).
- Cold-cache Chrome Headless 154 / Windows validation: **1,378 passed, 2 skipped**
  (only the existing opt-in bulk-replay stress tests). Executed suites cover
  WorkSession service/reducer/backfill/dismissal/persistence, schedule edits and
  timed entry points, capture, bulk apply, hydrator, snapshots, current/frozen
  persisted-state validation, integrity and conflict resolution. Skips provide
  no behavioral evidence. Log: `.tmp/phase3-replay-validation.log`.
- A focused provider E2E lives in
  `e2e/tests/sync/supersync-migrated-work-session-replay.spec.ts`; Playwright
  discovered one test. It reproduces two clients with no migrated entity, sender
  restart/edit/complete, receiver live sync/restart and deletion/dismissal. It was
  **not executed**: frontend port 4242 and SuperSync port 1901 were unavailable,
  and Docker was not installed. Existing provider UI fixtures cannot express
  explicit WorkSession completion, so the test uses the existing development
  store helper while retaining real encrypted capture/transport/application.
  The executed IndexedDB regressions exercise the production hydration/live
  paths without replacing the central persistence/replay behavior with mocks.
- Repository `checkFile` passed for all **11 modified TypeScript files**, including
  both new regression files; `git diff --check` passed. The Node entry points were
  used directly because npm/npx wrappers were unavailable, as in Phase 3I.

Revised status: **Phase 3 replay blocker fixed and ready for final review**.
Provider E2E execution remains pending in a server-enabled environment; discovery
is not a pass. No commit, push, merge or rebase was performed.

## Historical Phase 3I audit

Audit date: 2026-10-02. Branch: `feature/phase-3-work-session-timezone`.
Starting HEAD: `9a6c26f30` (Phase 3H, Add WorkSession unschedule behavior).
The nested repository was clean before editing. This increment changes tests and
documentation only; no runtime writer gap was found in the supported Phase 3
entry points. Final validation results are recorded below.

## Scheduling and lifecycle contract

Tasks retain identity, completion, estimates and independent Planning placement.
Zero, one or multiple WorkSessions can reference a Task. Generic Task timed
commands target `task-schedule:<Task-ID-length>:<Task-ID>`, or the exact legacy
migration ID when retained Task timing exists. They do not choose an arbitrary
session by Task ID. Specific blocks use their own source identity.

New sessions resolve an explicit valid IANA zone from the caller, configured
`LocalizationConfig.timeZone`, or system zone. Invalid explicit/configured zones
and unavailable system zones reject creation; there is no UTC fallback. Moves
retain elapsed duration, timezone and completion. Resizes change the end instant
and retain timezone, Task identity and completion. Estimates are only seeds for
creation and are not synchronized with session duration. Legacy sessions without
timezone remain readable; normal schedule move/resize is disabled for them rather
than silently assigning a zone. They remain explicitly removable.

Completion/uncompletion use explicit domain actions, with `completedAt: null`
for persisted uncompletion. Passing the end instant does nothing. No session
operation completes/deletes its Task or writes Planning. Session removal removes
only that identity. Task deletion/archive is still blocked while any referencing
session exists, including children/project cascades, and succeeds through the
existing path after explicit session removals. No cascade was introduced.

| Existing entry point                         | Current route and audit result                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Week-grid Task mouse/touch drop              | `ScheduleWeekDragService` → `scheduleTask`; existing 15-minute fallback only; Shift retains Planning commands.                                  |
| Day-panel external Task mouse/touch drop     | Pointer-up stream → `scheduleTask`; existing 15-minute fallback; no accidental Task timed write.                                                |
| Planner/Today dialog                         | Valid timed submit → `scheduleTask`; date-only submit → Planning. Existing time-input Enter uses the same submit route.                         |
| Task row scheduling shortcuts                | `_scheduleTask` → `scheduleTask`; date-only choices retain Planning behavior.                                                                   |
| Task/context-menu/Planner quick rescheduling | `scheduleTask`; retains the existing local clock-time selection behavior and deterministic target.                                              |
| Bulk timed scheduling                        | One session action per selected Task; existing capture-yield helper retained. Date-only Planning remains separate.                              |
| Placeholder existing Task selection          | One WorkSession create/update, no Task mutation.                                                                                                |
| Placeholder new Task Enter                   | Independent Task create with existing 30-minute estimate and `dueDay: null` to suppress implicit Today placement, then one session create.      |
| Existing WorkSession mouse/touch move        | One update of selected source identity; outside-grid release restores it without deletion/Task fallback.                                        |
| WorkSession resize                           | Existing mouse bottom-edge gesture updates only `end`; resize remains intentionally disabled for touch. No new touch/keyboard resize interface. |
| WorkSession click/tap/right-click menu       | Exact-session removal. Existing Material menu behavior is retained. Generic Task unschedule is a separate compatibility command.                |

## Remaining legacy timed writers and exceptions

The audit searched `src/app` for all `dueWithTime` occurrences, assignments,
`scheduleTaskWithTime`, `reScheduleTaskWithTime`, their service callers and legacy
unschedule actions, and followed the current UI/service/reducer routes. Fields
and actions are retained deliberately; their presence is not evidence of a new
user-facing session writer.

| Owner / occurrence                                                                                                             | Classification and reason retained                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskService.scheduleTask`, `reScheduleTask`, `addAndSchedule`                                                                 | Intentional legacy compatibility facade. Current callers belong to add-bar/recurrence and IssueService provider-backed Task creation; Phase 3 timed commands use WorkSessionService.                                                                        |
| `tasks/short-syntax.ts`, `short-syntax-shared.reducer.ts`, `add-task-bar.component.ts`                                         | Explicitly deferred short-syntax/add-bar Task creation and reminder compatibility. These still author Task timing, not WorkSession reminder semantics.                                                                                                      |
| `task-duplicate.service.ts`                                                                                                    | Intentional legacy Task-copy compatibility: copies retained due fields into a new Task identity, does not copy or select existing WorkSessions. Eligible copied legacy timing is backfilled on startup. Generic session-copy management is outside Phase 3. |
| `task-repeat-cfg.service.ts`, `task-repeat-cfg.effects.ts`, repeat editor                                                      | Deferred Task recurrence generation/configuration; repeat instances/projections remain on the legacy path. WorkSession recurrence is not implemented.                                                                                                       |
| `reminder.service.ts`, `reminder.module.ts`, `dialog-view-task-reminders.component.ts`                                         | Deferred reminder snooze/reschedule/unschedule compatibility. Task reminder schedules do not become session reminders.                                                                                                                                      |
| `calendar-integration.service.ts`, calendar/CalDAV/Plainspace issue adapters, plugin issue-provider adapter                    | Provider/integration compatibility: importing, linking and polling provider-backed Tasks retains existing due mapping and two-way sync contracts.                                                                                                           |
| `time-block-sync.effects.ts`, `issue-two-way-sync.effects.ts`, `plugin-hooks.effects.ts`                                       | Provider/integration compatibility: observe retained Task actions/fields for existing provider exports/hooks. No background WorkSession export or Task timing mirror.                                                                                       |
| `task-shared.actions.ts`, scheduling/planner/deadline/CRUD shared reducers, `task.reducer.ts`, generic LWW and replay handling | Intentional legacy action/read/replay and deterministic field clears. Date-only transitions and deadline auto-planning can clear legacy timing but do not change sessions or canonical Planning through a session operation.                                |
| Task row/context menu/bulk, Planner Task/dialog, board and week-drag `unscheduleTask`                                          | Intentional Task compatibility/date-only command. Clears Task due/reminder fields, never selects or removes WorkSessions. Exact WorkSession unschedule is the block menu action.                                                                            |
| `archive.service.ts` retained-field stripping                                                                                  | Intentional archive compatibility for Tasks that pass integrity checks; not session cascade removal.                                                                                                                                                        |
| `ScheduleEventComponent` legacy Task estimate resize                                                                           | Intentional legacy fallback/untimed Task estimate behavior; it does not write timed Task data. WorkSession resize uses the separate end-only route.                                                                                                         |
| Task selectors/models, timezone/date helpers, calendar warnings/preview candidate, validation defaults                         | Read-only/type/derived paths or defaults, not persisted timed user writes.                                                                                                                                                                                  |

## Migration, projection and persistence

A valid legacy Task's retained `dueWithTime` plus positive estimate produces
`legacy-task-schedule:<Task-ID-length>:<Task-ID>:<original-timestamp>`, preserving
the original instants and assigning the first resolved configured/system zone.
Startup runs after snapshot/tail replay and failed-op retries. The quiesced,
validated cache save precedes nonpersistent installation; there is no backfill
operation, remote-effect fan-out, schema advance or continuous timing mirror.

The final lifecycle test uses real IndexedDB operation/cache storage: legacy Task
→ backfill alongside an unrelated session → projected blocks with no legacy
duplicate → persisted move/resize → cache restart/hydration → edited range remains
authoritative despite changed configured zone → persisted exact removal → second
restart → dismissal prevents backfill and stale legacy display. The unrelated
session and Task data survive both restarts. Existing snapshot-service/hydrator
tests separately exercise the production startup ordering and save-before-install
failure guards. Existing encrypted upload/removal and JSON replay tests cover
remote application and operation counts.

`CalendarDisplayItem` remains derived only. A migrated identity with the matching
Task owner suppresses its original legacy block after timing edits/completion;
the exact dismissed ID also suppresses fallback. Unrelated sessions and a new
legacy timestamp do not suppress each other. Midnight segments retain one domain
identity and full original range; their clipped display segments are intentional.
Overlaps and visible week boundaries use the existing local viewing-zone layout.
Provider/all-day events retain their existing adapter/action path. Deadlines remain
Planner markers. Canonical Event/WeeklyTemplate stores remain deferred.

Phase 3 persisted additions are optional `LocalizationConfig.timeZone`, optional
session `timeZone` and optional `dismissedLegacySessionIds` (absent means empty).
Create/update/delete retain existing WORK_SESSION operation vocabulary. Delete
derives dismissal from its ID atomically, including replay when the entity is
absent. New user session operations are captured once; replay directly applies
reducers without invoking the scheduling service. Uncompletion uses null; timezone
clearing is rejected; no new persisted clear depends on undefined. Current API
upload requires WORK_SESSION capability, while file sync retains its entity
manifest gate. These gates establish entity support, not peer field compatibility.

Mixed-version limits remain real: pre-3B exact-key readers reject timezone-bearing
session writes; pre-3H readers do not derive dismissal from Delete and can reject
marker-bearing snapshots. Pre-WorkSession/full-state writers may drop the slice
or suppression marker and resurrect old schedules. Compatible current readers
and writers must be used together or isolated from older writers. Independently
backfilling devices with different unconfigured system zones can initially assign
different zones to the same deterministic ID; an already persisted session wins
on retry. Invalid migration duration/zone leaves legacy data/display intact. No
schema bump, dual-write bridge or new mixed-version machinery was added.

## Focused coverage and validation

New coverage closes test gaps only: one persisted migrated lifecycle with two
restarts and an independent session, day-panel mouse/touch releases, placeholder
selection/Enter, WorkSession touch release, dialog Enter submission, ordinary
midnight movement and named-zone spring-gap/fall-fold movement plus resize.
The DST tests use explicit instants and `Intl.DateTimeFormat` in
`America/Los_Angeles`, independent of the Windows/browser viewing zone. They
prove elapsed duration and persisted identity/zone retention; they do not claim
new wall-time conversion or recurrence semantics. Existing configured/system/
custom/invalid-zone tests, midnight clipping, overlap and week-edge tests remain.

Outdated fixtures were corrected without changing runtime guards: backup's
unsupported future payload now carries an actually unknown field rather than the
supported `timeZone`; two hydrator integration stubs expose the Phase 3C backfill
method; the Task shortcut suite expects WorkSession scheduling instead of the
obsolete Task writer.

Historical Phase 3I result (superseded by the replay follow-up above): **Phase 3
complete and ready for final review/merge** within the then-reviewed
current-client contract. That increment needed no runtime change. Its final
cold-cache Chrome Headless 154 / Windows run executed **3,371 tests successfully**
out of 3,387, with **16 skips** and no failures. Frozen v18.15 state, current
persisted-state validation, localization compatibility, WorkSession exact shapes,
snapshot/hydration, backup, capture/replay, integrity and capability coverage ran.

Commands were run from the nested repository. The shell had Node but no npm/npx
wrapper on PATH, so the repository's own JS entry points were invoked directly;
no runtime/dependency installation was needed:

```powershell
node node_modules/@angular/cli/bin/ng.js cache clean
node node_modules/@angular/cli/bin/ng.js test --watch=false --no-code-coverage --source-map=false `
  --include='src/app/features/work-session/**/*.spec.ts' `
  --include='src/app/features/schedule/**/*.spec.ts' `
  --include='src/app/features/planning/**/*.spec.ts' `
  --include='src/app/features/planner/**/*.spec.ts' `
  --include='src/app/root-store/meta/**/*.spec.ts' `
  --include='src/app/features/config/store/global-config.reducer.spec.ts' `
  --include='src/app/util/iana-time-zone.spec.ts' `
  --include='src/app/ui/datetime-picker/**/*.spec.ts' `
  --include='src/app/op-log/validation/**/*.spec.ts' `
  --include='src/app/op-log/persistence/operation-log-hydrator*.spec.ts' `
  --include='src/app/op-log/persistence/operation-log-snapshot.service.spec.ts' `
  --include='src/app/op-log/backup/**/*.spec.ts' `
  --include='src/app/op-log/capture/**/*.spec.ts' `
  --include='src/app/op-log/apply/**/*.spec.ts' `
  --include='src/app/op-log/sync/sync-capability*.spec.ts' `
  --include='src/app/op-log/sync/conflict-resolution*.spec.ts' `
  --include='src/app/op-log/testing/integration/plan-today-replay.integration.spec.ts' `
  --include='src/app/features/tasks/task/task-shortcuts.spec.ts' `
  --include='src/app/features/tasks/task-context-menu/**/*.spec.ts' `
  --include='src/app/features/tasks/task-bulk-action*.spec.ts' `
  --include='src/app/features/tasks/task.service.spec.ts' `
  --include='src/app/features/tasks/task-duplicate.service.spec.ts'
git diff --check
```

`git diff --check` passed. `checkFile` (the exact `npm run checkFile` script,
invoked as `node tools/check-file.js <path>`) passed on each of these nine files:

- `src/app/features/planner/dialog-schedule-task/dialog-schedule-task.component.spec.ts`
- `src/app/features/schedule/schedule-work-session-edit.spec.ts`
- `src/app/features/schedule/schedule-timed-entry-points.spec.ts` (new)
- `src/app/features/tasks/task/task-shortcuts.spec.ts`
- `src/app/features/work-session/task-scheduling.spec.ts`
- `src/app/features/work-session/work-session.persistence.integration.spec.ts`
- `src/app/op-log/backup/backup.service.spec.ts`
- `src/app/op-log/persistence/operation-log-hydrator.failed-op-boot.integration.spec.ts`
- `src/app/op-log/persistence/operation-log-hydrator.retry.integration.spec.ts`

The other changed files are this audit and `docs/IMPLEMENTATION_PLAN.md`, formatted
with the installed Prettier entry point. No TypeScript/SCSS runtime file changed.
No `tsc -p tsconfig.json --noEmit` was used. Initial broad runs exposed stale
fixtures described above; the final cold-cache run includes their corrections.

Skip limitations:

- Fourteen existing Schedule tests require historical hardcoded Europe/Berlin
  expectations and skip outside that browser zone. They cover legacy repeat,
  calendar, flow and planned-task combinations; those exact legacy fixtures did
  not execute on Windows and are not claimed as validated. Executed
  `schedule-work-session.spec.ts` covers midnight clipping, visible week edges,
  overlapping distinct sessions, migrated suppression and read-only composition.
  Named-zone pure scheduling tests now prove ordinary midnight, spring DST gap
  and fall fold instant/duration/zone invariants without a platform skip. They do
  not replace the unrelated deferred recurrence fixture matrix or establish a
  new DST wall-clock layout contract.
- Two `bulk-hydration.meta-reducer.spec.ts` stress tests are opt-in via
  `RUN_STRESS_TESTS` and were disabled. Normal bulk replay, failure collection,
  persistent capture and session operation replay tests executed; stress-scale
  behavior was not tested in this increment.
- No E2E/live provider-server run was added or claimed. The existing real
  IndexedDB/encryption/file-adapter integration harnesses and UI component tests
  ran; API capability tests use the controlled provider harness, not a deployed
  server. This increment introduces no sync behavior change requiring a new
  server reproduction.

At the end of the historical Phase 3I increment, no remaining required gaps had
been identified; its Git state contained eleven intended test/documentation
changes. The subsequent review found the replay blocker described above. Test
logs remain local ignored artifacts under `.tmp/`.

## Deferred beyond Phase 3

Reminders, recurrence, richer WorkSession editing, generic multi-session management,
timezone picker, broad legacy fields/actions removal, canonical Event and
WeeklyTemplate domains, deadline projection consolidation and explicit provider
WorkSession export remain on their later-phase paths. Manual session completion
is a domain capability; no new completion-management interface was added.
Neither the historical Phase 3I increment nor this focused replay repair adds a
dependency or schema change. This repair performed no commit or push.
