# Routines Phase 6a.1 — Folder operator recovery

**Phase 6a.2 correction:** the remaining-limit statement below that every unhandled
normalized tail fails was too broad. The generic normalized Task create/delete
paths could succeed while omitting Planning or relationship changes. The operator
now rejects those paths; the mixed Folder test uses a snapshotted Task instead of
claiming Task-tail coverage. Folder/Routines/normal WorkSession support is retained.
See [Phase 6a.2](routines-phase-6a2.md). The wider recovery P1 remains unresolved.
The original Phase 6a.1 findings below are retained as historical evidence.

October 11, 2026 UTC, on `feature/v1.2-routines`, starting at
`b0575382b19cf26319fc96f0ba4cd8dab4a1d59b`. The only initial worktree change was
the uncommitted Phase 6a report; it is preserved with a follow-up status note.
Read Phase 6a and the Phase 5b.2/5b.3 recovery reports before implementation.

**Supported Folder recovery P1: resolved. Native Windows sign-off remains
incomplete; V1.2 RC1 readiness is not declared.** No version, migration, protocol,
recurrence, release, tag or production deployment change is included.

## Root cause and correction

`replayOpsToState` rejected every `FOLDER` row before the operator adapter could
interpret it. The CLI selects all retained rows through the target and replays
in accepted server sequence order, so even a valid Folder operation before a
later full-state replacement hit that guard before reaching the replacement.
Generic uppercase entity merging cannot reproduce the singleton hierarchy.

An optional operator-only bridge now validates and replays captured Folder
snapshots with the **actual client Folder reducer and `isFolderState` validator**.
Default server/HTTP replay still refuses Folder tails; a declining bridge also
fails closed. There is no server-side decryption or new live conflict negotiation.

Supported Folder formats are the current Add/Update/Move/Remove actions, all
`UPD`, entity `FOLDER`, singleton `*`, with `folderState` in the action envelope.
Whole-hierarchy `[FOLDER] LWW Update` compensation installs its complete validated
winning state through the same replacement reducer branch. Single-register batch
metadata is preserved and screened; nonempty cross-entity footprints and partial/
patch compensation are refused. Duplicates remain idempotent whole-state writes.
Hierarchy, dense order keys, IDs, Inbox, migration-completion and dismissed-project
metadata survive. The format has no Folder timestamps to invent. Task ownership
references are not rewritten, including dangling references after leaf removal,
which retain the client's effective-Inbox behavior.

The mixed-history requirement also exposed generic uppercase WorkSession output.
Normal WorkSession actions now use their existing reducer and validator, retaining
persisted timing/completion/legacy dismissal data and checking live Task references.
Pure legacy-ID functions were moved unchanged and re-exported from their original
module so recovery can load the reducer without browser globals. Existing normalized
Task creation/deletion replay now returns after handling the operation rather than
also producing a generic uppercase map. No Task command semantics were redesigned.

## Snapshot authority and failure behavior

No prefix skipping was introduced. Every retained row is vocabulary/schema checked,
every encrypted payload is authenticated/decrypted and parsed, and all sequences
are checked before replay. A valid covered Folder write can now be replayed and
then replaced by a valid later snapshot. All operations after that snapshot still
execute in accepted sequence order. Multiple boundaries use the same rule.

Every full replacement and the final export are checked for required persisted
Planstrand models, coherent normalized IDs and the existing domain predicates for
Folder, Routines, Planning and WorkSession state. Missing models are not filled
with defaults or stale pre-boundary data. Pre-Routines snapshots can omit Routines
slices. Causal REPAIR requires `repairBaseServerSeq === serverSeq - 1`, matching a
snapshot accepted against the preceding server state; markerless/stale bases fail.
The account floor, row requirements and authenticated snapshot capability evidence
survive later replacement with empty state.

Wrong/missing keys, modified ciphertext, invalid JSON, malformed Folder hierarchy,
misrouted/unknown actions, future schemas, invented batches, partial compensation,
invalid/incomplete snapshots and missing leading/internal/final operations produce
no new successful output. Logs contain no decrypted titles/state keys or passwords.
An unsupported/malformed covered prefix still fails: a later snapshot does not
authorize ignoring it. Current Task/Event/WorkSession uppercase generic output and
unsupported cross-entity footprints are refused rather than exported as a partial
normalized state.

## Validation and evidence

The real CLI runs against real encrypted rows in the disposable PostgreSQL 18.4
cluster at `127.0.0.1:55441`. Accounts, keys, outputs and browser profiles are new
and disposable; no production or personal data was accessed. The full Phase 5b
sync/upgrade/WebDAV matrix was not repeated.

- **61 focused encrypted CLI integration tests passed**: Folder boundary/tail/mixed-history cases,
  existing operator regressions and the existing Routines recovery suite.
  Includes complete/activated-empty states, multiple full snapshots and causal
  REPAIR, missing target/internal ranges, corrupt/omitted Folder boundaries,
  unsupported formats, malformed covered prefixes and snapshot-only capability
  retention without row/account evidence.
- A separate **41-operation actual CLI execution** uses the retained valid
  application-captured full snapshot, client-created Folder Add/Move/Update/Remove
  actions across two boundaries, the comprehensive Routines fixtures and client
  WorkSession create/complete actions. **Every persisted state slice matched the
  authoritative final source**, including Task/Folder ownership, stable IDs,
  one-off Event, Planning, template-owned series, exceptions and terminal tombstones.
- The recovered output imported through the existing V1.2 production renderer's
  actual backup UI in a fresh persistent Chrome profile. UI re-export matched all
  eight domain slices and retained `ROUTINES_V1`; a full Chrome process close/reopen
  and second UI export preserved them. This reuses the retained Phase 5c renderer;
  it is browser restoration evidence, not current-build native sign-off.
- **42 affected WorkSession reducer/legacy-backfill tests** and **39 server replay/
  HTTP fence tests** passed. App/server and focused integration-source TypeScript
  checks passed. Repository-required commit checks are recorded with the task
  result. Test logs and local reproduction harnesses are under `.tmp/phase6a1*`.
  Plaintext backups/profiles must not be published.

Initial runs encountered sandbox loopback restrictions, a Vite temp-cache rename
failure and ignored old emitted JS selected by the test harness. Tests were moved
to the writable disposable temp directory, authorized loopback execution and the
operator's TypeScript-source preference. Old minimal test snapshots were expanded
to structurally complete valid fixtures; an empty Folder domain correctly need
not advertise `FOLDER`. These setup corrections did not weaken production guards.

## Remaining limits

- No prefix skipping or recovery across internal gaps, even before a later snapshot.
- Markerless REPAIR, partial/patch Folder compensation, future schemas/actions,
  invented Folder CRUD/batches and unsupported multi-entity footprints remain refused.
- This focused correction does not implement every historical Task/Event action
  or WorkSession LWW compensation. Complete snapshot records are preserved; any
  unhandled normalized tail fails explicitly rather than approving a partial export.
  Incidents requiring those otherwise supported client actions remain a material
  recovery coverage gap; this phase closes the Folder-specific blocker and does
  not approve the wider recovery contract for release.
- Server HTTP recovery remains unable to decrypt data and refuses semantic Folder/
  Routines tails. Use the authorized full-checkout operator CLI.
- Native Application Control and final Windows visual/restart/DPI acceptance remain
  open. No security settings, alternate launch paths or native builds were touched.

The fix and associated documentation, including the preserved Phase 6a report,
are committed together. The final commit SHA and clean-tree status accompany the
task result. Nothing was pushed, merged, tagged, published or deployed.
