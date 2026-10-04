# Folder full-state compatibility and legacy cutover (Phase 4C)

Folder remains the Phase 4B normalized hierarchy-wide `FOLDER:*` snapshot/LWW
boundary. Phase 4C adds reader fences and a local migration seed. It does not
change Task ownership, remove Projects/MenuTree, add Folder UI, or continuously
mirror legacy edits.

## Meaningful state and reader requirements

The shared `hasMeaningfulFolderState` predicate treats an absent Folder slice,
or exactly the deterministic Inbox bootstrap, as compatible with legacy readers.
Bootstrap is one `INBOX_FOLDER` entity titled `Inbox`, with root/absent parent and
`V`/absent orderKey, and no additional state/entity fields. Every other present
Folder slice requires `FOLDER`: another entity, a nondefault Inbox/order, malformed
shape, or the durable `legacyProjectMigrationComplete` marker. The marker matters
even after all migrated folders are deleted: losing it would resurrect Projects.
Validation still rejects invalid hierarchies and Inbox-title mutations; compatibility
screening is deliberately more conservative than validation.

Full-state wire operations/snapshot requests carry optional `requiredEntityTypes`.
Current meaningful Folder snapshots declare `['FOLDER']` before encryption.
Schema version stays 5; capability requirements are separate from schema migrations.
The compact local codec preserves requirements. Raw reader checks happen before
schema conversion, repair, archive writes or application; checks after decryption
also infer requirements from raw plaintext if metadata was missing.

## Writer/provider/reader paths

| Path                                                               | Writer and provider                                                                                                                                     | Reader fence                                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync import, backup import, repair, force upload, server migration | `OperationLogUploadService` routes full-state operations to snapshot upload; requirements computed before encryption                                    | Server HTTP gates, raw remote-op block predicate, `verifyDecryptedOpIntegrity`, and `SyncHydrationService` before migration/apply                     |
| Encryption rotation / direct pre-upload snapshot                   | `SnapshotUploadService` checks server capabilities before deleting remote data; retry carries the same requirements with ciphertext                     | Same server and client fences                                                                                                                         |
| SuperSync full-state skip optimization / piggyback                 | Provider preserves operation requirements and advertises shared `ENTITY_TYPES` on every HTTP request                                                    | Route pre-handler gates the causal full-state boundary; response serialization gates returned operations again to close the read race                 |
| Server history restore / generated snapshot                        | Existing full-state replay retains every raw model slice                                                                                                | Response gate infers raw Folder requirements; generic reconstruction refuses any Folder-operation tail because it cannot reproduce hierarchy-wide LWW |
| File snapshot upload, repair, optimization and password rotation   | Existing Planstrand manifest uses `ENTITY:FOLDER` only for meaningful raw full state or retained Folder operations; requirement union survives rewrites | Existing physical-prefix/manifest check occurs before decode/decryption/apply, plus raw client hydration checks                                       |
| Downloaded JSON / privacy export, Electron / Android / iOS backups | Meaningful data uses `{ requiredEntityTypes, appDataComplete }` inside the existing backup data slot (or at the native raw root)                        | Current import checks requirements before unwrap; previous root-model importers see no repairable core roots and refuse instead of stripping Folder   |
| Local recovery slots / persisted startup snapshot                  | Typed snapshot storage preserves Folder including marker                                                                                                | Current validation before hydrate; local slots are not a cross-client delivery mechanism                                                              |

Default/absent Folder exports stay in their legacy raw form. Native backup summaries,
availability checks, shrink guards and sync-config checks unwrap supported envelopes.
There is no dependency or persisted-state schema-version bump. The server adds a
optional wire field backed by a default-empty SQL array on
operations; deploy the included database migration before updated server binaries.

## SuperSync acceptance and limitations

The existing `/status` operation capability contract advertises optional
`fullStateReaderRequirements: true`. Current clients refuse meaningful Folder
snapshots unless the server advertises this enforcement. Readers advertise
`supportedEntityTypes` using the same shared entity vocabulary. Missing advertisements
support no declared extensions. HTTP 409 `FULL_STATE_READER_UNSUPPORTED` returns
neither payload nor cursor. The same pre-handler fences downloads, uploads,
snapshot replacement, delete/reset and restore routes against the current causal
full-state boundary, preventing a known unsupported peer from re-uploading reduced
state. Response screening also handles piggyback and concurrent replacement.

At the client, requirements are checked before dedup/local-clock coverage or forced
scan checkpoints. An incompatible full state is handed only to the existing blocking
processor, with snapshot/prefix application discarded; the ordinary blocked outcome
keeps the persisted server cursor and acknowledgements pending. No partial full-state
application occurs. File and SuperSync use the same meaningful-state predicate,
with their existing manifest/HTTP delivery contracts respectively.

