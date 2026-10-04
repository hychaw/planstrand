# Phase 4 final audit

Validation date: 2026-10-03; audit finalized 2026-10-04. Scope: final validation and merge assessment only;
no Folder UI, Phase 5, or product-code changes.

## Repository and validated revision

- Branch: `feature/phase-4-folder-domain`.
- Starting clean HEAD: `46d7af339cdd17524f12471283db8188398fe2e1`.
- Validation/CI revision: `b78dc1dbf9b665316de83cd94fed366d71a456d3`.
- Fetched `development` and `origin/development`:
  `625fc45c3` (Phase 3 merge), the feature's ancestor. No intervening delta,
  rebase, merge, or cosmetic refresh was needed.
- Phase 4 commits: `ed0773222`, `d281130d2`, `4dfb7f4d4`, `ea4d28e9e`,
  `46d7af339`. Final validation corrects obsolete test fixtures, adds one
  IndexedDB lifecycle smoke, and updates the stale architecture-index sentence.
  Production behavior is unchanged by the validation commits (`f5fe21d6a`,
  `a88e14b24`, `b78dc1dbf`). The second aligns direct current-client E2E probes with the
  reader advertisements and matches query-bearing fault-injection URLs; legacy
  and negative compatibility tests remain unchanged. The third unwraps protected
  backup envelopes in two archive E2E readers; every archive assertion is retained.
- The temporary detached development worktree was removed after comparison.

## Architecture and supported contract

Folder state is a normalized `{ ids, entities }` hierarchy. A Folder contains
`id`, `title`, optional `parentId` (root default), and optional `orderKey`
(default `V`). Parent links define ancestry; iterative validation prevents cycles.
Sibling order is dense `orderKey`, then lexical Folder ID. Identity enumeration
is separate from sibling order. Inbox is the reserved immutable `INBOX_FOLDER`;
`INBOX_PROJECT` maps exactly to it. Folder removal is leaf-only.

Project and MenuTree legacy identities migrate deterministically to
`PROJECT_FOLDER:<projectId>` and `MENU_FOLDER:<id>`. Titles seed once; there is
no permanent Project/Folder mirroring. The completion marker prevents wholesale
remigration. Eligible new/reactivated Projects gain missing associations;
`dismissedProjectFolderIds` records deliberate Project Folder deletion and
prevents reseeding while that Folder snapshot wins.

`Task.folderId?: string` is persisted canonical ownership. A valid existing
Folder wins; missing, invalid, or deleted references have effective Inbox
ownership. Folder removal leaves raw Task references intact and emits no Task
rewrite fan-out. Legacy missing ownership materializes after complete startup
replay/retry and Folder reconciliation, persists before installation, and emits
no synthetic user operations. Project moves bridge `projectId` and ownership in
one Task operation. Projects, MenuTree, and `projectId` remain compatibility
surfaces. Subtasks inherit their top-level parent's effective ownership;
archive/restore preserves current ownership and materializes legacy ownership.

The entire Folder hierarchy uses one `FOLDER:*` LWW conflict boundary. A losing
snapshot can lose concurrent unrelated Folder edits and dismissal evidence;
this is intentional. There is no heterogeneous conflict redesign.

Entity support and semantic support are separate. Current readers advertise
`TASK_FOLDER_OWNERSHIP_V1`; authoritative ownership operations and ownership-bearing
full states/backups declare that requirement alongside Folder support. Folder-only,
missing-advertisement, and unknown-capability readers are rejected. Compatible
legacy Task operations remain readable. File manifests, compaction, encrypted
wrappers, operation metadata, and full-state responses preserve requirements.
Incompatible data is blocked before destructive apply or cursor advancement.

