# Routines Phase 6a.2 — Supported replay blocker and safety correction

October 11, 2026 UTC. Branch `feature/v1.2-routines`; starting HEAD
`baf934488b6341c78fa9ee0f26d14fe8d4106db2`, matching the requested HEAD, with
a clean working tree. Phase 6a, 6a.1 and 5b.3 reports were reviewed and preserved.

**Task/Event recovery P1 is not resolved.** This milestone stops at the user's
explicit boundary: a broader client replay/archive extraction is required, so
it reports that blocker instead of inventing recovery semantics. A small,
validated safety correction closes two confirmed successful-but-incomplete
Task export paths. It does not implement missing Task/Event replay and does
not satisfy the original completion objective. **NO-GO for release preparation**;
native Windows sign-off remains independently incomplete and was not attempted.

## Confirmed cause and coverage

The operator's synchronous server replay has adapters for isolated domains,
but no authoritative Task/Event application path. Its generic uppercase maps
are not persisted client state. More subtly, `applyPlanningReplay`'s normalized
Task create/delete branches change only Task presence; they do not execute the
client's cross-model reducers. Structural snapshot validation cannot detect all
missing side effects.

Real encrypted PostgreSQL rows and the actual CLI at the starting HEAD confirmed:

- Supported `[Task Shared] addTask` with a valid `initialPlanning` returned exit
  code 0 and a new backup containing the Task **without its Planning placement**.
- Supported Task batch deletion, without a blocking WorkSession foreign key,
  returned exit code 0 and removed the Task **but left its project reference**.
- Task editing and Task patch LWW compensation failed with
  `RECOVERY_INVALID_FULL_STATE`; one-off Event creation failed similarly.
- A valid one-off Event operation followed by a complete later snapshot did
  succeed at that HEAD because replacement cleared the generic temporary map.
  That success alone does not validate replay of the Event operation.

These are supported production formats, not speculative legacy compatibility.
Fixtures used current action creators, complete disposable captured application
snapshots and real encryption. The diagnostic scripts printed only status and
boolean preservation checks, never decrypted content or keys.

| Production family                                                                                                      | Operator coverage after the safety correction                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task CRUD, movement, parent/project/tag ownership, scheduling/time edits, batch/plugin edits, archive/restore, LWW     | Snapshot records preserved; all Task tails explicitly refused pending authoritative integration.                                                                             |
| One-off Event CRUD and LWW                                                                                             | Snapshot records preserved; tails explicitly refused. Separate from EventSeries.                                                                                             |
| WorkSession                                                                                                            | Existing validated create/edit/delete/complete/reopen reducer replay retained; live Task foreign key checked. LWW remains refused.                                           |
| Folder                                                                                                                 | Existing complete singleton Add/Update/Move/Remove and complete LWW replacement retained; hierarchy and persisted Task ownership unchanged.                                  |
| Planning                                                                                                               | Existing shared `PLANNING_V1` register replay retained, including tombstones; Task creation's initial placement needs Task reducer integration.                              |
| EventSeries, OccurrenceException, WeeklyTemplate                                                                       | Existing validated client replay retained, including template ownership, terminal tombstones and durable `ROUTINES_V1`. No recurrence projections create persisted entities. |
| Project, Tag, Section, TaskRepeatCfg, IssueProvider and related models                                                 | Complete snapshots preserved. Generic tails now explicitly refused; their supported Task cascades need the client replay path.                                               |
| Note, configuration, counters/metrics, time tracking, planner/boards/menu/reminders/plugins and other generic families | Complete snapshots preserved; no generic-map success is treated as complete client recovery. Unimplemented tails refused.                                                    |
| Full-state imports and causal REPAIR                                                                                   | Existing complete-snapshot validation, sequence checks, replacement and capability retention unchanged. Markerless REPAIR remains refused.                                   |

The shared entity vocabulary also contains local genesis `MIGRATION`/`RECOVERY`
bookkeeping. Its presence in the vocabulary does not establish a server recovery
format; current SuperSync API clients do not upload those genesis rows. Unknown action formats
must not be interpreted as ordinary entity updates.

## Why reducer-only completion would be unsafe

Task behavior spans the ordered root meta-reducers (CRUD, batches, lifecycle,
scheduling, sections, ownership and integrity), feature reducers, the operation
converter and bulk archive/deletion filtering. The latter prevents LWW updates
from recreating removed Tasks and honors authenticated move footprints and
`recreatesEntityAfterDelete`. Applying only `taskReducer` or copying `changes`
would miss those semantics. Root feature names also differ from persisted keys
(for example `tasks` versus `task`).

