# Recurring Event series persistence (Phase 2a)

`EventSeries` is a separate optional `eventSeries` entity slice. Existing one-off
Events, Tasks, WorkSessions and Planning retain their models and operations.
No database object stores or schema versions are added.

## Model and writes

The series ID is its stable lineage. `segments` is currently a one-element tuple:
the segment has its own stable ID, the Phase 1 recurrence definition, and the
Phase 1 timing definition. Daily, weekly and monthly anchors and inclusive end
dates use the existing engine. All-day schedules remain floating dates; timed
schedules require a wall time, an explicit IANA zone and elapsed duration.
Monthly missing dates and DST gaps/folds retain the engine's policies.

The service generates both IDs and creation/modification timestamps before
dispatch. Creation carries the complete entity; updating carries every editable
field plus its authored modification timestamp. An omitted end date clears the
old bound. Reducers preserve the series/segment IDs and creation timestamp.
Duplicate creation does not overwrite later edits. Missing-series updates are
no-ops. Inputs are cloned so callers cannot mutate an authored operation later.

Runtime validation checks exact field sets, entity-state consistency, metadata,
recurrence rules and timing. It reuses the engine with an empty candidate window
and a timing evaluation; no second recurrence implementation is introduced.
Invalid present slices are rejected, never defaulted or repaired to empty state.
Absent legacy slices default to an empty entity collection.

Conflict compensation uses validated complete snapshots for existing series,
preserving immutable metadata and authored timestamps. It bypasses generic LWW
recreation. No series deletion action, occurrence editing or lifecycle policy is
introduced. The stable lineage and segment identity are extension points for
future template ownership, exceptions and schedule splitting; these features
have no persisted fields or write operations in this milestone.

## Conditional compatibility

Current readers and servers advertise `EVENT_SERIES` and `ROUTINES_V1` support.
Neither token becomes a requirement simply because this version is installed.
Absent/exact empty slices have no new full-state requirement, and the file-sync
baseline excludes `ENTITY:EVENT_SERIES`.

Series capture and compensation stamp `ROUTINES_V1`; nonempty (or malformed)
full-state series slices infer it. The first persisted series therefore activates
the existing Phase 1c.2 monotonic semantic floor in IndexedDB metadata and server
account metadata. Compaction, operation removal, full-state replacement, backups
and recovery reuse that floor. Replacing all data with an empty snapshot does not
deactivate it. File providers retain the same tokens in their durable manifest
and recovery files. An unaware reader refuses before committing a cursor or
uploading its pending operations.

The server migration `20261010050000_durable_semantic_requirements` from Phase
1c.2 is a deployment prerequisite. This milestone adds no migration and does not
migrate production. Deploy the updated server capability vocabulary before
clients create series; older servers must refuse unsupported series uploads.

## Verification

Focused Angular specs cover creation, updates, immutable identity, malformed
definitions, all-day/timed schedules, missing/invalid zones, remote action
conversion, duplicate delivery, snapshot and complete-backup restoration,
legacy states, recurrence-only recovery, capture, compaction and file manifests.
Angular's normal test harness uses **fake-indexeddb**. File-provider integration
specs use **MockFileProvider**, including cold-reader rejection and retention.

A separate local headless-browser check uses **native IndexedDB** across a page
reload, compact operation decoding, pruning and empty snapshot replacement.
The new server integration spec uses **real localhost HTTP, real encryption and
fresh migrated PostgreSQL**, with independent V1.1/V1.2 reader advertisements.
It checks plain-data compatibility, first activation, duplicate upload,
older-reader refusal and retention after clean-slate replacement. The existing
Phase 1c transaction-race tests run against that same disposable infrastructure.
This is API-client coverage; it is not two released browser application builds.

Validated on October 10, 2026: 565 focused Angular tests, eight shared-schema
tests, the new real-HTTP Routines test and 14 existing PostgreSQL transaction-race
tests passed. Native IndexedDB reload/retention passed. App/spec TypeScript,
server and shared-schema builds, the new server test's TypeScript check, changed
file checks and documentation link checks passed. No production server was used.

Run the new focused specs using the development guide's file-test commands, and
run the server test with a disposable `DATABASE_URL`:

```sh
npm run test:file src/app/features/routines/event-series.spec.ts
npm --prefix packages/shared-schema test -- tests/routines-capabilities.spec.ts
npm --prefix packages/super-sync-server test -- --config vitest.integration.config.ts tests/integration/routines-compatibility.integration.spec.ts
```

Phase 2b owns Calendar occurrence projection and creation UI. Occurrence
exceptions, splitting, Weekly Templates and lifecycle/deletion policies remain
deferred to their later milestones, including Phase 3b. No external calendar
write-back is included.
