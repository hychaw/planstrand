# Routines Phase 3b.1 — series editing and lifecycle

Extends the [Phase 2 persistence contract](sync-and-op-log/routines-phase-2a.md)
and [Phase 3 exception identity](sync-and-op-log/routines-phase-3a1.md).
Internal domain commands are implemented; no series editing UI is added.

## Segments and logical identity

A lineage keeps one EventSeries ID. Its ordered segments own half-open logical
slot ranges `[logicalSlotOffset, next.logicalSlotOffset)`, with an unbounded
final ownership range. Recurrence end dates still limit generated candidates.
The first offset is zero (omission remains the legacy spelling of zero); later
offsets strictly increase. Segment IDs must be unique within a plan. Validation
rejects unknown fields, invalid schedules, duplicate/non-increasing offsets,
invalid titles/tombstones and offsets without safe numeric headroom for the
remaining supported civil-date range. Ownership is defined by logical slots,
not dates: a replacement schedule may shift the dates associated with them.

The recurrence engine remains unchanged and pure. Projection and direct slot
lookup both restrict candidates to their owning segment. Persistent identity
remains `[seriesId, offset + localEngineSlot]`; segment IDs are provenance only.
Monthly missing dates and DST gaps continue to reserve slots. Each split at `k`
retains the prefix, replaces the affected suffix, and starts its new recurrence
at local slot zero/global slot `k`. Repeated splits preserve global offsets.
Moved exceptions use their original canonical slot, never their display date.
Range seeking still uses the engine's bounded queries and each segment's timing.

## Commands and replacement policy

`EventSeriesService.editEntire(id, changes, decision?)` and
`editThisAndFuture(id, canonicalSlot, changes, decision?)` return `{ ok: true }`
or a specific failure reason. Input changes are partial EventSeries definitions;
a supplied recurrence is complete, including its explicit civil start anchor.
A recurrence without `endDate` removes that recurrence's end boundary.
Timed schedules require an explicit IANA timezone, wall time and duration;
all-day schedules remain floating dates. Authored payloads are cloned.

Whole-series title edits preserve segment schedules, offsets and IDs, clearing
segment title overrides so the new title applies throughout. Whole-series
schedule edits deterministically replace the plan with one segment at offset
zero, retaining the original first segment ID. Omitted schedule fields come
from the first segment. Explicit schedule fields on an already split series
request this replacement even if they match the first segment.

This-and-future schedule edits replace the suffix starting at the selected slot.
Omitted recurrence uses the owning rule re-anchored to the occurrence's original
scheduled date, preserving weekly phase and monthly reservations. A supplied
recurrence uses its explicit new anchor. Earlier occurrences retain their
schedule and title. Title-only future edits preserve later schedule changes and
apply the title to all affected segments. An optional segment title is the only
additional per-segment metadata. Unavailable/skipped/out-of-bound selected slots
are rejected. Existing `update` delegates to the safe whole-series command;
legacy persisted update actions retain deterministic single-plan replacement.

One successful command dispatches one persistent complete-plan operation.
Reducers replace the array as a unit; conflict resolution excludes EventSeries
and exception entities from disjoint-field merging. Concurrent live plans use
existing whole-entity LWW, including client-ID ties and durable compensation.
Replay reads no receiving-device timezone, Calendar window or clock.

## Exception safety and terminal deletion

Commands compare each affected meaningful exception's original temporal meaning
before and after the proposed plan. An unchanged meaning or `inherit` record
needs no decision. Changed meaning requires explicit `retain`; overrides and
cancellations retain their exact logical-slot associations and stored values.
Exceptions outside shortened bounds remain durable and inert, and become
applicable again if their slots return.

