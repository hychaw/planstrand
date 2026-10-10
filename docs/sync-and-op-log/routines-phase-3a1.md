# Occurrence exception persistence (Phase 3a.1)

Occurrence exceptions are an optional, separate `occurrenceException` entity slice.
Calendar does not read or apply this slice yet. Ordinary generated occurrences
remain read models and do not create Events, Tasks, WorkSessions or Planning entries.

## Identity

The stable identity is the JSON tuple `[seriesId, logicalSlot]`. The series ID is
the lineage ID; a segment ID is provenance only. The recurrence engine continues
to enumerate segment-local slots, independent of query windows and timezones,
reserving monthly missing dates and DST gaps as before. Projection translates
these with `logicalSlot = segment.logicalSlotOffset + engineSlot`. The optional
persisted offset defaults to zero, preserving existing one-segment schedules.
Whole-series updates and compensation preserve this offset.

Phase 2b display IDs included segment IDs and would change when a future split
replaced a segment. Display IDs now use `eventOccurrence:` plus the stable tuple;
exception IDs use `occurrenceException:` plus that same tuple. JSON encoding is
collision-safe for delimiters, quotes and Unicode. Slots must be nonnegative safe
integers; negative zero is rejected because it serializes as zero. Overflow when
translating offsets is rejected. Display timestamps, override dates and timezone
offsets never participate in identity.

Exactly one segment remains supported. Future splitting must assign a new
segment the global slot at its boundary, preserve existing lineage keys and
validate nonoverlapping slot ownership. No splitting operation is implemented.

## Commands and replacement values

`OccurrenceExceptionService` exposes internal `edit`, `cancel`, `restore` and
`updateOverride` commands. Every successful command dispatches one persistent
complete upsert with the deterministic ID, immutable series ID and logical slot,
authored modification timestamp and one complete tagged value:

- `inherit`: explicitly restore the occurrence defined by its series.
- `cancelled`: suppress the original occurrence when application is implemented.
- `override`: a complete EventInput, either title + floating all-day date or
  title + timed start/end + explicit IANA timezone.

`updateOverride` requires an existing override; `edit` can replace any state.
Values are cloned before dispatch. Reducers use `setOne`, never nested merging,
so changing temporal shape or restoring clears old override fields explicitly.
There is no deletion action or JSON-undefined clearing convention. Moving an
override preserves its original slot. Commands do not query Calendar or alter
the parent schedule. Validation reuses one-off Event temporal/title semantics
and rejects unknown fields, malformed shapes, noncanonical IDs and inconsistent
entity states. Invalid present slices are rejected rather than repaired away;
absent V1.1 slices default to empty.

## Replay, conflicts and durability

Complete upserts allow valid writes and compensation to arrive before a series
or a previous exception write. No parent foreign-key pruning occurs. Different
slots have independent entity keys and commute. Same-slot cancellation, editing
and restoration use the existing whole-entity LWW conflict policy (timestamp,
then client ID). Cancellation is a value, not a deletion with special precedence.
This entity has no generic partial-field merge fallback. Compensation carries a
complete validated snapshot and merges causal clocks using existing machinery.

Replay uses the existing durable operation sequence and conflict compensation;
raw stale same-slot actions are not independently sorted inside the reducer.
Duplicate operations are deduplicated by the operation log. Reapplying an
identical upsert is idempotent. No replay path consults the current timezone or
Calendar projection. Canonical IDs prevent compensation from retargeting series
ownership or slots.

The entity is registered in the store, selectors, integrity validation, operation
vocabulary/compact action code (`OES`), entity registry, model defaults, snapshots,
entity frontiers, complete backups/imports and meaningful-data/recovery checks.
No database object store, dependency or schema version is added.