This cannot retrofit arbitrary older SuperSync servers or opaque, undeclared
ciphertext from old writers. Reader advertisements are trusted capability claims.
The HTTP ingress check is not a transactional writer-admission lock: a request
already admitted before a new boundary commits is not universally fenced. Server
response checks close the _read_ race, not every old-writer race. Deploy enforcing
server instances consistently before allowing Folder-bearing full states; do not
claim safety for arbitrary unmodified old writers or unsupported servers. Operation
Folder sync retains the Phase 4B entity capability gate. Server reconstruction of a
Folder-operation tail is explicitly refused (`FOLDER_REPLAY_UNSUPPORTED`); clients
can replay retained operations or use an uploaded full snapshot instead.

## Deterministic one-time migration

`migrateLegacyProjectFolders` is a pure, iterative seed:

- `INBOX_PROJECT` maps exactly to `INBOX_FOLDER`, retaining its reserved deterministic
  title/root even if a malformed or customized legacy Inbox title differs.
- Other active Project IDs map injectively to `PROJECT_FOLDER:<original ID>`.
  IDs are recognizable without random generation or hashing; prefixes are separate
  from Inbox and MenuTree Folder identities.
- Active means a referenced entity in the explicit persisted `Project.ids` list,
  neither archived nor done. Hidden active Projects still migrate. Archived/done
  Projects, deleted/missing references, Tags and unrelated tree nodes do not.
- Projects are MenuTree leaves, not Project parents. Real named MenuTree Folder
  grouping nodes map to `MENU_FOLDER:<original ID>` and preserve arbitrary depth.
  No synthetic placeholder folders are made. A missing/malformed/ambiguous parent
  makes descendants root-level; duplicate Project placements fall back to root.
  Duplicate grouping identities are omitted; repeated object references cannot loop.
- Traverse the explicit projectTree arrays in depth-first order; valid sibling
  placement order is retained. Unplaced/ambiguous Projects follow `Project.ids`
  order at root after tree placements. Inbox starts root order at `V`; subsequent
  sibling keys use the existing dense order generator. Final `ids` sort lexically.
  Entity-object enumeration is not an ordering source.
- Non-Inbox titles copy Project titles once at cutover; grouping titles copy their
  MenuTree names. Later Project/MenuTree changes never mirror into Folder.

The seed may populate only absent/default Inbox-only Folder state without a marker.
Any meaningful existing state wins as a whole: partial migrated IDs, manual folders,
renames, moves and deletions are never filled/reordered/rebuilt. Such state receives
only the marker. A marker returns the identical state reference on future runs.
Identity/presence alone is insufficient: deleting every migrated folder reproduces
bootstrap, so the optional literal-true marker is necessary to prevent resurrection.
An entirely empty legacy source retains bootstrap without marking a cutover.

Projects, Tags, Sections, Tasks and their ownership are unchanged. Project deletion
does not delete Folder. [Phase 4D](./folder-phase-4d.md) adds seed-only association
materialization after creation/activation without Project-driven user Folder
operations. Explicit Task-to-Folder migration remains deferred.

## Startup, restore and persistence

Hydration validates/defaults Folder and finishes retained operation replay and
failed-remote-op retry first. Only successful hydration invokes the existing
quiesced snapshot transaction for Folder backfill, before the existing WorkSession
backfill. Existing pending-write, cross-tab and source-anchor guards remain in force.
The resulting full state validates and persists before the nonpersistent install
action updates NgRx; failures do not install a transient projection. Clock, sequence
and legacy source schema version are retained. No user-intent operation fan-out is
created. The marker is normal persisted/synchronized Folder-domain state.

Backup import checks compatibility before conversion/repair, then validates the
legacy source and seeds before its existing atomic replacement. An old backup with
no Folder seeds deterministically; a current meaningful backup wins. Repeated
restore/startup is stable. Real IndexedDB tests cover persisted seed, rehydration,
intentional delete-all and absence of synthetic operations; pure tests cover malformed
hierarchy fallback and byte-equivalent independent migrations.

## Phase 4D prerequisites

Before Task canonical ownership: decide Folder association for Projects created or
activated after cutover, and for partial/manual canonical Folder domains; define the
explicit Task migration and Inbox/default fallback without continuous dual writes.
Roll out the SQL migration and enforcing SuperSync server first. Supporting server
history restore across Folder edits requires semantic hierarchy-LWW replay (or a
client replay restore path), not generic entity reconstruction. Phase 4C stops here.

## Validation and change inventory

Focused validation passed: 1,397 Angular/IndexedDB tests, 215 server tests,
119 provider transport tests, 57 shared contract tests, and 3 sync-core tests
(1,791 total). Builds/type checks passed for the app, Electron, shared-schema,
sync-core, sync-providers, and server; Prisma generation validated the database
model. Every changed TypeScript file was submitted to repository `checkFile`;
root-covered files passed. Intentionally excluded shared-schema/server files
passed package build/tests and Prettier checks instead. `git diff --check` passed.
No regular E2E or six-shard SuperSync workflow was run.

Changed files (77):

