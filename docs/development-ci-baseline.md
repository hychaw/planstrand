# Development CI baseline

Starting point: `chore/ci-baseline-cleanup` at
`c8aba65b1dc914953073d1dd31afe45f9ca4df51`, the development merge of PR #6.
The checkout was clean. PR #6 changed repository configuration and activated
previously dormant development checks; it did not change product TypeScript or SCSS.

## Original failure inventory

Evidence: PR #6 CI run 37244812178, server run 37244812172, and sync run 37244812174.
The failed logs were reviewed before editing expectations.

| Category                       | Original result                                                    | Classification and response                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stale product expectations     | 10 guard fallbacks and 4 Android fallback expectations             | Canonical fallback is `/today`; explicit legacy Today still resolves to `/tag/TODAY/tasks`. Preserve both behaviors.                                                                                                                                                                                                                                        |
| Angular harness/model fixtures | 27 board, 27 repair, 2 day-panel, enum and compaction model checks | Missing WorkSession/Schedule methods, missing Event fixture/coverage mapping, and pre-Event enum cardinality. Update fixtures without relaxing invariants.                                                                                                                                                                                                  |
| Sync-client integration        | Hydration/compaction and 4 archive replay cases                    | Snapshot-service mocks omitted Folder and WorkSession backfill. Keep real IndexedDB/reducers and recovery assertions.                                                                                                                                                                                                                                       |
| Date fixture                   | Non-scheduled repeat overflow placement                            | UTC offsets were added to elapsed durations and applied twice to the starting instant. Pin Berlin instants and a full work-day duration; remove this case's timezone skip.                                                                                                                                                                                  |
| Product defect                 | 4 Android canonical-start exit regressions                         | Top-level destination recognition omitted Today, Inbox, Master Tasks and This Week. Add the routes; retain the enum-wide exit invariant.                                                                                                                                                                                                                    |
| Server PostgreSQL              | 15 failed, 82 passed across 5 files                                | Live-upload fixtures still used schema 1 despite the schema-5 ingress floor. Historical database rows stay historical. The remaining 5-versus-8 assertion measures heap fetches, not sequence counts. Appended tuples invalidate the last seed page's visibility; pad with ordinary rows before VACUUM while retaining the exact 5-fetch budget.            |
| WebDAV                         | 23 failed, 38 passed                                               | Current physical paths are `planstrand-sync-*`, with protocol-4 product/capability envelopes for both single and split layouts. Upstream v16 data requires explicit adoption; automatic destructive force-overwrite is unsupported. Rewrite that scenario to prove no remote mutation and local-data preservation. Remaining races require hosted evidence. |
| SuperSync E2E                  | Shards 1, 2, 3, 4, 6 failed; 5 passed                              | Removed `/work` and `/work-view` routes fall through to primary navigation; legacy project/tag navigation closes and Today can render multiple projections of a task. Use supported context task routes. Align example-task copy with current onboarding. Keep convergence, switching, conflict and replay coverage.                                        |
| Local infrastructure           | Windows timezone and shell differences                             | Chrome can report no IANA system zone here. Linux shell tests also require Bash and LF scripts. Use hosted Linux checks for CI-equivalent proof; do not change gates around workstation limitations.                                                                                                                                                        |

## Scope and validation

No test suite is removed, disabled or made optional. Development branch filters,
required gates, synchronization semantics, database migrations and release tags are
unchanged. Product-code changes are limited to Android back navigation and
propagating protocol-incompatibility errors through split snapshot recovery.

Focused Angular validation repaired the original failing files. A full local run
reported 16,934 passing and two system-timezone diagnostic failures, with 19 existing
timezone-dependent skips. Hosted `npm run test` passed both configured Linux
timezone runs on revision d70a9d3. Server validation/service unit tests passed (201 tests)
and the server TypeScript build passed. Root `checkFile` passes for modified app and
E2E TypeScript; it intentionally refuses the five server spec paths, which use the
package's formatting/build/test validation instead.

The complete general-browser job and remaining provider results are pending.
The first WebDAV run improved from 23 failures/38 passes to 10 failures/56 passes;
six dependent cases did not run after their serial prerequisites failed. No skip
was added. SuperSync shards 1, 5 and 6 passed; shards 2, 3 and 4 each retained one
navigation/projection-harness failure corrected in the next revision. Follow-up
results are available in PR #7 checks; this report records the first hosted pass.

The WebDAV newer-protocol trace showed an actual bug: an immutable snapshot's
`PlanstrandFileIncompatibleError` was caught as recoverable corruption, allowing
an older fixed snapshot to hydrate. The split reader now propagates that error at
both snapshot fallback boundaries and before state backup. Four regression cases
cover immutable/fixed snapshots and future versions/semantics. All 226 tests in
the two related adapter files passed. Both changed files passed `checkFile`.

## Remaining atomicity defect

The original WebDAV stale-monolith trace reproduces multiple persisted operations
for one local task creation. After a fresh client joins a shared baseline, creating
`Writer B pending task` in the Today context captures, in order:

1. `[Task Shared] addTask`
2. `[Tag] Update Tag`, from `preventParentAndSubTaskInTodayList$`
3. `[Planning] Set Placement`, from `TaskService.add()`

The upload-lock test finds three pending IDs where its one-intent assertion expects
one. This is not a renamed-file failure or a reason to loosen that assertion.
`TaskService.add()` dispatches creation and then separately invokes the Planning
command; the legacy Today consistency effect also persists its correction.
The task, legacy ordering and Planning placement need an atomic creation path with
replay coverage. Changing those synchronized semantics belongs on a separate fix
branch. The existing four stale-monolith scenarios retain their reproduction and
pending-ID preservation assertions. No extra capture is suppressed here.