All exception capture and compensation writes require `ROUTINES_V1` and
`OCCURRENCE_EXCEPTION` support. Nonempty or malformed full-state slices infer the
same requirements. Exact empty slices do not activate compatibility requirements
or add file-provider baseline requirements. Existing monotonic semantic metadata
retains activation across pruning, replacement and compaction; file manifests and
recovery files retain it too. Deploy the updated shared entity vocabulary on sync
servers before enabling exception writes. The existing Phase 1c.2 durable semantic
requirements migration remains the deployment prerequisite; this phase adds none.

## Verification and scope

Validated on October 10, 2026: 413 focused Angular tests and five shared-schema
capability tests passed. App/spec TypeScript checks, shared-schema and server
builds, all 43 changed root TypeScript file checks, package formatting,
documentation links and `git diff --check` passed.

Focused tests cover key validation and segment-independent identity, command
replacement and explicit restoration, timed/all-day shapes, missing parents,
operation capture, compensation, complete BackupService round trips, snapshots,
IndexedDB connection reopen, duplicate delivery, reordered independent slots,
compatibility, cold file readers and exception-only recovery/compaction.

Conflict tests use real conflict detection/resolution and fake-indexeddb with a
synchronous Store/applier harness. Both cancel/edit directions, both timestamp
winners and lexical client-ID ties converge, including durable restart replay.
Angular's normal IndexedDB tests use fake-indexeddb; file tests use MockFileProvider.
These are focused browser/in-process tests, not released multi-device app tests
or a production sync-server deployment.

Phase 3a.2 still owns exception application in Calendar, override visibility when
moved into/out of a query range, dialogs, scope choice and public action routing.
Series splitting/deletion, Weekly Templates and external calendar write-back
remain excluded.

## Changed files

