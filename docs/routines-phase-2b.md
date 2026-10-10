# Recurring Events: Calendar projection (Phase 2b)

Phase 2b displays persisted EventSeries in Day, Week, Month and Year. It adds no
persisted entities, operation-log actions, synchronization semantics or migrations.
The [Phase 2a persistence contract](sync-and-op-log/routines-phase-2a.md) remains in
effect, including conditional `ROUTINES_V1` activation.

## Query and identity

[`projectEventOccurrences`](../src/app/features/schedule/project-event-occurrences.ts)
accepts series, a half-open civil date range (`fromDate`, `toDateExclusive`) and an
explicit Calendar display timezone. It delegates candidate seeking and evaluation
to the Phase 1 engine. It returns distinct `eventOccurrence` read models containing
the source series ID, segment ID, logical slot, occurrence key and scheduled date.

Phase 2b display IDs originally encoded `[seriesId, segmentId, slot]`.
[Phase 3a.1](sync-and-op-log/routines-phase-3a1.md) supersedes this with
`[seriesId, logicalSlot]`, keeping segment IDs only as provenance. Titles, timestamps, display zones,
query windows and day slices do not participate in identity. Missing monthly dates
and DST gaps retain the engine's reserved slots. DST folds use its earliest exact
instant; duration is elapsed time in milliseconds.

All-day occurrences retain floating civil dates. Their numeric coordinates are
disposable sorting values. Timed occurrences use the stored IANA scheduling zone;
the display zone determines window boundaries and presentation, not their instants.
Duration lookback includes starts before the requested window. Exact overlap uses
`start < windowEnd && end > windowStart`, including overnight and multi-day spans.
Results are ordered deterministically and deduplicated by display identity.

There is no occurrence-count cap or silent truncation. Candidate work depends on
the query and duration lookback, not on series age. Very long durations can require
many genuinely overlapping slots. Queries whose timed lookahead exceeds the
engine's four-digit civil-date domain throw `RangeError` explicitly.

## Calendar integration

[`CalendarDisplayService`](../src/app/features/schedule/calendar-display.service.ts)
exposes `createItemsForRangeComputed` and `createItemsForDaysComputed`. Each consumer
owns its signal query; there is no shared mutable Calendar range. The global
`items` signal continues to contain only the existing local/provider projections.
Recurrence expansion depends on series, range and display zone, separately from
Task tracking, clock refreshes and provider updates. Equivalent day ranges do not
re-expand when callers allocate a new array.

[`ScheduleService`](../src/app/features/schedule/schedule.service.ts) supplies the
Day panel query. The full Calendar component passes its own computed query into
the existing context-aware mapping path. Month uses every padded grid date. Timed
occurrence blocks are clipped before the existing day splitter, keeping source
instants and IDs on their data. All-day entries use the existing Event lane.

[`ScheduleYearComponent`](../src/app/features/schedule/schedule-year/schedule-year.component.ts)
queries the selected year once per relevant change and uses
[`bucketCalendarActivity`](../src/app/features/schedule/calendar-activity.ts) to
count each item once per covered date, with exclusive midnight ends. Existing
WorkSession activity indicators remain distinct.

`SVEType.EventOccurrence` keeps generated entries out of Event, WorkSession, Task
and external-provider mutation paths. Occurrence permissions disable move, resize
and delete. Day/Week/Month bind their drag directives as disabled, clicks do not
open editors or action menus, and drag service guards also refuse stale or
programmatic occurrence deliveries. Existing Event styling and a repeat icon are
reused.

## Changed files

All implementation changes are under `src/app/features/schedule/`:

- New projection and activity bucketing: `project-event-occurrences.ts`,
  `calendar-activity.ts`.
- Read model and query facade: `calendar-display-item.model.ts`,
  `calendar-display.service.ts`.
- Schedule plumbing: `schedule.const.ts`, `schedule.model.ts`, `schedule.service.ts`,
  `schedule/schedule.component.ts`.
- Mapping: `map-schedule-data/create-sorted-blocker-blocks.ts`,
  `create-view-entries-for-block.ts`, `map-to-schedule-days.ts`,
  `map-schedule-days-to-schedule-events.ts`.
- Views and interaction safety: `schedule-week/schedule-week.component.ts`,
  `schedule-week/schedule-week-drag.service.ts`,
  `schedule-event/schedule-event.component.ts` and `.html`,
  `schedule-year/schedule-year.component.ts`.
- New tests: `project-event-occurrences.spec.ts`, `schedule-event-occurrences.spec.ts`.
- Updated query mocks/regressions: `calendar-display.service.spec.ts`,
  `schedule-year/schedule-year.component.spec.ts`,
  `schedule/schedule.component.spec.ts`, `schedule/schedule-locale-ng0701.spec.ts`.
  The full Calendar test mock now uses the configured-or-system display zone,
  matching production and its existing local-midnight assertions.

## Validation and deferred work

Focused browser tests exercise the real engine, query facade, schedule mapper,
component templates and interaction guards. NgRx and external-provider boundaries
are mocked; these tests are not a full application or multi-client sync run.
Coverage includes recurrence rules, bounds, old series, overlap, DST, stable IDs,
independent queries, clock/provider/Task invalidation, padded Month boundaries,
Year counts, navigation, timezone changes and zero projection dispatches. Existing
Calendar, Event/WorkSession mapping and recurrence specs provide regressions.

Validation for this milestone: 530 focused specs passed in headless Edge with an
explicit Europe/Berlin browser timezone; app and spec TypeScript checks passed;
all 22 changed TypeScript files passed `npm run checkFile`. Documentation links
and `git diff --check` passed. No full application or multi-client sync suite ran.

Use the [development file checks](development.md#focused-validation) and scoped
Angular specs. No sync-server migration or deployment is needed for this phase.

Creation/editing UI, occurrence exceptions/cancellations, scope selection, series
splitting, Weekly Templates and external write-back remain deferred. Phase 3 must
introduce explicit scope-aware commands before enabling occurrence interactions.