More importantly, the existing `OperationApplierService` delegates to sync-core
with **both reducer dispatch and asynchronous archive side-effect ports**.
`ArchiveOperationHandler` handles Task archive/restore, updates/batches against
archived Tasks, and related project/tag/repeat/issue cleanup. The same Task update
format can address a live or archived record. Archive state is persisted outside
NgRx; a synchronous reducer bridge cannot reconstruct it. Full-state archive
overwrite guards also belong to that handler and cannot be replaced by an
independent interpretation.

The required follow-up is a shared, headless client-domain replay boundary that
reuses that converter, reducer ordering, batch filtering and archive mutations,
with isolated recovery storage and complete persisted/root mapping. Preserve
operation ID/client/timestamp/vector-clock metadata needed by those consumers;
the current operator row projection does not carry all of it. Domain imports
currently also reach browser platform globals (`window` fails on a direct Node
load); mocking browser globals would not supply the missing archive semantics.
This is broader than adding two isolated domain reducers. No synchronization
protocol, migration or normal client reducer was changed here.

## Safety correction and boundaries

The operator now admits only its explicit client bridges and existing Planning
semantic replay. Unimplemented operations throw `RECOVERY_UNSUPPORTED_OPERATION`
with the accepted server sequence, before writing an output. The production
server replay path is unchanged. The old simplified Task create/delete branches
remain server behavior; they are no longer an operator fallback.

This deliberately narrows apparent recovery coverage: previously successful
generic tails, including valid covered prefixes before a later snapshot, are now
refused until their replay or safe causal snapshot selection is implemented.
There is **no prefix skipping** and no assertion that covered Task/Event history
has been fixed. All retained ciphertext and sequence ranges still undergo the
existing checks; missing final/internal operations, malformed boundaries and
invalid snapshots remain failures. No release approval follows from rejection.

The old integration test that approved bare Task batch deletion is now a refusal
test, including across a causal REPAIR. The mixed Folder test now places its Task
in the complete snapshot; it continues testing Folder/session/Routines tails and
no longer claims generic Task creation is authoritative.

## Unsupported-format policy

- **Patch/partial compensation:** current conflict resolution emits Task and
  relationship patches, including authenticated move footprints and
  `clearedFields`. They are production-relevant supported client formats. Their
  lack of operator support is part of the unresolved material blocker. Do not
  relabel them as obsolete or bypass guards. Existing complete Routines/Folder
  compensation support is unchanged; Folder patch compensation has no current
  Folder producer established in this review and remains rejected.
- **Markerless REPAIR:** not necessarily obsolete. The current repair writer
  omits the base when `RepairSyncContextService` has no valid context (including
  after a blocked apply drops it). Its causal authority is unprovable by this
  operator contract, so rejection remains appropriate. Preserve incident data
  and seek a verified complete client backup; do not skip the row. This is a
  documented production-relevant limit, not approval of universal recovery.
- **Unknown/future action/schema, malformed envelopes and unsupported footprints:**
  keep explicit refusal. No invented operation format or missing data is accepted.

## Validation

All execution used generated users/keys on the existing disposable PostgreSQL
18.4 cluster at `127.0.0.1:55441`, Node 22.18.0 and disposable Chrome storage.
No production access, native launch, release/version change, push, merge, tag
or publication occurred.

- **18 focused encrypted CLI tests passed:** 12 new safety/Planning/tampering
  cases and six existing operator key/range/snapshot/refusal checks. Current
  Task/Event action creators, real PostgreSQL rows and actual CLI subprocesses
  are used; no mocked encryption/reducers. A Task prefix before a later snapshot
  remains explicitly refused. Failure paths produce no new output and do not
  log the sentinel user content or generated key.
- **Three affected encrypted Folder integration tests passed:** mixed
  Folder/session/Routines tails with snapshotted Task data; multiple replacements
  with causal REPAIR; complete and activated-empty snapshots. The full previous
  test matrices were not repeated.
- **41-operation supported encrypted CLI regression passed:** every persisted
  slice matched the source, including Folder hierarchy, normal WorkSessions,
  one-off Events and Tasks from the snapshot, and Routines tails/tombstones.
- **Actual browser restoration passed:** that supported CLI output imported via
  the retained Phase 5c V1.2 production renderer into a fresh Chrome profile.
  UI export matched all eight relevant slices and retained `ROUTINES_V1`.
  Closing Chrome, reopening the same disposable profile and exporting again
  preserved them. This is existing-subset compatibility evidence, **not** a
  successful restoration of the requested Task/Event operation-tail scenario
  and not native Windows sign-off.
- Server and focused integration-source TypeScript checks passed. Formatting,
  diff whitespace and repository-required commit checks accompany the final
  task result. No broad architecture or unrelated sync audit was performed.

Local diagnostics/artifacts are under `.tmp/phase6a2`; they contain disposable
plaintext backups/profiles and must not be committed or published. The final
task result records the safety-fix commit and worktree status. The original
Task/Event completion acceptance matrix remains outstanding; this report does
not substitute refusal tests for successful replay or claim the P1 is closed.
