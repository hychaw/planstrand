# V1.2 RC1 final readiness

October 11, 2026 UTC. Branch `feature/v1.2-routines`; implementation tested:
`1bfd1f261423130f900c80bebf9e67a793c531f1` (matches requested HEAD).

**NO-GO: production renderer build fails; current-HEAD native smoke is blocked.**
The sole demonstrated remaining release blocker is Angular AOT error NG1010 in
`src/app/root-store/feature-stores.module.ts:56`: the imports expression
`Object.entries(FEATURE_STORE_REDUCERS).map(...)` cannot be statically evaluated.
The prior native pass at `3c7016e` does not validate this implementation revision.
No stale package was launched and no application fix was made in this scoped review.

## Accepted RC1 recovery requirement

RC1 requires verified complete backup/snapshot restoration with independent
pre-upgrade copies and a usable restore procedure. It does not promise encrypted
operation-tail reconstruction for every supported application history. This
explicit narrowing supersedes the broader recovery P1/NO-GO statements in Phase
6a and subsequent historical reports, including the untracked Phase 6a.3 report.
No additional recovery operation is required by this contract decision.

The [operator runbook](../packages/super-sync-server/docs/backup-and-recovery.md)
discloses current unsupported workflows, ambiguous historical formats, incomplete
ranges and loss risks. An unsupported retained prefix can prevent CLI recovery
even with a later snapshot. A complete independently exported backup can be
imported directly instead. With no valid backup/current copy and a refused
history, some or all data may be unrecoverable; an older restore loses later edits.
Existing authentication, validation, capability floors, causal/batch constraints,
sequence completeness and fail-closed refusals remain unchanged.

## Backup/restore usability

The [pre-upgrade procedure](v1.2-backup-restore.md) specifies the actual UI export
and import path, separate protected storage and checksum, disconnected disposable
profile, persisted-record comparison, full restart, V1.1 rollback copy and server
dump rehearsal. The UI steps agree with the existing native export/import runners.
Phase 5b.2 records executed native V1.1-to-candidate upgrades, actual BackupService/UI
round trips and file-provider/compaction snapshots, including Routines data and
capability preservation. That evidence supports the restore mechanism; it does
not establish the validity of an individual user's backup or a production dump.

A fresh native restore rehearsal for this HEAD could not run because the renderer
does not build. Complete it with disposable data after correcting the build,
including Routines, exceptions/templates, export, clean-profile import and restart.
Rehearse each real pre-upgrade backup before exposing its source profile to V1.2.

## Current build and bounded validation

Used installed Node 22.18.0, TypeScript 5.9.3 and Angular 21.2.22 on Windows,
without dependency installation or security changes. The sandbox's Volta shim
attempted an unavailable download; the already installed pinned Node was used.
TypeScript compilation and the configured tsup package builds for sync-core,
sync-providers and shared-schema passed. Electron main/preload build passed.
Server TypeScript build passed; the built CommonJS shared-schema capability
advertisement was loaded and recorded in `.tmp/rc1-final/server-capabilities.json`.

The production renderer command was
`node node_modules/@angular/cli/bin/ng.js build --configuration production`, with
`BROWSERSLIST_ENV=modern` and current revision metadata. It failed with NG1010.
An initial attempt generated `NO_VER`; the corrected attempt used the unchanged
source package version `19.1.0` and reproduced the same error. A final confirmation
after the configured tsup builds also reproduced NG1010. Generated tracked
provenance was restored afterward. Logs are local under `.tmp/rc1-final/`.
No broad or repeated test suite ran. No fresh Windows package/native pass is claimed.
No Windows/Norton settings, exclusions, certificates or protections were changed.

## Server capabilities and migration prerequisites

Current compiled shared-schema advertises `TASK_FOLDER_OWNERSHIP_V1`, `ROUTINES_V1`,
`ARCHIVE_COMMAND_V1` and `TASK_REPLAY_CONTEXT_V1`. The authenticated sync status
response exposes `capabilities.operationSync`, including full-state reader
requirements and supported entity/operation/schema ranges. Source review confirms
HTTP read/write fencing, transactional service checks and response-time reader
checks, including retained pre-snapshot requirements. Generic server Routines
replay remains refused; capability enforcement does not imply decrypting support.

All 32 migration directories are present. The final migration,
`20261010050000_durable_semantic_requirements`, adds
`user_sync_state.required_capabilities` with an empty-array default and backfills
the union from retained operations. Erased evidence cannot be reconstructed.
Phase 5b.2 already executed the full migration chain and previous-schema upgrade;
no PostgreSQL matrix was repeated here.

Before enabling V1.2 writers: verify a consistent independent dump and isolated
restore; quiesce writes/pruning and retire old server instances; use the supported
`scripts/deploy.sh` / `migrate-deploy.sh` procedure; verify applied migration and
backfilled floors; start only the enforcing server/shared-schema on every instance;
check live status capabilities and unaware-reader/writer rejection; then resume
service and distribute writers. Startup migrations default off. PostgreSQL 14 on
Linux is the documented minimum. Never drop/clear floors or roll back to an
ignoring server. Server package version `1.0.0` alone proves nothing.

No production endpoint/database was supplied or accessed. These are verified
source/build prerequisites and prior disposable migration evidence, not production
deployment certification. Production cutover checks remain deployment obligations.

Only documentation changes are committed. Existing untracked reports are left
untouched. No version change, push, merge, tag, publish or workflow dispatch.
