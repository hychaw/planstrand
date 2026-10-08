# Planstrand V1.1 product version and reset compatibility audit

Baseline: `526d9b156353dc9de6dc39b159d40b99fcf4a25f` on `feature/v1.1-blue-thread`, verified clean.

## Product identity

`planstrand-product.json` is the single source of the unreleased product version, `1.1.0-rc.1`. No final-release bump is made.

`getAppVersionStr()` now reports that product version. Settings, About, recovery/error diagnostics and feedback therefore no longer identify Planstrand as `19.1.0W`. The old display combined the inherited `package.json` version `19.1.0` with the Windows NSIS distribution marker `W`.

About presents Planstrand, its product version, an optional seven-character Git revision, the product description, repository and Help. Genuine Super Productivity authorship, the upstream MIT license and dependency licenses remain in the acknowledgements section. Settings uses the same product version and optional revision tooltip. Missing revisions, including `NO_REV`/`NO_BRANCH`, are omitted.

The existing build generator still records internal package metadata and the actual Git revision. The source package version, `environment.version`, `getAppSemver()` compatibility reporting and schema 5 remain unchanged. Plugin infrastructure and package ecosystem assumptions are not version-bumped.

`electron-builder.yaml` inherits `tools/planstrand-product-build.cjs`, which reads the same product file and overrides only packaged application metadata. Electron's runtime application version and installer semantic version become `1.1.0-rc.1`; Windows' numeric executable file/product/build version is `1.1.0.0`. Source npm metadata remains `19.1.0`. The PWA manifest already identifies Planstrand and has no version field; its browser UI uses the shared product version. Window/app/tray branding and icons remain unchanged.

The Planstrand GitHub update check now compares against the product version rather than `19.1.0`. It recognizes a future final `v1.1.0` as newer than the current RC. Publishing remains disabled in desktop packaging; no release, tag or merge is performed.

## Reset is stopped at the requested compatibility boundary

**No Reset task data command or dialog is exposed, and no user data is deleted.** The requested safety/atomicity guarantees cannot be represented by an existing durable deletion command. Implementing a new reset wire contract without first resolving compatibility would violate the explicit instruction to stop at this boundary.

Evidence from the current implementation:

- `TaskSharedActions.deleteTasks` is one existing bulk TASK delete operation. Its CRUD meta-reducer removes Tasks/subtasks and prunes project/tag lists; the section meta-reducer prunes section references. It does not atomically remove Folders, WorkSessions and canonical Planning.
- `workSessionIntegrityMetaReducer` explicitly rejects Task deletion/archival while owned WorkSessions exist. Its regression test asserts `Remove WorkSessions before deleting or archiving their Task`. Removing sessions first would emit separate per-session operations and expose partial progress/failure.
- WorkSession removal is a separate per-entity durable action. Folder changes are singleton `FOLDER/*` snapshot updates; normal Folder removal is leaf-only. Neither command is a task-workspace bulk reset.
- Canonical Planning uses dedicated versioned placement/tombstone operations. The existing Task bulk delete is not a complete Planning reset contract.
- Archived Tasks reside in young/old archive stores. `TaskArchiveService._deleteTasks` saves the affected archives separately, and `ArchiveOperationHandlerEffects` performs these asynchronous writes outside the synchronous root reducer. A loop of normal deletes cannot promise all-or-nothing live/archive mutation.
- `MultiEntityPayload.entityChanges` is not a general executable transaction language. `convertOpToAction` reconstructs the known action from `actionPayload`; receivers rely on that action's reducer to apply the transition. Adding a reset flag to an old delete action would not make older clients remove its other domains, and their WorkSession guard can reject it.
- `bulkApplyOperations` is a remote/hydration dispatch envelope, not a locally captured durable batch command. Its atomic replay groups represent schema-migration expansion of an existing operation; they are not a new authorable sync transaction.
- Full-state imports replace the application state and establish import conflict/history boundaries. Reusing an import to delete task data would risk replacing unrelated peer Events/settings and concurrent edits. It is not a scoped deletion/tombstone command.

A safe implementation needs an explicitly supported reset command/receiver contract with a cross-domain deletion footprint and durable failure recovery for archive writes. It must cover active/completed/archived Tasks, all descendants and task-owned metadata/references, user Folders (including migrated Project associations so startup cannot reseed them), Planning and WorkSessions. It also needs conflict/replay tests proving that deleted entities are not resurrected and no remote effects emit new local operations. Schema 5 may be retainable, but that cannot be assumed to make older action receivers compatible.

Inbox, standalone Events, Settings/theme/density/background/calendar/sync/backup preferences, existing backup files, branding and legal data must remain intact in that future implementation. The requested RESET confirmation, Cancel, danger section, post-reset navigation and success/failure handling remain unimplemented because exposing an unsafe or nonfunctional destructive control would be misleading.

No IndexedDB/local-storage wipe, fan-out deletion, full-state import, new operation type, schema migration or altered deletion semantics was introduced.

## Validation

- 368 targeted unit tests passed: version/build fallback, rendered About/attribution, update checks (including RC-to-final), Settings, Planstrand, Folder, Planning, WorkSession integrity/persistence and operation conversion.
- App/spec TypeScript checks passed. Product packaging configuration integration test passed.
- Formatting and full repository lint passed, including TypeScript/SCSS/CSS variables, lint-rule, tool and icon checks.
- Production frontend build, Electron build and Windows unpacked package passed. The existing initial bundle-budget warning remains (5.57 MB against 5.50 MB).
- Actual packaged Electron verification passed in an isolated profile: `app.getVersion()` reports `1.1.0-rc.1`; Settings/About show the product version and `Build 526d9b1`; attribution/license links remain visible; no inherited version/placeholders or renderer errors appear. Windows executable metadata reports Planstrand and numeric version `1.1.0.0`.
- Production browser smoke passed for Settings/About identity and extracted license assets.
- Planstrand browser suite: 25 passed against development. The focused-shell case failed on profile-menu keyboard focus in that run; the same case passed against production, including its license-asset checks. All 26 cases are covered across those runs, including midnight/week rollover, single-drop scheduling, Folder drag/drop, Event/WorkSession move/resize, themes/density and shell navigation. The development-suite focus failure remains recorded rather than claiming a fully green single suite run.

Reset UI, reset/replay tests and destructive Electron reset checks were deliberately not added/run because reset implementation stopped at the compatibility boundary. Existing user data, backups and operation-log semantics are untouched.