Detailed contracts remain in the [Phase 4B model and sync decisions](IMPLEMENTATION_PLAN.md#folder),
[Phase 4C](sync-and-op-log/folder-phase-4c.md),
[Phase 4D](sync-and-op-log/folder-phase-4d.md),
[Phase 4E](sync-and-op-log/folder-phase-4e.md), and
[semantic reader contract](sync-and-op-log/semantic-reader-capabilities.md).

## Local validation

| Combined focused selection                                 | Suites |    Passed | Failed | Skipped |
| ---------------------------------------------------------- | -----: | --------: | -----: | ------: |
| App/domain/replay/backup/file-provider contracts           |     45 |     1,571 |      0 |       0 |
| Shared-schema full-state and semantic reader contracts     |      2 |        16 |      0 |       0 |
| SuperSync provider contract                                |      1 |       119 |      0 |       0 |
| Server changed contracts plus device-version route fixture |     12 |       278 |      0 |       0 |
| **Combined**                                               | **60** | **1,984** |  **0** |   **0** |

The app selection covers Folder reducers, cycles/order, Project/MenuTree migration,
seeding/dismissal, Task creation/moves/subtasks/archive, hydration/IndexedDB tail
replay, capture/replay, LWW persistence, validation/repair, frozen-state compatibility,
backup envelopes, full-state/file capability gates, and transport metadata.
The server selection includes reader routes and real PostgreSQL subset/migration
semantics through PGlite. Each suite runs once in the final combined selection;
no redundant timezone permutations were added.

Smoke evidence:

- Fresh Project/Task creation, raw canonical ownership, fresh IndexedDB readers,
  deletion without Task rewrites, effective Inbox fallback, dismissal, and a
  stable second restart are one integrated test in `task-folder-ownership.spec.ts`.
- Legacy hierarchy/ownership idempotence, restart, no synthetic operations,
  complete-tail ordering and durable save-before-install are covered by Folder
  persistence, Task ownership, capture, hydrator, and snapshot suites.
- Legacy/current backup restore, explicit ownership, and preserved Projects,
  Tags and Sections are covered by `backup.service.spec.ts` and envelope tests.
- Folder-only/current/missing/unknown advertisements, compatible legacy Task
  operations, and rejection before apply/cursor advancement are covered by
  app, shared-schema, file-provider, and server reader suites.

Static/build evidence:

- `checkFile`: all root-covered Phase 4 TypeScript files passed, including all
  13 final E2E fixture files. Excluded
  shared-schema/server files use owner formatting, build/typechecks and tests.
- App/spec/Electron TypeScript and sync-core/provider spec typechecks passed.
- sync-core, shared-schema, sync-providers package builds, server emitted build,
  and Angular development frontend build passed.
- Prisma generation and schema validation passed; both SQL migrations apply in a PGlite smoke with empty-array defaults verified on existing and new rows. Prisma formatting check
  reports a pre-existing warning on both feature and development schema files;
  unrelated historical schema formatting was left intact.
- Complete changed-file Prettier check and `git diff --check` passed.
- Local host: Node 24.19.0, Chrome Headless 154, Windows; app timezone
  `Europe/Berlin`. Linux/Node 22 CI is separately recorded below.

## Broad local baseline comparison

Feature: 16,832 passed, 35 failed, 20 skipped (16,887 total).
Development: 16,655 passed, 35 failed, 20 skipped (16,710 total).
The exact failing suite/test identities match; **zero new app failures remain**.

| Failure group                    | Development reproduction | Phase 4 introduced? | Contract / blocker                   | Rationale                                                                                 |
| -------------------------------- | ------------------------ | ------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Board panel mocks (27)           | All 27 exact tests       | No                  | Historical; no Phase 4 blocker       | Store mock lacks `selectSignal` used by Phase 3 WorkSession dependency.                   |
| Archive conflict recovery (4)    | All 4 exact tests        | No                  | Historical; no Phase 4 blocker       | Same recovery-spy assertions fail on both revisions.                                      |
| Hydration/compaction fixture (1) | Same exact test          | No                  | Historical; no Phase 4 blocker       | Same missing fixture seam / compaction assertion.                                         |
| CalDAV fixture (1)               | Same exact test          | No                  | Historical; no Phase 4 blocker       | Same expectation failure.                                                                 |
| Timezone diagnostics (2)         | Both exact tests         | No remaining delta  | Host/environment; no Phase 4 blocker | Final feature and baseline failure identities match; no timezone production code changed. |

Initial validation also exposed obsolete Phase 4 fixtures: three semantic rejection
expectations, the enum count (154 vs 158), canonical entity casing in 32 file tests,
and three device-version route tests missing the new empty-history reader-query
stub. Their corrections preserve all assertions and the unknown-capability/name
gates. No tests were skipped or production gates weakened.

A broad Windows server run initially had 182 failures across five suites.
Development reproduced the shell/legal failures; all 14 development device tests
passed. Updating only the Phase 4 reader-query fixture makes all 14 feature device
tests pass. Linux server CI is the authoritative broad server result below;
Windows shell failures are not used as evidence of server contract regressions.

Broad owner suites also pass locally: sync-core 273, shared-schema 146,
sync-providers 455 (**874 passed** combined).

## Final GitHub Actions evidence

Both final workflows tested `b78dc1dbf9b665316de83cd94fed366d71a456d3`:
[Scheduled E2E 37155540801](https://github.com/hychaw/planstrand/actions/runs/37155540801)
and [CI 37155542471](https://github.com/hychaw/planstrand/actions/runs/37155542471).
All jobs are complete. Their overall failure status is classified below.

| Final job                 |  Passed | Failed | Skipped / not run     | Result                                    |
| ------------------------- | ------: | -----: | --------------------- | ----------------------------------------- |
| SuperSync 1/6             |      57 |      0 | 0                     | Success                                   |
| SuperSync 2/6             |      57 |      0 | 0                     | Success                                   |
| SuperSync 3/6             |      51 |      0 | 6 existing skips      | Success                                   |
| SuperSync 4/6             |      53 |      0 | 4 existing skips      | Success                                   |
| SuperSync 5/6             |      53 |      0 | 3 existing skips      | Success                                   |
| SuperSync 6/6             |      55 |      0 | 1 existing skip       | Success                                   |
| **SuperSync combined**    | **326** |  **0** | **14 existing skips** | **All six success**                       |
| Server unit               |   1,391 |      0 | 48 existing skips     | 65 suites passed, 8 skipped               |
| Regular E2E               |     401 |     23 | 2 existing skips      | All 23 failures reproduced on development |
| WebDAV v2                 |      39 |     22 | 11 not run            | Identical baseline failure set and counts |
| Released current/released |       0 |      3 | 8 not run             | Identical baseline failure identities     |
| Released upgrade (#9962)  |       0 |      2 | 0                     | Identical baseline failure identities     |

Frontend build and production build/Lighthouse passed. CI Lint fails on two
historical tooling tests; downstream CI Tests did not execute. No workflow or
skip was changed. Shared-schema and app contract evidence is local, not a claim
that the skipped CI job passed.

The fair [development baseline 37153757477](https://github.com/hychaw/planstrand/actions/runs/37153757477)
used the same normal inputs at `625fc45c3550ded2e73b8cc7d9fbbe6b0bfbe0b9`.
All six SuperSync shards passed with the same 326/14 result. Regular E2E had
400 passed, 24 failed, 2 skipped. The final feature's 23 failure identities are
a subset of those 24, with **zero new identities**. The baseline-only case is
`add-to-today.spec.ts`: "should add subtask to Today when parent is NOT in Today";
its feature pass is not attributed to a Phase 4 product fix. All six corrected
archive export/persistence/subtask tests ran without failure on the final SHA.
WebDAV reproduced all 22 failures and 11 not-run tests; Released Clients
reproduced all five failures and eight not-run tests.

Earlier candidates: [E2E 37152720395](https://github.com/hychaw/planstrand/actions/runs/37152720395)
and [CI 37152722084](https://github.com/hychaw/planstrand/actions/runs/37152722084)
at `f5fe21d6a`, then [E2E 37154617135](https://github.com/hychaw/planstrand/actions/runs/37154617135)
and [CI 37154619316](https://github.com/hychaw/planstrand/actions/runs/37154619316)
at `a88e14b24`. Each repeat followed a validation-fixture code commit. The final
audit-only commit does not change the tested runtime or tests and needs no CI rerun.

## CI failure classification

| Test/job                                       | Failure                                                                                  | Development reproduced?                                   | Phase 4 introduced?                        | Contract/limit                                     | Blocker            | Rationale                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| CI Lint: Windows Store config / artifact tools | Two ENOENT failures: missing `build-create-windows-store-on-release.yml` and `build.yml` | Yes, both exact failures locally                          | No                                         | Historical tooling                                 | No                 | Files and assertions are unchanged; baseline also cannot read them.                                                                     |
| CI Tests                                       | Skipped after Lint failed                                                                | Underlying Lint failures reproduced; dependency unchanged | No                                         | Existing CI evidence gap                           | No Phase 4 blocker | Local contracts, broad baseline comparison, scheduled server and browser jobs provide separate evidence; this job is not claimed green. |
| Regular E2E                                    | 23 UI/calendar/reminder/planner/search/drag assertions                                   | Yes, all 23 exact identities within the baseline's 24     | No                                         | Historical supported-feature validation failures   | No                 | Six Phase 4 envelope-reader failures are corrected and passed; no new failing identity remains.                                         |
| WebDAV v2                                      | 22 format/namespace/UI assertions; 11 not run                                            | Yes, same 22 identities and counts                        | No                                         | Historical provider validation                     | No                 | Same normal inputs and baseline SHA; no upstream fixes or skips added.                                                                  |
| Released current/released                      | Three setup/sync timeouts; eight not run                                                 | Yes, all three exact failures                             | Additional reader rejection is intentional | Unaware readers cannot consume canonical ownership | No                 | Feature logs show `FULL_STATE_READER_UNSUPPORTED`, as required; baseline already fails these scenarios.                                 |
| Released upgrade (#9962), two cases            | Expected one old snapshot; history empty                                                 | Yes, both exact cases                                     | No                                         | Historical legacy upload schema gate               | No                 | Both revisions reject old live uploads with `INVALID_SCHEMA_VERSION`.                                                                   |

The initial 15 SuperSync failures were validation fixtures: direct current-reader
probes omitted advertisements, and fault-injection routes missed query-bearing
URLs. All six shards passed on development. Corrections retain all assertions.
The six additional archive UI tests stopped at raw-export paths; the protected
payload already contained archive state. Their readers now unwrap the envelope,
retaining the persistence, time tracking, count and subtask relationship checks.
Final corrected-revision results are recorded above; no CI skip was introduced.

## Deployment prerequisites and remaining limitations

Deploy the compatible enforcing SuperSync binary together with
`20261003000000_full_state_reader_requirements` and
`20261003010000_semantic_reader_requirements` SQL migrations before enabling
ownership writers. Arbitrary old servers cannot enforce capabilities they do
not understand. Reader advertisements are trusted claims; response screening
closes delivery races but ingress admission is not a universal transactional
lock. Previously shipped manual backup importers cannot be retrofitted.

Pre-4D deletion history can be ambiguous and a missing never-dismissed association
may seed on upgrade. Whole-hierarchy LWW intentionally loses losing snapshot edits.
Server semantic Folder-operation reconstruction remains deferred and refuses
Folder tails with `FOLDER_REPLAY_UNSUPPORTED`; client reconciliation handles
Project-only derived seeds. File-provider atomicity remains provider-specific
(conditional writes where supported; documented best-effort LocalFile behavior).
Folder UI and independent subtask placement are outside Phase 4.

## Merge assessment

**Phase 4 ready for final merge review.** No Phase-4-introduced supported-contract
regression remains in the completed evidence. Historical red jobs and the skipped
downstream CI Tests gap remain visible above. Deployment prerequisites and documented
limitations still apply. No merge, Folder UI, or subsequent-phase work was performed.
