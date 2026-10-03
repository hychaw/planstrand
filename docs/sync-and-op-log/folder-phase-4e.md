# Phase 4E: canonical Task Folder ownership

## Persisted model and effective ownership

`Task.folderId?: string` is optional for old data, with no schema bump. Current
clients materialize ownership once; `projectId` remains a compatibility field.
`resolveTaskFolderId` is the authoritative effective-owner helper: an existing
valid Folder ID wins, while absent, malformed, or deleted references resolve to
`INBOX_FOLDER`. Missing references do not make Task state unreadable. Non-string
persisted values follow existing validation and repair behavior.

The two Folder selectors expose a Task's effective Folder and Tasks effectively
belonging to a Folder. Folder deletion retains stored IDs, creates no Task
operations, and never recreates the deleted Folder.

## Deterministic migration and lifecycle bridges

Missing ownership on a subtask inherits its ancestor's effective ownership,
using iterative traversal for deep chains. Missing parents and cycles fall
back to Inbox. Inbox Project maps to Inbox Folder. An ordinary existing Project
maps to `PROJECT_FOLDER:<projectId>` only when that Folder exists and its
association is not dismissed; missing or malformed Projects map to Inbox.
Existing string ownership is preserved, including stale references whose
effective owner is Inbox. Repeating migration leaves the result unchanged.

Startup defers materialization until hydration, the complete operation tail,
failed-operation retry, and Folder seeding/reconciliation have finished. The
existing quiesced snapshot/cache mechanism persists the result. Subsequent
Task replay batches reconcile after their entire suffix. Folder-only replay
does not rewrite Tasks. Backup import reconciles before durable installation.
None of these paths emits synthetic Task or Folder operations.

The central operation-capture preparation seam puts ownership directly in
current creation payloads, including batch creation. It preserves the original
dispatch identity and remembers the accepted payload for asynchronous capture.
Explicit Project moves, including short syntax and generic Task updates, map
the target through the same compatibility helper and change Project and Folder
in one Task operation. Rejected Project moves do not change ownership.
Project rename/archive/delete does not remap stored Folder ownership; Folder
rename/move does not remap Project compatibility.

Subtask creation, reparenting, conversion, restore, and replay normalize children
to the top-level Task's effective owner. Converting back to a main Task retains
ownership unless an explicit Project move also occurs. Archive storage is
unchanged: existing ownership survives archive/restore, and legacy restore
materializes deterministically.

## Semantic compatibility boundary

Current clients advertise `TASK_FOLDER_OWNERSHIP_V1` in the same increment as
these semantics. Authoritative Task ownership operations require that semantic
capability and Folder entity support through the existing requirement system.
Task replacement operations, backup envelopes, file snapshot manifests, and
snapshot uploads retain the requirement, including encrypted snapshots.
Capability enforcement is checked before destructive snapshot replacement.

A pre-4E reader that advertises only `FOLDER` is rejected; a reader with the
semantic capability succeeds. Current clients accept otherwise compatible
legacy Task operations without ownership and materialize after replay without
recapture. Explicit current ownership survives replay. This reuses the Phase 4C
and semantic-reader enforcement boundaries; clients predating those boundaries
cannot be retroactively protected by this increment.

## Focused validation

- App suites: 1,155 passed, two existing skips (1,157 total).
- Shared-schema capability suites: 16 passed across two suites.
- App and spec TypeScript checks; shared-schema build and owner formatting.
- `checkFile` for every changed app TypeScript file. Shared-schema files are
  excluded from root lint and use package-owner checks instead.
- `git diff --check`.

Coverage includes Task/Folder/Project compatibility, subtask lifecycle,
archive/restore, hydration and deferred tail migration, capture/replay, state
validation, backup/snapshot requirements, and semantic reader gates. No broad
E2E or six-shard SuperSync run belongs to this increment.

No Phase 4E implementation blocker remains. Final Phase 4 validation should
combine the Phase 4A-E focused suites with server capability enforcement and
file-provider mixed-reader regressions, then the separately scheduled full
SuperSync six-shard run and targeted startup/backup/archive smoke checks.
Folder navigation and Task drag/drop UI remain outside this increment.

## Files changed

- `docs/sync-and-op-log/README.md`
- `docs/sync-and-op-log/folder-phase-4e.md`
- `docs/sync-and-op-log/semantic-reader-capabilities.md`
- `docs/wiki/3.01-API.md`
- `packages/shared-schema/src/reader-capabilities.ts`
- `packages/shared-schema/tests/reader-capabilities.spec.ts`
- `src/app/features/tasks/store/task.selectors.ts`
- `src/app/features/tasks/task-folder-ownership.spec.ts`
- `src/app/features/tasks/task-folder-ownership.ts`
- `src/app/features/tasks/task.model.ts`
- `src/app/imex/sync/snapshot-upload.service.spec.ts`
- `src/app/imex/sync/snapshot-upload.service.ts`
- `src/app/op-log/apply/bulk-hydration.action.ts`
- `src/app/op-log/apply/bulk-hydration.meta-reducer.ts`
- `src/app/op-log/backup/backup.service.spec.ts`
- `src/app/op-log/backup/backup.service.ts`
- `src/app/op-log/backup/full-state-backup-envelope.spec.ts`
- `src/app/op-log/backup/full-state-backup-envelope.ts`
- `src/app/op-log/capture/operation-capture.meta-reducer.ts`
- `src/app/op-log/capture/operation-log.effects.spec.ts`
- `src/app/op-log/capture/operation-log.effects.ts`
- `src/app/op-log/persistence/operation-log-hydrator.service.spec.ts`
- `src/app/op-log/persistence/operation-log-hydrator.service.ts`
- `src/app/op-log/persistence/operation-log-snapshot.service.spec.ts`
- `src/app/op-log/persistence/operation-log-snapshot.service.ts`
- `src/app/op-log/sync-providers/file-based/planstrand-file-sync-adapter.service.spec.ts`
- `src/app/op-log/sync-providers/file-based/planstrand-file-transport.ts`
- `src/app/op-log/sync/build-replacement-operation.ts`
- `src/app/op-log/sync/folder-full-state-gate.spec.ts`
- `src/app/op-log/sync/folder-full-state-gate.ts`
- `src/app/op-log/sync/remote-op-block.util.ts`
- `src/app/op-log/sync/sync-capability.util.ts`
- `src/app/op-log/validation/data-repair.spec.ts`
- `src/app/root-store/meta/meta-reducer-registry.ts`
- `src/app/root-store/meta/task-folder-ownership.meta-reducer.ts`
- `src/app/root-store/meta/task-shared-meta-reducers/task-batch-update.reducer.ts`
- `src/app/root-store/meta/task-shared.actions.ts`