Hosted server integration on the first revision improved from 15 failures to one
(96 passing). Its remaining failure was a unique-sequence collision between the
new ordinary padding and the test's unvacuumed tail. Padding now uses a disjoint
sequence range; the exact heap-fetch and boundary assertions are unchanged.

Other retained WebDAV failures require separate product work or policy review:

- Surgical migration captures two operations for a new task where its regression
  requires one. The same creation/Planning atomicity issue applies.
- The backup-only claim scenario assumes that a new split client can claim a folder
  with a surviving single-file backup. The current namespace guard intentionally
  fences any existing namespace with neither primary commit. Whether a valid backup
  should permit explicit recovery needs a separate policy decision; the test is
  retained rather than silently accepting an empty overwrite.

The remaining upload-unseen-operations harness expected one physical GET. Namespace
discovery and semantic screening add two reads before the engine download. Its
exact pre-upload expectation is now three GETs, with the lock, cursor, unseen-ID and
convergence checks retained.

The inherited Today remove-versus-reorder expectation was also stale. The trace
shows both commands capture `[Planning] Set Placement`. Schema 5's published
PlanningRecord contract resolves target and order together by counter, lexical
clientId, then opId; it does not guarantee that removal beats every concurrent
reorder. The rewritten scenario captures both authored records before sync,
computes that contract's exact winner, and verifies the complete record and exact
Today task order on both clients, including after B's reload. No production merge
rule was changed.

## Changed-file validation

Each changed TypeScript file was passed to checkFile. Server specs are explicitly excluded by root ESLint, so their package checks are recorded separately. No SCSS, YAML or JSON file changed.

| File                                                                                       | Result                                                    |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| e2e/tests/sync/supersync-example-task-fresh-client.spec.ts                                 | Passed                                                    |
| e2e/tests/sync/supersync-import-other-client-ops.spec.ts                                   | Passed                                                    |
| e2e/tests/sync/supersync-import-same-client-ops.spec.ts                                    | Passed                                                    |
| e2e/tests/sync/supersync-lww-conflict.spec.ts                                              | Passed                                                    |
| e2e/tests/sync/supersync-models.spec.ts                                                    | Passed                                                    |
| e2e/tests/sync/supersync-superseded-clock-regression.spec.ts                               | Passed                                                    |
| e2e/tests/sync/supersync-vector-clock-pruning.spec.ts                                      | Passed                                                    |
| e2e/tests/sync/webdav-format-rollout.spec.ts                                               | Passed                                                    |
| e2e/tests/sync/webdav-newer-format-8764.spec.ts                                            | Passed                                                    |
| e2e/tests/sync/webdav-setup-encryption.spec.ts                                             | Passed                                                    |
| e2e/tests/sync/webdav-split-claim-bak.spec.ts                                              | Passed                                                    |
| e2e/tests/sync/webdav-stale-monolith.spec.ts                                               | Passed                                                    |
| e2e/tests/sync/webdav-surgical-sync.spec.ts                                                | Passed                                                    |
| e2e/tests/sync/webdav-sync-full.spec.ts                                                    | Passed                                                    |
| e2e/tests/sync/webdav-sync-today-tag.spec.ts                                               | Passed                                                    |
| e2e/tests/sync/webdav-upload-unseen-ops-10239.spec.ts                                      | Passed                                                    |
| e2e/utils/supersync-helpers.ts                                                             | Passed                                                    |
| e2e/utils/sync-helpers.ts                                                                  | Passed                                                    |
| packages/super-sync-server/tests/integration/clean-slate-atomicity-sql.integration.spec.ts | Excluded by root ESLint; package build/format checks used |
| packages/super-sync-server/tests/integration/device-touch-upload-race.integration.spec.ts  | Excluded by root ESLint; package build/format checks used |
| packages/super-sync-server/tests/integration/old-ops-boundary-plan.integration.spec.ts     | Excluded by root ESLint; package build/format checks used |
| packages/super-sync-server/tests/integration/repair-causality.integration.spec.ts          | Excluded by root ESLint; package build/format checks used |
| packages/super-sync-server/tests/integration/state-replacement-guard.integration.spec.ts   | Excluded by root ESLint; package build/format checks used |
| src/app/app.guard.spec.ts                                                                  | Passed                                                    |
| src/app/features/android/android-back-button.service.spec.ts                               | Passed                                                    |
| src/app/features/android/android-back-button.service.ts                                    | Passed                                                    |
| src/app/features/boards/board-panel/board-panel.component.spec.ts                          | Passed                                                    |
| src/app/features/schedule/map-schedule-data/map-to-schedule-days.spec.ts                   | Passed                                                    |
| src/app/features/schedule/schedule-timed-entry-points.spec.ts                              | Passed                                                    |
| src/app/op-log/core/action-types.enum.spec.ts                                              | Passed                                                    |
| src/app/op-log/persistence/operation-log-compaction.service.spec.ts                        | Passed                                                    |
| src/app/op-log/testing/integration/archive-conflict-resolution.integration.spec.ts         | Passed                                                    |
| src/app/op-log/testing/integration/hydration-compaction-race.integration.spec.ts           | Passed                                                    |
| src/app/op-log/validation/data-repair.spec.ts                                              | Passed                                                    |
| e2e/tests/sync/supersync-project-delete-conflict.spec.ts                                   | Passed                                                    |
| src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts                | Passed                                                    |
| src/app/op-log/sync-providers/file-based/planstrand-file-sync-adapter.service.spec.ts      | Passed                                                    |
