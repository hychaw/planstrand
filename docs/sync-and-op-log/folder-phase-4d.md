# Project Folder association seeding (Phase 4D)

Projects provide one-time compatibility seeds, not coupled Folder entities.
Project Create remains one PROJECT operation with its unchanged action payload
and no Folder entityChanges. No Folder action is dispatched for materialization.
The generic conflict footprint remains top-level entity-type scoped; Phase 4D
does not generalize heterogeneous atomic mutations, compensation or wire shapes.

## Eligibility and independence

`ensureProjectFolderAssociations` is a pure additive function. An activated
(`legacyProjectMigrationComplete`) or meaningful Folder domain receives root
`PROJECT_FOLDER:<projectId>` seeds for referenced Projects that are neither
archived nor done, only if the Folder is absent and not dismissed. Hidden
Projects remain eligible. Inbox maps only to the reserved `INBOX_FOLDER`.

Seeds copy the current Project title once, use root parent and the fixed order
key `V`. The existing comparator breaks equal keys by Folder ID. Project list
ordering, insertion history and unrelated manual order keys cannot change the
result. Existing Folder entities retain their object identity, title, parent and
order. Renames, archive/completion/deletion, Folder movement and MenuTree changes
do not mirror across domains. A rejected/no-op Project transition does not seed.

## Deletion evidence

The Phase 4C marker prevents wholesale remigration but cannot distinguish a
never-established association from an intentionally deleted one per Project.
Folder state therefore adds one optional sorted unique list,
`dismissedProjectFolderIds`. Absent metadata defaults to an empty list. Accepted
leaf removal of a Project Folder records its deterministic Folder ID. Rejected
non-leaf removal, Inbox removal and unrelated manual deletion do not add evidence.
The list travels in the existing complete Folder snapshot/LWW boundary. No schema
bump, Project field, general tombstone system or new capability is introduced.

An existing association is always preserved even if its ID is dismissed (for
example after an explicit manual recreation). Removing it again retains dismissal.
A winning Folder snapshot that lacks an association can be reseeded; a winning
snapshot containing dismissal keeps the association absent. Evidence follows the
existing whole-hierarchy LWW winner; it is not union-merged across losing snapshots.

**Legacy ambiguity:** a deletion performed before 4D left no per-Project evidence.
A Phase 4C marker alone cannot prove that a particular missing association was
deleted. Missing never-dismissed associations are seedable on upgrade, including
such ambiguous historical deletions. This policy permits partial/manual domains
and newly eligible legacy Projects to gain associations. It cannot retrospectively
guarantee non-resurrection for pre-4D deletions. Current-client deletions record
the evidence needed to provide that guarantee while their Folder state wins LWW.

## Execution and persistence

The feature-specific meta-reducer runs after the ordinary reducers, inside bulk
operation replay and inside operation capture. Accepted Project creation and
transitions from archived/done to active reconcile the current domain. Folder
snapshot replacement (including hierarchy LWW), full-state load and the persisted
migration install also reconcile. Project rename/archive/delete do not trigger
seeding. The reducer returns projection state without altering the original
action, so capture writes exactly the original Project operation; remote/replayed
actions do not emit synthetic operations.

Startup's existing quiesced Folder snapshot bridge runs after tail replay and
failed-op retry. `materializeProjectFolders` performs the existing one-time
Project/MenuTree migration first, activates even an empty domain, then performs
additive reconciliation. It preserves snapshot source version, clocks, sequence,
validation, pending-write and cross-tab guards, and persists before installation.
Backup restore invokes the same function before its existing replacement write.
The legacy migration itself still refuses wholesale rebuilding of meaningful
manual/partial state; only missing eligible seeds are added afterward.

On an unactivated bootstrap projection, Project replay is left alone until this
authoritative migration boundary. Immediate local seeding is available after
domain activation; otherwise the next successful startup bridge establishes it.
Startup replay, retry and repeated normalization are idempotent. If persistence
fails, the bridge does not install a transient result.

## Compatibility and server reconstruction

An older pre-Folder client can understand the ordinary Project operation but
does not materialize its Folder. After upgrading it can establish missing
never-dismissed associations. Meaningful full states and user Folder operations
retain the Phase 4B/4C FOLDER gates and rollout limitations. Clients claiming
FOLDER support must understand the current optional metadata; that existing
capability is the only contract, and cannot retrofit already deployed 4B/4C
clients that reject unfamiliar Folder fields.

Server history reconstruction still refuses FOLDER-operation tails with
`FOLDER_REPLAY_UNSUPPORTED`. Project-operation tails contain no Folder mutation,
so this refusal needs no extension. A reconstructed Project-only state may lack
its derived Folder seed until current-client reconciliation. Existing meaningful
full-state Folder data remains gated. Semantic Folder history reconstruction is
deferred; server conflicts are unchanged.

## Next increment

Phase 4E should define and test explicit Task ownership migration, including
deterministic Inbox fallback when a Project Folder is missing/dismissed, full
state restore/replay consistency and mixed-version cutover. Task `folderId` and
ownership are unchanged in 4D. Historical deletion ambiguity and deployment of
the existing capability/full-state gates remain cutover considerations.

## Changed files and validation

- `src/app/features/folder/ensure-project-folder-associations.ts`
- `src/app/features/folder/ensure-project-folder-associations.spec.ts`
- `src/app/features/folder/folder-state.ts`
- `src/app/features/folder/folder.const.ts`
- `src/app/features/folder/folder.model.ts`
- `src/app/features/folder/folder.persistence.spec.ts`
- `src/app/features/folder/legacy-project-folder-migration.ts`
- `src/app/root-store/meta/project-folder-seed.meta-reducer.ts`
- `src/app/root-store/meta/meta-reducer-registry.ts`
- `src/app/op-log/backup/backup.service.ts`
- `src/app/op-log/backup/backup.service.spec.ts`
- `src/app/op-log/persistence/operation-log-snapshot.service.ts`
- `src/app/op-log/persistence/operation-log-snapshot.service.spec.ts`
- `src/app/op-log/capture/operation-log.effects.spec.ts`
- `docs/sync-and-op-log/README.md`
- `docs/sync-and-op-log/folder-phase-4c.md`
- `docs/sync-and-op-log/folder-phase-4d.md`
- `docs/wiki/3.06-User-Data.md`

Focused validation: 709 Angular/IndexedDB tests passed (two existing skips),
including Folder, Project, migration/seeding, capture/replay, hydration/retry,
snapshot persistence, backup/restore, capability and frozen-state suites.
Spec TypeScript checking and `checkFile` on every changed TypeScript file passed.
The local runtime has no npm shim, so checks used the same repository
`tools/check-file.js` entry point directly. `git diff --check` passed. No broad
E2E or SuperSync workflow ran.
