# WorkSession scheduling correction

Baseline: `6185aaf9ec2c5fa244c704391698c789f004b85e`, branch
`feature/v1.1-blue-thread`. No schema or operation-format change.

## Time discrepancy

The baseline packaged Electron renderer reported no implicit IANA timezone and
formatted `2026-10-08T00:00:00Z` as 4 PM (UTC-8). Its native timezone bridge
returned `America/Vancouver`; explicitly formatting the same instant in that
zone correctly returned 5 PM. Calendar already used that bridge and the shared
IANA utilities. Drag badges instead used implicit `toLocaleTimeString`, and the
external Task drag preview used implicit `Date.getHours/getMinutes` for its row.

Drag labels and preview rows now use the same display zone and existing
`calendarHours`, `calendarClockLabel`, `calendarTimeRow` and `zonedDateTimeFields`
utilities as Calendar. Hour labels format wall coordinates directly. No fixed
offset is added to an instant, and no stored timestamp is rewritten.

Controlled browser evidence checks the real NgRx entities, durable IndexedDB
operations, projection and DOM rows: 5–6 PM Vancouver is
`2026-10-08T00:00:00Z`–`01:00:00Z`, row 205 with 12 rows/hour. Moving the existing
session to 6–7 PM preserves its ID and duration, stores `01:00:00Z`–`02:00:00Z`
and renders row 217. The regression intentionally uses an implicit UTC-8 browser
zone with an explicit Vancouver Calendar zone to reproduce the Electron mismatch.
The fixed-offset zone exists only in test setup. Production uses IANA rules.

## Independent reservations

`scheduleTask` previously reused a deterministic `task-schedule:<length>:<id>`
(or migration ID), updating that session on subsequent scheduling actions. This
was a per-Task ownership assumption, not a rendering or Task/day index limit.

Each Task scheduling intent now calls the existing `create` path with a fresh
`nanoid`, dispatching one durable WorkSession create containing that identity.
Existing WorkSession drags still use `sourceType/sourceId` and dispatch an update
to that exact ID. Bottom-edge resize changes only that session's end instant.
Task dialog prefill still works for a single unambiguous session and older primary
IDs; prefill never selects an entity for replacement.

The legacy V1 backfill IDs, suppression of their exact Task fallback, dismissal
records and the canonical projection's exclusion of inherited automatic Task flow
are unchanged. A new intentional reservation does not erase an old reservation.
Two same-Task sessions survive wire replay and hydration, with one projected block
per session. Planning and Task/session completion remain independent.

## Verification

- 236 targeted tests passed: WorkSessions, Task scheduling, pointer/preview
  conversion, Vancouver daylight/historical winter time, DST boundaries,
  Planning, current-date rollover, operation application and IndexedDB redelivery.
- Browser tests exercise Inbox and nested-Folder scheduling, repeated same-Task
  drops, a different Task, exact time/row/tooltip agreement, individual move/resize,
  Planning retention, Task completion, reload and Calendar projection. The final
  dedicated scheduling run passed 3/3, including the renderer/display-zone mismatch.
- The full development browser run initially passed 23/27. A lost single-session
  dialog prefill was corrected; the Folder/scheduling rerun passed 6/6. Production
  shell/version/license checks passed 4/4, including the development-run failures
  involving keyboard focus and missing development build revision metadata.
- TypeScript, production build, Electron build and Windows unpacked packaging
  passed. The existing initial-bundle budget warning remains (5.57 MB / 5.50 MB).
- Baseline Electron timezone diagnosis ran in an isolated profile. The newly
  packaged unsigned executable could not run: Windows explicitly reported that
  the organization's Device Guard policy blocked it. Corrected packaged Electron
  drag/restart verification therefore remains outstanding; no policy was changed
  or bypassed. No live sync server was available; durable redelivery/replay was
  tested locally.
