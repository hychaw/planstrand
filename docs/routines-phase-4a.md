# Routines Phase 4a — Weekly Templates persistence and projection

Weekly Templates now persist independently of their EventSeries entries. A template
stores its stable ID, title, activity flag, inclusive civil start/end dates,
creation/modification timestamps and optional terminal `deletedAt` tombstone.
Runtime validators reject malformed dates, metadata, unknown fields and inconsistent
entity states. The additive `weeklyTemplate` slice is optional in older snapshots.

## Commands and ownership

`WeeklyTemplateService` creates and renames templates, updates their complete date
window, activates/deactivates them, terminally deletes them and creates weekly
entries through `EventSeriesService.create`. An omitted end date clears the bound.
Multiple named templates and multiple entries per template are independent.

An entry is an existing EventSeries with an immutable optional `templateId`.
Membership is derived from this link; templates store no series-ID array. Existing
series plan editing and occurrence exception commands remain authoritative.
Other valid persisted recurrence families remain supported. Commands require an
existing, nondeleted owner when creating an entry; replay accepts temporarily
missing parents without deleting child records.

Deactivation preserves entries and exceptions, and reactivation restores their
identities. Template deletion writes one complete terminal parent tombstone with
no cascade. Late child edits cannot change the parent's lifecycle. Conflict
resolution reuses the series delete-wins policy; concurrent terminal snapshots
use deterministic LWW. Independent entries synchronize as independent entities.

## Calendar behavior

The existing Calendar facade passes templates into the shared bounded, read-only
occurrence projector. Standalone series retain their existing behavior. An owned
series requires an active, nondeleted, present template. The template's inclusive
date bounds intersect the series/segment bounds on original scheduled civil dates.
Neither recurrence anchors nor logical slots are changed by the template window.
Moved overrides can display outside that window when their original scheduled date
is eligible; overrides moved into the window from ineligible dates remain hidden.
Cancellation and inherit restoration retain the existing exception semantics.

Day, Week, Month and Year use the same range query. Overlapping templates retain
all independent occurrences. No Tasks, WorkSessions, Planning memberships or
permanent Event instances are generated.

## Persistence and compatibility

`WEEKLY_TEMPLATE` is registered in the store, entity registry, action vocabulary,
compact action codes, operation capture/replay, conflict handling, snapshots,
entity-key extraction, defaults, state validation, repair protection, meaningful
data detection and backup/import/export paths.

The first template activates the existing `ROUTINES_V1` semantic requirement even
without entries. Full-state entity requirements and file manifests are conditional;
an exact empty registered slice does not activate new semantics. Existing durable
compatibility retention survives compaction, history removal, recovery and
destructive full-state replacement. No schema version change is required.

## Validation and next milestone

Focused tests exercise commands, strict validation, immutable ownership, lifecycle,
window intersection, moved/cancelled/restored occurrences, missing-parent replay,
overlapping templates, independent entry edits, conflict convergence, IndexedDB
reopen, snapshots, protected backups, complete backup import and compatibility
activation/retention. Existing recurrence, Calendar, operation, backup, compaction
and file-sync regressions remain covered.

Validated October 10, 2026: 620 recurrence/Calendar/operation tests, 457
backup/store/compaction/file-sync tests and 26 shared-schema compatibility tests
passed. Angular browser tests used headless Edge with an explicit Europe/Berlin
timezone. App/spec TypeScript checks, all 46 changed application TypeScript
`checkFile` checks, four package formatting checks, documentation links and
`git diff --check` passed.

Phase 4b can add Weekly Templates management UI using these commands and derived
membership selectors. This milestone adds no management screen, navigation,
drag-and-drop, external synchronization or occurrence-generation side effects.