- `docs/sync-and-op-log/README.md`
- `docs/sync-and-op-log/folder-phase-4c.md`
- `docs/wiki/3.06-User-Data.md`
- `electron/backup.ts`
- `electron/electronAPI.d.ts`
- `packages/shared-schema/src/full-state-capabilities.ts`
- `packages/shared-schema/src/index.ts`
- `packages/shared-schema/src/supersync-http-contract.ts`
- `packages/shared-schema/tests/full-state-capabilities.spec.ts`
- `packages/super-sync-server/prisma/migrations/20261003000000_full_state_reader_requirements/migration.sql`
- `packages/super-sync-server/prisma/schema.prisma`
- `packages/super-sync-server/src/sync/conflict.ts`
- `packages/super-sync-server/src/sync/full-state-reader-gate.ts`
- `packages/super-sync-server/src/sync/op-replay.ts`
- `packages/super-sync-server/src/sync/services/operation-download.service.ts`
- `packages/super-sync-server/src/sync/services/operation-upload.service.ts`
- `packages/super-sync-server/src/sync/services/request-deduplication.service.ts`
- `packages/super-sync-server/src/sync/sync.routes.snapshot-handler.ts`
- `packages/super-sync-server/src/sync/sync.routes.ts`
- `packages/super-sync-server/src/sync/sync.types.ts`
- `packages/super-sync-server/tests/e2ee-upload-gate.routes.spec.ts`
- `packages/super-sync-server/tests/full-state-reader.routes.spec.ts`
- `packages/super-sync-server/tests/op-replay.spec.ts`
- `packages/super-sync-server/tests/operation-download.service.spec.ts`
- `packages/super-sync-server/tests/request-dedup-failure-caching.routes.spec.ts`
- `packages/super-sync-server/tests/sync-compressed-body.routes.spec.ts`
- `packages/super-sync-server/tests/sync-upload-rate-limit.routes.spec.ts`
- `packages/sync-core/src/operation.types.ts`
- `packages/sync-providers/src/provider-types.ts`
- `packages/sync-providers/src/super-sync/super-sync.model.ts`
- `packages/sync-providers/src/super-sync/super-sync.ts`
- `packages/sync-providers/tests/super-sync/super-sync.spec.ts`
- `src/app/features/folder/folder-state.ts`
- `src/app/features/folder/folder.model.ts`
- `src/app/features/folder/folder.persistence.spec.ts`
- `src/app/features/folder/legacy-project-folder-migration.spec.ts`
- `src/app/features/folder/legacy-project-folder-migration.ts`
- `src/app/features/folder/store/folder.actions.ts`
- `src/app/features/folder/store/folder.reducer.ts`
- `src/app/imex/file-imex/file-imex.component.ts`
- `src/app/imex/local-backup/backup-ring.util.ts`
- `src/app/imex/local-backup/local-backup.service.ts`
- `src/app/imex/sync/snapshot-upload.service.spec.ts`
- `src/app/imex/sync/snapshot-upload.service.ts`
- `src/app/op-log/backup/backup.service.spec.ts`
- `src/app/op-log/backup/backup.service.ts`
- `src/app/op-log/backup/full-state-backup-envelope.spec.ts`
- `src/app/op-log/backup/full-state-backup-envelope.ts`
- `src/app/op-log/core/types/sync.types.ts`
- `src/app/op-log/persistence/compact/compact-operation.types.ts`
- `src/app/op-log/persistence/compact/operation-codec.service.ts`
- `src/app/op-log/persistence/operation-log-hydrator.failed-op-boot.integration.spec.ts`
- `src/app/op-log/persistence/operation-log-hydrator.retry.integration.spec.ts`
- `src/app/op-log/persistence/operation-log-hydrator.service.spec.ts`
- `src/app/op-log/persistence/operation-log-hydrator.service.ts`
- `src/app/op-log/persistence/operation-log-snapshot.service.spec.ts`
- `src/app/op-log/persistence/operation-log-snapshot.service.ts`
- `src/app/op-log/persistence/sync-hydration.service.ts`
- `src/app/op-log/sync-providers/file-based/planstrand-file-protocol.ts`
- `src/app/op-log/sync-providers/file-based/planstrand-file-sync-adapter.service.spec.ts`
- `src/app/op-log/sync-providers/file-based/planstrand-file-transport.ts`
- `src/app/op-log/sync-providers/super-sync/super-sync.ts`
- `src/app/op-log/sync/folder-full-state-gate.spec.ts`
- `src/app/op-log/sync/folder-full-state-gate.ts`
- `src/app/op-log/sync/operation-log-download.service.spec.ts`
- `src/app/op-log/sync/operation-log-download.service.ts`
- `src/app/op-log/sync/operation-log-upload.service.spec.ts`
- `src/app/op-log/sync/operation-log-upload.service.ts`
- `src/app/op-log/sync/operation-sync.util.spec.ts`
- `src/app/op-log/sync/operation-sync.util.ts`
- `src/app/op-log/sync/remote-op-block.util.ts`
- `src/app/op-log/sync/remote-ops-processing.service.spec.ts`
- `src/app/op-log/sync/sync-capability-gate.service.spec.ts`
- `src/app/op-log/sync/sync-capability-gate.service.ts`
- `src/app/op-log/sync/sync-capability.util.spec.ts`
- `src/app/op-log/sync/sync-capability.util.ts`
- `src/app/op-log/sync/verify-decrypted-op-integrity.ts`
