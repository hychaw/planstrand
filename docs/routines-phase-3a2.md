# Exception-aware Calendar projection (Phase 3a.2)

Calendar now reads the persisted exception slice from
[Phase 3a.1](sync-and-op-log/routines-phase-3a1.md). This milestone changes only
read models: no persistence models, operations, migrations or editing UI.

## Projection and moved occurrences

[`projectEventOccurrences`](../src/app/features/schedule/project-event-occurrences.ts)
accepts the current exception entities alongside series, the half-open civil
range and display timezone. Missing exceptions and `inherit` use the series
occurrence; `cancelled` suppresses it; `override` replaces its complete Event
value. Title and temporal shape come from the replacement. An override never
produces an additional copy at the original location.

Identity remains `eventOccurrence:` plus the canonical `[seriesId, logicalSlot]`
tuple. Segment IDs remain provenance; the original scheduled date remains on
the occurrence even after repeated date/time edits. All-day dates float across
display timezones. Timed replacements retain their actual start/end timestamps
and stored timezone; Calendar presentation uses the display timezone.

Two sources feed one identity map:

- Bounded recurrence candidates, with the existing elapsed-duration lookback.
  Exceptions are applied before the effective overlap test.
- Persisted overrides whose effective timing overlaps the range. The engine's
  `getRecurrenceCandidateForSlot` resolves their original candidate directly,
  without expanding history. It preserves daily/weekly/monthly phase, reserved
  missing monthly dates, inclusive bounds and the four-digit date domain.
  Timing evaluation retains the engine's DST gap/fold policy.

Only valid original occurrences project. Exceptions with missing parents,
out-of-bound slots, missing monthly dates or DST-gap slots remain stored and
unprojected. Parent arrival can make an otherwise valid exception visible.
There is no pruning, exception rewriting or count cap.

## Calendar and performance

[`CalendarDisplayService`](../src/app/features/schedule/calendar-display.service.ts)
adds the exception selector to its existing consumer-owned computed queries and
one-shot day query. Expansion depends on series, exceptions, range and display
timezone. Clock, Task and provider changes retain the existing independence.
Exception lookup is built once per range projection, not per Calendar day.
There is no new cache framework.

Day and Week retain the existing clipping and splitting behavior, with one
logical identity across all covered days. Month queries every padded grid date.
Year queries its range once and buckets each occurrence once per covered date,
with exclusive midnight ends. Local Events, WorkSessions and provider identities
retain their existing adapters and permissions.

All occurrence outputs remain read-only. Existing click, context-menu, resize,
delete and drag guards also apply to overridden occurrences. Projection does not
dispatch NgRx actions or change Tasks/Planning.

## Verification and limitations

Focused tests cover exception values, repeated complete edits and restoration,
moved-in/out queries across years, all-day/timed conversion, timezone changes,
DST/overnight/multi-day overlaps, orphan arrival, valid slot ownership, stable
identity, padded Month edges, Year counts, existing Events/WorkSessions/provider
identity isolation and read-only interaction guards. Direct-slot tests compare
against bounded engine expansion and check constant work for ancient series.

Validated on October 10, 2026: 677 focused Calendar/Routines specs passed in
headless Edge with an explicit Europe/Berlin browser timezone. The final Calendar
integration rerun passed all nine specs, including override timezone counts.
App/spec TypeScript checks, all seven changed TypeScript `checkFile` checks,
documentation-link checks and `git diff --check` passed.
These are browser/in-process tests, not full application or multi-device sync runs.

Occurrence editing/cancellation UI and scope selection follow separately.
Series splitting/lifecycle, Weekly Templates and external write-back remain
excluded. Phase 3a.2 is complete at read-only projection.
