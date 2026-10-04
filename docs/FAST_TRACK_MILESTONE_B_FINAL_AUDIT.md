# Fast-Track V1 Milestone B audit

Date: 2026-10-04. Branch: `feature/fast-track-milestone-b`.
Base: `a9acbe10486935f7b56086fc09bdbbb3c6f5712b` (`development`).
Implementation checkpoint: `86bbe0b6f64e8d82df832a380814041cbe20f92b`.

## Product and contracts

- Normalized independent `LocalEvent` entity: `id`, `title`, `created`, `modified`,
  plus either `isAllDay: true, date` or `isAllDay: false, start, end, timeZone`.
- All-day dates use existing DB-date validation/parsing. The persisted date has no
  UTC-midnight representation or timezone. Numeric projection coordinates are
  disposable and never written back to the entity.
- Timed Events use absolute milliseconds, valid existing IANA-zone validation,
  and `end > start`. The small editor resolves wall times in the explicit zone,
  rejects DST gaps, and preserves unchanged instants, including repeated hours.
- One create/edit/move/resize/delete intent dispatches one persistent Event action.
  Timed drag preserves duration and timezone; resize changes end. All-day dates
  move through the editor. Delete uses the existing confirmation dialog.
- Event is registered with NgRx, operation capture/replay, IndexedDB, entity-key
  extraction, snapshots, validation, backup/import, and existing sync adapters.
  Generic conflict replacement also passes the Event integrity guard.
- Optional missing Event slices hydrate as empty. Invalid existing Event slices
  fail validation rather than being discarded. No schema or dependency bump.
- `EVENT` uses the existing entity capability vocabulary, full-state requirements,
  file manifests and reader gates. Empty old backups remain compatible; populated
  Event state blocks readers without EVENT. No new semantic capability.
- The existing calendar facade combines WorkSessions, Events, external adapters,
  and intentional timed-Task fallback. Provider buckets retain their existing
  shape and are filtered/deduplicated once. Day/Week/Month share this projection.
- Local Events use the existing Schedule event component and timed geometry.
  Source icons distinguish local Events, WorkSessions and provider events.
- New Event appears in Calendar navigation and the existing empty-time-area
  placeholder. The small dialog supports title, date, all-day/timed conversion,
  start/end including an end date, and timezone.
- WorkSession mutation commands and existing external-calendar/provider behavior
  remain intact. iCal, Google, CalDAV and plugin events remain adapters. No local
  Event export or automatic provider synchronization.
- Today/This Week retain Milestone A behavior. No Year view or shipping polish.

## Changed areas

`features/event`; existing Schedule projection, mapping, rendering and gestures;
NgRx registration and Event integrity guard; op-log registry/validation/snapshots/
backup; shared entity capability requirements; English translations; focused
Angular/shared-schema tests; one browser scenario; Fast-Track implementation guide.

## Validation

- Combined Angular milestone suite: **822 passed, 14 existing skips**.
- Shared-schema capability/HTTP contract suite: **63 passed**.
- Total targeted passes: **885**. Tests cover domain CRUD and invalid data, DB-date
  stability, hydration/replay, real IndexedDB, backup round-trip, missing old slice,
  sync upload/download and unsupported entity gates, mixed projection, all-day
  placement, editor CRUD, real drag release geometry and resize handle.
- Application/spec TypeScript checks and shared-schema JS/declaration build passed.
- Production web build passed; initial bundle warning: 5.68 MB versus 5.50 MB budget.
- Changed TS/SCSS `checkFile` passed; generated translation constant regenerated and
  formatted with its owner tool. Shared-schema formatting/build/tests passed.
- Translation consistency check and `git diff --check` passed.

## Remote validation and resource budget

The validated runtime remains exactly `86bbe0b6f64e8d82df832a380814041cbe20f92b`.
Published loading experiment `77c370881` was normally reverted in `38a3e164d`;
no module-consolidation or service-worker experiment remains. Final validated
implementation/budget SHA: `ce5893deeacfac1aaf74e8899afee5cf78cacdcb`.
The concluding audit commit changes documentation/config formatting only.

| Check                      | Milestone B                                  | Exact development baseline                                         |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| SuperSync (six shards)     | 326/326 executed tests passed, 14 skips      | Same                                                               |
| Regular E2E                | 407 passed, 21 failed, 2 skips               | 406 passed, identical 21 failures, 2 skips                         |
| New Event browser scenario | Passed                                       | New scenario                                                       |
| WebDAV v2                  | 39 passed, 22 failed, 11 not run             | 38 passed, same 22 failures plus one Today-tag failure, 11 not run |
| Released clients           | 3 compatibility failures, 2 upgrade failures | Same identities and causes                                         |
| Server                     | 1,391 passed, 48 skips                       | Same                                                               |

[Feature E2E](https://github.com/hychaw/planstrand/actions/runs/37172596640)
and [development E2E](https://github.com/hychaw/planstrand/actions/runs/37172372587)
provide the one normal broad checkpoint. No new supported-contract regression
was found. These results still apply because runtime content is unchanged.

Lighthouse's original **300 → 303** request delta is exact:

- **Two generated Event chunks:** reducer/actions (2,456 bytes) and selectors
  (396 bytes); scripts increase from 236 to 238. Other changed chunk hashes are
  rebuilt existing modules, not additional or duplicate requests.
- **One existing conditional font:** `open-sans-math-400-normal-2PNO2ACO.woff2`
  (19,700 bytes); fonts increase from 3 to 4. The captured startup
  filmstrip shows the existing randomized quote containing π, which requests this
  font subset. No font was added.
- Other resource-group counts match; neither report contains duplicate request URLs.

Only the logical **total resource-count limit** changes **300 → 305**, in
`tools/lighthouse/budget.json` and its matching `.lighthouserc.json` assertion.
This retains a hard check with two requests of headroom above the observed 303.
Script-count, byte-size and other performance budgets remain unchanged. The
production build passes. Lighthouse performance/accessibility target warnings
also occur on development; they are not newly enforced failures or raised budgets.

[Final CI/Lighthouse](https://github.com/hychaw/planstrand/actions/runs/37179273091)
**passed Lighthouse: 302 requests / 305 limit, zero failed enforced assertions**.
The conditional math subset was not needed on this final run (238 scripts, 3 fonts).
CI remains red solely for the historical helper failures referencing absent
`build-create-windows-store-on-release.yml` and `build.yml`, matching
[development CI](https://github.com/hychaw/planstrand/actions/runs/37172371481).
Downstream unit-test jobs are skipped by that existing CI failure.

## Deferred after V1

Advanced recurrence, WeeklyTemplate, reminder normalization, Trash, account
recovery redesign, encrypted backup redesign, advanced provider export. Local
Events are single occurrences; existing external recurrence and Task reminders
are unchanged. No merge into development and no final shipping polish.

Verdict: **Milestone B ready for merge**. No newly introduced supported-contract
regressions remain. The total-resource assertion is resolved through the justified
V1 budget update; the check remains enabled.
