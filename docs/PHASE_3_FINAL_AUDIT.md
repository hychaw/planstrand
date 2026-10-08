# Phase 3 final audit

## Recovery coverage and regular E2E merge hardening — current assessment

This section supersedes the earlier readiness conclusions below; their evidence
and text remain historical and unchanged. Starting branch was
`feature/phase-3-work-session-timezone`, with fetched local and remote HEAD both
`e44a4def64f913299adde1dd5c7b4205b7682830`. The only initial working-tree changes
were this audit and `IMPLEMENTATION_PLAN.md`; both were backed up and preserved.
Remote refs were fetched before work. No prior temporary validation branch
remained. No merge, rebase, squash, schema bump, dependency addition or replay/LWW
reimplementation was performed.

### Provider failure evidence and corrections

All fifteen failures in run 37072538804 were read from their failure logs and
saved browser/network traces. They fit the four reported groups; realtime
request counting additionally shared the probe-observer defect. None initially
demonstrated a new provider runtime defect. Production sync code was unchanged.

| Group                                        | Original failures | Correction                                                                                                                                                                                                                                                                  | Actual assertions preserved and executed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task Create plus independent Planning        |                 7 | Match `TASK`/`CRT` IDs and entity IDs instead of whole-log counts; preserve all original upload IDs and their retry order. Realtime upload metadata is captured in the POST interceptor, before response completion discards request data.                                  | Future schema/vocabulary cases freeze at the exact rejected operation, keep accepted-prefix/suffix ordering and retry correctly. Post-import operations advance author clocks and persist with a pruned clock. Response-loss accepts every original op ID exactly once, exactly one Task Create per Task entity even under a different hypothetical retry ID, preserves pending operations over restart, and delivers exactly ten Tasks to the peer. Realtime retains exactly one upload and one peer operation download. |
| Cutover/capability probe counted as download |                 5 | Classify exact GET `/api/sync/ops?sinceSeq=0&limit=1` with no excluded client as the startup cutover probe, before tests rewrite limits. Observe actual downloads separately; never subtract a count or use a timing window. Realtime metrics retain separate probe counts. | Backlog resumes from the persisted cursor and downloads all required pages. Corrupt final-page recovery retries the actual suffix without replacing server state. Interrupted forced download preserves pending ops, resumes with monotonic cursor, uploads the replacement, and converges with a peer. Time-delta crossing converges without an unintended full recovery download.                                                                                                                                       |
| WebDAV filename observation                  |                 2 | Recognize authoritative `planstrand-sync-*` and explicit legacy `sync-*` names, including metadata/backups; retain write commit-point filtering.                                                                                                                            | Both provider-switch directions reach their synchronization, recovery and final convergence assertions with both providers required. The observer sees the real file transaction; production filenames were unchanged.                                                                                                                                                                                                                                                                                                    |
| Rewind history omits Planning                |                 1 | Restore the real final Task Create and its real Planning operations in original server-sequence order, excluding irrelevant update backlog.                                                                                                                                 | The stale cursor detects rewind, resets and downloads the restored history. Today visibility proves recovery of coherent Task plus canonical Planning state. No Task field is used to fake Planning membership.                                                                                                                                                                                                                                                                                                           |

The narrower post-response-loss entity duplicate assertion reads the authenticated
operation API, since the test-only server-history endpoint deliberately omits
entity metadata. Duplicate checking covers both original op IDs and Task entity
identity; Planning is not globally filtered out of helpers or persistence.

Focused runs:

- [37076645977](https://github.com/hychaw/planstrand/actions/runs/37076645977):
  15 passed, 1 failed, 0 skipped across sixteen selected cases. All original
  failures except realtime reached and passed their safety assertions, along
  with the companion final-page no-replacement case. Realtime exposed the
  response-completion request-data issue and was not counted as repaired.
- [37077222097](https://github.com/hychaw/planstrand/actions/runs/37077222097):
  15 passed, 1 failed, 0 skipped. Realtime then reached its strict request-count
  assertion and exposed cutover probes in that observer; this was fixed without
  loosening the one-upload/one-download contract.
- [37077714551](https://github.com/hychaw/planstrand/actions/runs/37077714551):
  response-loss/restart job `111071700643` **1 passed**; realtime job
  `111071700921` **1 passed**. Empty shards are excluded from evidence.
  Together these runs establish passing evidence for all fifteen original cases.
  The proactively canceled intermediate run 37077498930 is excluded.

Full [run 37080254349](https://github.com/hychaw/planstrand/actions/runs/37080254349)
on `9aff578c898d576bd83a43f53924b70fcf53bf8d`: **326 passed, 0 failed,
14 skipped, 0 unrun**. All six SuperSync jobs are green. All fifteen original
coverage failures now pass, and the thirty-seven failures eliminated by the
earlier LWW fix remain passing. No new failing title or separate provider runtime
defect remains. All six cases previously unrun before the LWW repair are now
executed; skips remain excluded from proof.

| SuperSync shard / job | Passed | Failed | Skipped |
| --------------------- | -----: | -----: | ------: |
| 1/6 — `111079527143`  |     57 |      0 |       0 |
| 2/6 — `111079527138`  |     57 |      0 |       0 |
| 3/6 — `111079527161`  |     51 |      0 |       6 |
| 4/6 — `111079527201`  |     53 |      0 |       4 |
| 5/6 — `111079527256`  |     53 |      0 |       3 |
| 6/6 — `111079527172`  |     55 |      0 |       1 |

The migrated WorkSession provider target also passes in shard 3/6 through edit,
completion, reload and dismissal. Its historical fail-before evidence was not
recreated. Frontend build and SuperSync server unit tests pass. The optional
standalone WebDAV/released-client jobs were omitted; required WebDAV switching
cases executed inside the SuperSync suite with both providers required.

### Fair regular baseline and repaired regressions

The [37-row failure matrix](PHASE_3_E2E_FAILURE_MATRIX.md) records original
symptoms, product area, Phase 3 scope, baseline/feature results, classification
and required action. The fair baseline is Phase 2 development
`4c2850520dea8a19ee02a4356e0140081b34ded4` plus only independently identified
Today add-bar correction `db97a96d268aafb688a98b6a3f9f3470a94e6086`.
It was built in a clean isolated worktree and pushed only as temporary
`validation/phase3-fair-baseline`, producing
`7eaa3076c2b15bf42d70534590dd531eb2c30317`.
[Baseline run 37076203912](https://github.com/hychaw/planstrand/actions/runs/37076203912),
regular job `111067236717`, completed **409 passed, 14 failed, 2 skipped**.
No Phase 3 code was cherry-picked. The temporary local/remote branch and worktree
were removed after recording evidence; development was not changed.

Original 37-failure classification:

| Classification             | Failures | Root causes / action                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deferred                   |        9 | Normal timed scheduling intentionally creates WorkSessions and omits the legacy Task reminder controls/flow. These tests pass on the baseline but exercise UI outside the documented Phase 3 contract. The short-syntax case successfully creates a legacy Task before expecting the old reminder dropdown on normal rescheduling. No retained supported reminder-path regression is demonstrated. |
| Pre-existing / Phase 2     |       12 | Identical baseline assertion symptoms: selected board move; calendar all-day poll/import setup; GitHub fixture import; three Planner keyboard cases; two orphan-search fixtures; two drag/conversion cases; multi-select unschedule; subtask strict locator. Not introduced by Phase 3.                                                                                                            |
| Stale expectation          |        3 | Overlap and continued-segment clicks now operate the exact WorkSession menu. The long-session fixture sets the estimate before creating its independent session and checks both segments plus exact-session removal. Later Today ordering explicitly seeds the preserved legacy timed Task action, since normal scheduling no longer writes Task timing. All three corrected focused tests pass.   |
| Flaky/environmental        |        2 | Archived/deleted calendar import fixtures encode local Today as noon UTC. Both failed setup on baseline and original feature, then passed unchanged in the final run under a different zone; the matrix explains the clock-dependent placement. No Phase 3 fix is credited.                                                                                                                        |
| Genuine Phase 3 regression |       11 | Ten recurrence failures share one ID-less date-picker exception; one small-viewport failure also exposed zero-estimate timed scheduling, alongside obsolete date/button assumptions. Both runtime causes were fixed, separately from provider coverage.                                                                                                                                            |

The shared `undefined.length` exception was traced once through browser stacks
to `taskScheduledWorkSessionId`, reached from the recurrence editor's deliberate
ID-less `isSelectDueOnly` Task. This date-only editor now bypasses WorkSession
lookup. A permanent regression failed **1 failed / 17 passed** before the fix;
dialog, recurrence-editor and WorkSession scheduling specs passed **71 tests**
afterward. All ten recurrence regular CI cases pass in run
37077222097, whose regular totals were **396 passed, 27 failed, 2 skipped**.
No recurrence design or timed-repeat generation changed.

The normal timed dialog also failed to create a WorkSession for an unestimated
Task, because `WorkSessionService.scheduleTask` had no positive-duration
fallback. The caller now supplies the existing schedule minimum (600001 ms);
Task estimate/dates and Planning remain independent. Its permanent unit
regression failed **1 failed / 18 passed** before correction; focused dialog and
WorkSession scheduling specs afterward passed **30 tests**. The permanent browser
case failed at dialog dismissal on a valid-zone before build, then passed through
creation, unchanged Task/Planning assertions and reload persistence after the fix.
The small-viewport fixture selects its date explicitly and retains calendar
width/height, no-horizontal-scroll and single-row layout assertions for the
documented Cancel/Schedule action row.

Corrected local focused browser results: unestimated Task plus small viewport
**2 passed**; overlap **1 passed**; continued segment **1 passed**; legacy Later
Today ordering **1 passed**. Native Chrome on Windows initially reported an
undefined system timezone, so those local failures were isolated with matching
Node/browser zones; they are not counted as product regressions or passes.
The valid before/after scheduling builds retain production timezone guards.

An additional focused check of the preserved reminder service, Task reminder
effects, short syntax and recurrence-generation service passed **347 unit tests**.
This supports the retained legacy facade contract; it does not turn the nine
unsupported normal WorkSession reminder UI cases into passing E2E evidence.

Final [run 37080254349](https://github.com/hychaw/planstrand/actions/runs/37080254349),
regular job `111079527061`, on feature HEAD
`9aff578c898d576bd83a43f53924b70fcf53bf8d`: **403 passed, 21 failed,
2 skipped, 0 unrun**. No new failing titles appeared. All ten recurrence cases,
the repaired unestimated-Task scheduling case and the three corrected scheduling
expectations now pass; the new unestimated-Task persistence case also passes.
The remaining twenty-one are twelve failures reproduced on the fair Phase 2
baseline and nine documented reminder-deferral cases.

The nine reminder cases were checked against their actual setup and assertions:

- Three default-reminder-option cases expect reminder controls in normal timed
  scheduling/rescheduling or the old Task detail panel after clicking a schedule
  block. The short-syntax case creates its legacy Task successfully before opening
  normal rescheduling; its failure does not prove short-syntax reminder creation
  is broken.
- Two scheduled-list cases use normal timed scheduling, then expect legacy timed
  Task list entries. That command now creates an independent WorkSession.
- Four reminder view/dismissal cases use `addTaskWithReminder`, which actually
  delegates to normal timed scheduling, then wait for a legacy Task reminder
  dialog that this WorkSession command does not create. Their later reminder
  safety assertions are not reached and are not claimed as validated.

The Phase 3G boundary in `IMPLEMENTATION_PLAN.md` explicitly states that these
timed commands emit no Task reminder write; the normal dialog hides reminder
controls. WorkSession reminders remain deferred. Select-due-only configuration,
legacy reminder delivery/snooze, short-syntax creation and recurrence compatibility
remain retained paths. The nine failures demonstrate the documented unsupported
UI boundary, not a concrete regression of those retained paths. The 347 focused
unit passes support legacy compatibility without substituting for the nine E2Es.

### Repository policy and readiness

Root/e2e agent guidance requires reproduction-first sync evidence, per-file
checks and real provider execution; unavailable/skipped providers never validate
a fix. The [PR checklist](../.github/PULL_REQUEST_TEMPLATE.md) says
“Existing tests still pass”. Read alongside the
[development guidance](development.md) and
[feature review guide](feature-review-guide.md), the audit interprets this as
**B: do not introduce unresolved regressions in the supported feature contract**.
None of those rules explicitly mandates repairing all historical baseline E2E
failures before any feature merge. No formal accepted-failure/waiver mechanism or
specific precedent was found; this is a stated policy interpretation, not a
claim that a waiver exists or that the regular workflow is green. The twelve
baseline failures are not Phase 3 blockers. The nine reminder UI cases remain
visible known limitations of the explicitly deferred WorkSession reminder
contract. No tests were skipped or changed merely to make CI green. GitHub branch
protection is not used as the basis for this conclusion.

**Phase 3 ready for final merge review**. No current Phase 3 introduced,
in-scope product regression remains identified. Provider recovery/convergence,
migrated replay and synthetic LWW validation are complete; the actual recurrence
and unestimated-Task compatibility regressions were repaired and pass. Final
review must retain visibility of the baseline failures and reminder limitations;
this conclusion authorizes review, not a merge.

### Files, validation and Git record

Runtime changes are confined to `dialog-schedule-task.component.ts` and its spec;
the new `schedule-task-without-estimate.spec.ts` proves real persistence.
Provider coverage changes are `e2e/utils/supersync-helpers.ts`,
`e2e/pages/sync.page.ts`, and the backlog, error-scenarios, final-page-decrypt,
import-other-client, interrupted-forced-download, network-failure, realtime-push
and time-delta-rename-crossing SuperSync specs. Regular fixture/assertion changes
are small-viewport, overlap, split-segment and Later Today subtask-order specs.
The audit's original uncommitted content is preserved; the plan's original
uncommitted LWW rule is retained and extended only with the durable independent
Task/Planning recovery and semantic observer invariant. The new failure matrix
holds all thirty-seven compact classifications.

All seventeen modified TypeScript files passed repository `checkFile` (including
E2E formatting/lint); focused unit/browser/provider results are listed above.
`git diff --check` passes. No setup-aborted, skipped, empty-shard, diagnostic
monkey-patched or canceled test is counted as safety evidence.

Focused commits, pushed only for CI:

| Commit      | Purpose                                                       |
| ----------- | ------------------------------------------------------------- |
| `5fec082f8` | Update sync recovery E2E coverage                             |
| `318386c03` | Keep recurrence date picker outside WorkSession lookup        |
| `dcd4db446` | Capture realtime upload metadata before response completion   |
| `5797ab409` | Assert one Task Create per entity after upload retry          |
| `61b815c61` | Read retry entity metadata from the operation API             |
| `af9f406de` | Separate realtime cutover probes from operation downloads     |
| `e312320a9` | Schedule unestimated Tasks with the existing minimum duration |
| `9aff578c8` | Align scheduling E2E fixtures with WorkSession boundaries     |

Validated runtime/test feature SHA: `9aff578c898d576bd83a43f53924b70fcf53bf8d`.
The final documentation pass started with fetched local/remote HEAD at that SHA
and only the preserved audit/plan changes plus the new failure matrix. These three
documentation files are finalized in a separate `Finalize Phase 3 validation
audit` commit; the resulting commit is identified in the completion report and Git
history. No runtime/test changes or broad rerun were needed for this final pass.
Documentation formatting and `git diff --check` were run. No merge was performed.

---

## Synthetic LWW vocabulary merge hardening

Starting branch: `feature/phase-3-work-session-timezone`; fetched local and remote
HEAD both `5823f299ff133e46cb0481369b12e89345568358`. The only starting working-tree
change was the provider-evidence section immediately below; it is preserved.
No temporary validation branch remained locally or remotely. No merge, rebase,
squash, migrated-replay fail-before rerun, schema bump or WorkSession semantic
change was performed.

### Reproduced root cause and exact operation

The existing provider case **3.1 Concurrent disjoint task edits merge without
field loss** failed in [run 37065442530](https://github.com/hychaw/planstrand/actions/runs/37065442530),
[SuperSync 3/6 job 111032810469](https://github.com/hychaw/planstrand/actions/runs/37065442530/job/111032810469)
on `db97a96d268aafb688a98b6a3f9f3470a94e6086`. The saved trace correlates Client B's
`ConflictResolutionService: Appended disjoint-merge op` with Client A's block of
the same ID. The subsequent full feature run on the starting HEAD also failed
this case (SuperSync 6/6).

| Field            | Actual rejected operation                                                   |
| ---------------- | --------------------------------------------------------------------------- |
| ID               | `01a0fe7b-2005-7655-a111-53da0cdc61ff`                                      |
| actionType       | `[TASK] LWW Update`                                                         |
| opType           | `UPD`                                                                       |
| entityType       | `TASK`                                                                      |
| entityId         | `-57o6S2exFceAKJrQ61YM`                                                     |
| schemaVersion    | `5` (receiver current version also `5`)                                     |
| Origin           | Client B `B_lZG2dY`, disjoint-merge resolver, persisted as local resolution |
| Transport        | Encrypted payload uploaded successfully, then downloaded by Client A        |
| Receiver outcome | `UNKNOWN_OP_VOCABULARY`; cursor cannot pass this operation                  |

Commit `03e63d301` added the action fence to preserve unfamiliar future semantics
losslessly. Its set covered only immutable `ActionType` values. The current
replacement builder deliberately generates LWW strings outside that enum;
conversion and reducers already recognize them through the shared helper.
`[TASK] LWW Update` is an exact member generated by
`createLwwUpdateActionTypeHelpers(ENTITY_TYPES)`, not future vocabulary.

### Correction and focused validation

Commit `e44a4def64f913299adde1dd5c7b4205b7682830`, **Accept generated LWW sync
actions**, adds a private `KNOWN_REMOTE_ACTION_TYPES` set at the remote boundary:
`KNOWN_ACTION_TYPES` union exact `LWW_UPDATE_ACTION_TYPES`. The latter remains
derived from shared `ENTITY_TYPES`; no duplicated entity list, suffix wildcard,
static enum/code change, or new wire format was introduced. All remote gate
consumers inherit this correction through the existing shared predicate.

Before changing runtime code, permanent unit/integration regressions produced
**3 failed, 46 passed**: every generated action was blocked, the interpretable
prefix stopped at a Task LWW operation, and an actual generated replacement
could not reach reducer application after JSON/compact storage round-trip.
After correction, **570 focused tests passed**, covering LWW/disjoint conflict
resolution, no-pending concurrent reconstruction, replacement construction,
remote screening, conversion, reducer application, integrity and compact
persistence. Another **465 encrypted transport/download/file-provider tests
passed** (4 skipped and excluded from evidence). Repository `checkFile` passed
all four modified TypeScript files, including the provider spec; `git diff
--check` passed.

Negative coverage retains arbitrary future actions, future ordinary NgRx
strings, `[TASK] LWW Update Extra`, unregistered LWW entities and malformed,
missing, empty or non-string metadata as vocabulary blockers. Invalid,
unsupported and too-new schema versions retain precedence. Unknown operations
still freeze the cursor and retain their suffix rather than being skipped.

Serialization already supports this contract: the helper deliberately casts
synthetic strings to the narrowed app `ActionType`; the compact encoder falls
back to the complete string and the decoder preserves it. IndexedDB stores
that compact representation, JSON wire transport retains it, encryption leaves
the envelope metadata intact, and snapshot/tail replay uses the existing
converter/LWW reducer. The new integration regression checks generated
replacement -> JSON -> compact encode/decode -> remote screen -> real LWW
meta-reducer. The existing capture enum check is a local development warning;
the remaining enum consumer sanitizes error display. Neither is a second
remote acceptance gate, and neither was loosened.

[Focused run 37071955843](https://github.com/hychaw/planstrand/actions/runs/37071955843)
executed both targets on the repair SHA with required providers and zero retries:

- [SuperSync 2/6 job 111053880881](https://github.com/hychaw/planstrand/actions/runs/37071955843/job/111053880881):
  case 3.1 **1 passed**. Strengthened permanent assertions prove a local
  synthesized `[TASK] LWW Update` was acknowledged as synced, and the peer
  persisted that same ID as remote/applied. Both independent Task fields
  converge. No `UNKNOWN_OP_VOCABULARY` occurred.
- [SuperSync 1/6 job 111053880804](https://github.com/hychaw/planstrand/actions/runs/37071955843/job/111053880804):
  migrated WorkSession replay **1 passed**, including edit, completion, reload
  and dismissal. This is a post-generic-fix regression check, not replacement
  of the already-complete historical replay evidence.

Frontend build and server unit tests passed. Empty provider shards are not
counted as test evidence. The optional broad E2E `tsc` command cannot resolve
existing app/plugin path aliases in `e2e/tsconfig.json`; it is not counted as a
passing check and no unrelated configuration change was made.

### Full provider rerun and remaining merge evidence

[Run 37072538804](https://github.com/hychaw/planstrand/actions/runs/37072538804)
completed all six SuperSync shards on the repair SHA: **311 passed, 15 failed,
14 skipped, 0 unrun**, compared with **268 passed, 52 failed, 14 skipped,
6 unrun** on the starting HEAD. Exactly **37 prior failing titles now pass**;
there are no new failing titles. Skips are excluded from evidence.

The passing cases include Task LWW/disjoint and three-client convergence,
delete/update races, encrypted conflicts, singleton/plugin/counter LWW,
snapshot concurrency, rejected-operation ordering, transient-download recovery,
pruned-import recovery, project-note reorder, rounding, recurring-subtask
duplication and mixed Today/Planning winners. The whole-dataset dialog helper
also passed; its previous archive-restore setup timeout is not independently
attributed to this runtime fix.

Remaining failures group into **four test-contract defects**, rather than 15
independent demonstrated runtime convergence defects:

| Cause                                                    | Count | Evidence and scope                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task creation now includes canonical Planning operations |     7 | Future-schema and three mid-batch blocker cases expect 1/3 uploads but receive 2/6 before injecting blockers; post-import clock test expects 2 but receives 4; response-loss expects 10 but receives 20; realtime expects 1 but receives 2. Their intended end-to-end safety/recovery assertions are not reached.                                                                                                                   |
| Cutover probe counted as a recovery/full-download page   |     5 | `LegacyCutoverService` calls `downloadOps(0, undefined, 1)`. Ordinary backlog expects the first request to start at cursor 4 but sees this probe at 0. Final-page decryption retry and interrupted-download observers also include it. Both time-delta crossing cases pass Task convergence, then classify probes as forbidden full downloads. The saved backlog trace proves real paged downloads resume and apply the final Task. |
| WebDAV observer watches legacy filenames                 |     2 | `SyncPage` matches `sync-data/ops/state` filenames while the adapter uses `planstrand-sync-*`. Both saved provider-switch network traces show PUT `planstrand-sync-data.json` returning 201 and GET returning 200 before the helper's “no provider response” timeout. Full switch assertions remain unverified.                                                                                                                     |
| Rewind fixture restores Task without canonical Planning  |     1 | The fixture wipes real server history and saves/reuploads only final `TASK`/`CRT`, omitting its Planning operation, then expects that Task in Today. This cannot prove complete canonical-state recovery.                                                                                                                                                                                                                           |

The LWW acceptance defect has valid permanent and provider evidence and no
remaining reproduced LWW rejection. However, required provider evidence for
future-vocabulary recovery, response-loss/restart, interrupted download,
complete rewind and provider switching is incomplete until these concrete
fixture/observer contracts are corrected and their actual assertions pass.
No skipped or prematurely failing case is treated as a pass. No unrelated
runtime changes were made to conceal these failures.

### Regular E2E assessment

The regular job in full run 37072538804 completed **386 passed, 37 failed,
2 skipped**, with exactly the same failing titles as the starting HEAD.

The regular job in focused run 37071955843 completed **385 passed, 38 failed,
2 skipped**. All 38 titles also failed in the earlier pre-replay-repair run
(385/38/2); 37 failed in the starting-HEAD run (386/37/2). The variable extra
failure is the subtask Today keyboard shortcut, not date-only add-bar creation.
There is no new failure title attributable to the vocabulary repair. This
comparison does not prove that every old failure is unrelated to Phase 3.

Of the original 37 failures, 19 concern explicitly deferred recurrence/reminder
functionality; five concern calendar/schedule behavior; twelve concern
board/Planning/search/task/subtask flows; one concerns issue-provider refresh.
Phase 2 canonical Planning changed Today placement, while Task date editing is
deliberately independent. Several older tests still assume legacy placement;
others need UI/fixture or product ownership evidence. Those unresolved cases
are not silently waived, and no general cleanup or deferred product work was
added. The vocabulary patch touches neither Today/add-bar nor WorkSession
semantics.

**Phase 3 still blocked** for final merge readiness: the four provider
test-contract defects above leave required safety/recovery/switch coverage
incomplete, and the non-deferred regular failures lack a completed Phase 2 /
Phase 3 / pre-existing causality classification. No separate current-client
LWW convergence defect remains demonstrated by this rerun.

The runtime commit alone was pushed for CI; this audit and the durable receiver
rule clarification in `IMPLEMENTATION_PLAN.md` remain uncommitted. Historical
sections below are unchanged.

## Provider replay evidence and Task setup correction

Validated 2026-10-02 on feature HEAD
`5823f299ff133e46cb0481369b12e89345568358`. This section supersedes the provider
pending and readiness statements below. Both replay repair and
`e3f4fa80ae6cd53ac1322d5393a73f6eff925e99` Task-owner validation are included.

The original provider attempts (`36979488015`, `36982596097`) failed before replay
because Today rendered no Task row. Direct browser/store/IndexedDB inspection
showed that Task creation succeeded: the entity, Inbox ordering, legacy Today
ordering and persistent Task Create operation existed, but canonical Planning
was empty. The same failure occurred without SuperSync and on `development`
(`36985164027`, SuperSync 1/6 job `110769121192`). Phase 2 commit `4c2850520`
changed Today selectors to Planning membership, while the add bar's default Today
date chip still supplied only `dueDay`, bypassing the Task service's fallback
for creation without an explicit date. This was a product visibility defect,
not a stale DOM assertion or sync overwrite.

Commit `db97a96d268aafb688a98b6a3f9f3470a94e6086` uses the existing Planning command
for the add bar's local date-only selection. Task date edits remain independent
from Planning; no WorkSession/replay logic changed. Commit
`5823f299ff133e46cb0481369b12e89345568358` corrects the regression spec's seed
lookup to match the helper's existing client-prefixed title. Replay assertions
are unchanged. These two commits were required to execute GitHub Actions.

Both evidence runs used `.github/workflows/e2e-scheduled.yml`, `workflow_dispatch`,
`grep=@supersync`, `run_webdav=false`, and `run_released_clients=false`. Frontend
build, server unit tests and target-shard SuperSync/WebDAV startup succeeded.
The exact executed target was
`supersync-migrated-work-session-replay.spec.ts:71:7`,
**preserves edits and completion on an unmaterialized current client, then retains dismissal**.

- **Failing-before:** [run 37066310924](https://github.com/hychaw/planstrand/actions/runs/37066310924),
  [SuperSync 3/6 job 111035752695](https://github.com/hychaw/planstrand/actions/runs/37066310924/job/111035752695),
  SHA `7e534b7f11d4160aab4b72870ada5783b0cadd9b`. After successful Task setup,
  both-client initialization, A's backfill and Update/Complete synchronization,
  line 150 expected B's edited/completed session and received `undefined`.
  Expected start/end: `1790984239031` / `1790986939031`; completion:
  `1790977044505`; authoritative timezone: `Pacific/Honolulu`.
  Target shard: **40 passed, 11 failed, 6 skipped**.
- **Passing-after:** [run 37066314686](https://github.com/hychaw/planstrand/actions/runs/37066314686),
  [SuperSync 3/6 job 111038145604](https://github.com/hychaw/planstrand/actions/runs/37066314686/job/111038145604),
  exact feature SHA above. The target completed edited timing, completion,
  reload persistence, dismissal and another reload. The line reporter records
  execution; the exhaustive failure list excludes the target, with all 57 cases
  accounted for: **41 passed, 10 unrelated failures, 6 skipped**, none unrun.

The temporary revision contained base `2fcad48cc`, the regression test, and only
the independent setup correction/component test plus title correction
(cherry-picks `3536a4386`, `7e534b7f1`). It contained neither replay repair nor
Task-owner seed validation. Its remote and local branches were deleted after
both target results were recorded; the feature branch remains checked out.

Validation: the new component regression failed before the correction; afterward
**449 focused add-bar, Task service and Planning tests passed**. `checkFile`
passed all three changed TypeScript files. Frontend build and ordinary Task CRUD
E2E passed locally. Focused provider run
[37065442530](https://github.com/hychaw/planstrand/actions/runs/37065442530)
passed **9/11** basic cases, including 2.1 creation/download and 2.2 reverse sync
in SuperSync 1/6 job `111032810374`. The full feature provider run has no
`Task creation failed` errors in any shard, with **268 passed, 52 failed,
14 skipped, 6 not run** overall; skipped/unrun cases are not validation.

**Required replay provider evidence is complete; overall readiness remains
blocked by separate CI/product failures.** All six full feature SuperSync jobs
failed. A conflict trace ties a rejected operation directly to a legitimate
Task disjoint-merge/LWW operation: the action vocabulary fence introduced in
`03e63d301` accepts enum action types, while synthetic LWW types are generated
outside that enum. Ordinary conflict/convergence cases fail with
`UNKNOWN_OP_VOCABULARY`; these are not intentional negative tests or
infrastructure failures. Other provider failures include backlog, recovery and
network-loss scenarios and remain untriaged. The full feature workflow completed
with **failure**; its regular suite had **386 passed, 37 failed, 2 skipped**, including failures in deferred
scheduling/recurrence/reminder and list-interaction coverage. No accepted-failure
waiver was established for the genuine convergence defect, so a green target
does not establish merge readiness. GitHub currently has no enforced required
checks or protection on `development`; the readiness blocker is the observed
product failure, not a GitHub enforcement rule. No unrelated runtime repair, merge or rebase
was performed. This evidence documentation remains uncommitted.

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