`clear` is rejected with `atomic-clear-unsupported` when meaningful affected
exceptions exist, without dispatch or mutation. There is no safe existing
cross-entity conflict/compensation operation coupling a series plan with all
its exception registers. Independently writing `inherit` and then a plan could
leave only part of that intent after a conflict or persistence failure. This
milestone deliberately adds no generic transaction framework. When no meaningful
exceptions need clearing, the edit can proceed. Future UI must surface these
results and obtain the explicit retain decision; exceptions arriving concurrently
remain governed by their existing independent register semantics.

`deleteEntire` writes a complete series snapshot with terminal `deletedAt`, using
the existing EVENT_SERIES update infrastructure rather than removing the entity.
It can replay before creation. Late creates, plans, legacy edits and live LWW
snapshots cannot revive it; late exceptions remain inert. Delete-versus-edit
conflicts prefer the tombstone regardless of timestamps. Two concurrent terminal
snapshots use deterministic LWW so their retained metadata also converges.
Deletion does not cascade. Recreating a similarly named series generates a new
ID. Series restoration is not exposed.

## Persistence and verification

Uses existing EVENT_SERIES, OCCURRENCE_EXCEPTION, ROUTINES_V1, snapshot, backup
and compaction paths. New compact action codes are ESP (complete plan) and ESD
(terminal deletion); no entity type, schema version or database store is added.
Full-state validation uses the same plan validator as command/replay validation.
Tombstones remain meaningful recovery data and retain their entity frontier.

Focused tests cover metadata and schedule replacement, first/middle/later and
successive splits, daily/weekly/monthly transitions, global slot reservations,
DST gaps/folds, timezones, end bounds, explicit exception decisions, moved
exceptions, terminal deletion and late writes, concurrent plans and tombstones,
duplicate/reordered delivery, IndexedDB connection reopen, complete backups and
compaction. Calendar component tests cover Day, Week, Month and Year, preserving
one-off Events and WorkSessions. Sync tests assert Task, WorkSession, Planning,
one-off Event and exception slices remain unchanged by series operations.

Validated on October 10, 2026: the 294-test Calendar/Routines/capture/validation
regression run passed, followed by 207 passing final series/synchronization/backup/
compaction tests after lifecycle hardening. App and spec TypeScript checks, all
19 changed TypeScript file checks, documentation links and `git diff --check`
passed. Both test runs used headless Edge with an explicit Europe/Berlin browser
timezone. IndexedDB unit tests use fake-indexeddb; conflict tests use the real conflict service with
an adapted Store/applier harness. These are headless browser/in-process checks,
not released multi-device application tests or production deployment.

Phase 3b.2 must consume the domain failures and exception decision policy in its
UI. Atomic clear-and-edit and whole-series restoration remain unsupported.
Weekly Templates, external write-back, occurrence dragging and Calendar redesign
remain outside this milestone.

## Changed files

- `src/app/features/routines/event-series.model.ts`
- `src/app/features/routines/event-series.validation.ts`
- `src/app/features/routines/event-series-plan.ts`
- `src/app/features/routines/event-series.service.ts`
- `src/app/features/routines/store/event-series.actions.ts`
- `src/app/features/routines/store/event-series.reducer.ts`
- `src/app/features/routines/resolve-event-occurrence.ts`
- `src/app/features/routines/event-series-editing.spec.ts`
- `src/app/features/routines/event-series-sync.spec.ts`
- `src/app/features/schedule/project-event-occurrences.ts`
- `src/app/features/schedule/schedule-event-occurrences.spec.ts`
- `src/app/op-log/core/action-types.enum.ts`
- `src/app/op-log/persistence/compact/action-type-codes.ts`
- `src/app/op-log/validation/validate-operation-payload.ts`
- `src/app/op-log/sync/conflict-disjoint-merge.util.ts`
- `src/app/op-log/sync/conflict-resolution.service.ts`
- `src/app/op-log/capture/operation-log.effects.spec.ts`
- `src/app/op-log/backup/backup.service.spec.ts`
- `src/app/op-log/persistence/operation-log-compaction.service.spec.ts`
- `docs/routines-phase-3b1.md`