- [docs/sync-and-op-log/routines-phase-3a1.md](../../docs/sync-and-op-log/routines-phase-3a1.md)
- [src/app/features/routines/occurrence-exception-sync.spec.ts](../../src/app/features/routines/occurrence-exception-sync.spec.ts)
- [src/app/features/routines/occurrence-exception.model.ts](../../src/app/features/routines/occurrence-exception.model.ts)
- [src/app/features/routines/occurrence-exception.service.ts](../../src/app/features/routines/occurrence-exception.service.ts)
- [src/app/features/routines/occurrence-exception.spec.ts](../../src/app/features/routines/occurrence-exception.spec.ts)
- [src/app/features/routines/occurrence-exception.validation.ts](../../src/app/features/routines/occurrence-exception.validation.ts)
- [src/app/features/routines/occurrence-key.ts](../../src/app/features/routines/occurrence-key.ts)
- [src/app/features/routines/store/occurrence-exception.actions.ts](../../src/app/features/routines/store/occurrence-exception.actions.ts)
- [src/app/features/routines/store/occurrence-exception.reducer.ts](../../src/app/features/routines/store/occurrence-exception.reducer.ts)
- [src/app/features/routines/store/occurrence-exception.selectors.ts](../../src/app/features/routines/store/occurrence-exception.selectors.ts)
- [src/app/root-store/meta/occurrence-exception-integrity.meta-reducer.ts](../../src/app/root-store/meta/occurrence-exception-integrity.meta-reducer.ts)
- [docs/routines-phase-2b.md](../../docs/routines-phase-2b.md)
- [packages/shared-schema/src/entity-types.ts](../../packages/shared-schema/src/entity-types.ts)
- [packages/shared-schema/src/full-state-capabilities.ts](../../packages/shared-schema/src/full-state-capabilities.ts)
- [packages/shared-schema/src/reader-capabilities.ts](../../packages/shared-schema/src/reader-capabilities.ts)
- [packages/shared-schema/tests/routines-capabilities.spec.ts](../../packages/shared-schema/tests/routines-capabilities.spec.ts)
- [src/app/features/routines/event-series.model.ts](../../src/app/features/routines/event-series.model.ts)
- [src/app/features/routines/event-series.validation.ts](../../src/app/features/routines/event-series.validation.ts)
- [src/app/features/routines/store/event-series.reducer.ts](../../src/app/features/routines/store/event-series.reducer.ts)
- [src/app/features/schedule/project-event-occurrences.spec.ts](../../src/app/features/schedule/project-event-occurrences.spec.ts)
- [src/app/features/schedule/project-event-occurrences.ts](../../src/app/features/schedule/project-event-occurrences.ts)
- [src/app/op-log/backup/backup.service.spec.ts](../../src/app/op-log/backup/backup.service.spec.ts)
- [src/app/op-log/backup/state-snapshot.service.spec.ts](../../src/app/op-log/backup/state-snapshot.service.spec.ts)
- [src/app/op-log/backup/state-snapshot.service.ts](../../src/app/op-log/backup/state-snapshot.service.ts)
- [src/app/op-log/capture/operation-log.effects.spec.ts](../../src/app/op-log/capture/operation-log.effects.spec.ts)
- [src/app/op-log/capture/operation-log.effects.ts](../../src/app/op-log/capture/operation-log.effects.ts)
- [src/app/op-log/core/action-types.enum.ts](../../src/app/op-log/core/action-types.enum.ts)
- [src/app/op-log/core/entity-registry.spec.ts](../../src/app/op-log/core/entity-registry.spec.ts)
- [src/app/op-log/core/entity-registry.ts](../../src/app/op-log/core/entity-registry.ts)
- [src/app/op-log/core/types/backup.types.ts](../../src/app/op-log/core/types/backup.types.ts)
- [src/app/op-log/model/model-config.ts](../../src/app/op-log/model/model-config.ts)
- [src/app/op-log/persistence/compact/action-type-codes.ts](../../src/app/op-log/persistence/compact/action-type-codes.ts)
- [src/app/op-log/persistence/extract-entity-keys.ts](../../src/app/op-log/persistence/extract-entity-keys.ts)
- [src/app/op-log/persistence/operation-log-compaction.service.spec.ts](../../src/app/op-log/persistence/operation-log-compaction.service.spec.ts)
- [src/app/op-log/sync-providers/file-based/planstrand-file-protocol.ts](../../src/app/op-log/sync-providers/file-based/planstrand-file-protocol.ts)
- [src/app/op-log/sync-providers/file-based/planstrand-file-sync-adapter.service.spec.ts](../../src/app/op-log/sync-providers/file-based/planstrand-file-sync-adapter.service.spec.ts)
- [src/app/op-log/sync-providers/file-based/planstrand-file-transport.ts](../../src/app/op-log/sync-providers/file-based/planstrand-file-transport.ts)
- [src/app/op-log/sync/build-replacement-operation.ts](../../src/app/op-log/sync/build-replacement-operation.ts)
- [src/app/op-log/sync/sync-capability.util.ts](../../src/app/op-log/sync/sync-capability.util.ts)
- [src/app/op-log/validation/auto-fix-typia-errors.ts](../../src/app/op-log/validation/auto-fix-typia-errors.ts)
- [src/app/op-log/validation/data-repair.ts](../../src/app/op-log/validation/data-repair.ts)
- [src/app/op-log/validation/has-meaningful-state-data.util.ts](../../src/app/op-log/validation/has-meaningful-state-data.util.ts)
- [src/app/op-log/validation/is-related-model-data-valid.ts](../../src/app/op-log/validation/is-related-model-data-valid.ts)
- [src/app/op-log/validation/validate-operation-payload.ts](../../src/app/op-log/validation/validate-operation-payload.ts)
- [src/app/op-log/validation/validation-fn.ts](../../src/app/op-log/validation/validation-fn.ts)
- [src/app/root-store/feature-stores.module.ts](../../src/app/root-store/feature-stores.module.ts)
- [src/app/root-store/meta/meta-reducer-registry.ts](../../src/app/root-store/meta/meta-reducer-registry.ts)
- [src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts](../../src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts)
- [src/app/root-store/root-state.ts](../../src/app/root-store/root-state.ts)
