# Routines Phase 3b.2 — Series editing UI

Recurring Calendar blocks open the existing Event dialog with three editing
scopes: This occurrence, This and future, and Entire series. Source-aware routing,
canonical occurrence keys and disabled occurrence dragging remain unchanged.
Year remains an activity/navigation view; open a day to edit its occurrences.

This occurrence retains the existing override editor and cancellation/restoration
actions. Series scopes expose daily/weekly/monthly recurrence, interval, weekly
weekdays, anchor date, all-day/timed status, local start time, scheduling timezone,
elapsed duration in minutes and an optional inclusive recurrence end date.

## Defaults and schedule changes

Each scope keeps its own in-memory draft while the dialog is open. This occurrence
starts from the effective occurrence. This and future starts from the owning
segment and the selected occurrence's original scheduled date. Entire series
starts from the global title and first segment. Occurrence overrides never become
series defaults implicitly.

Only changed schedule fields are sent to the existing domain commands. Title-only
edits preserve schedule plans, including later planned segments. Schedule edits
replace the applicable suffix or entire plan under the Phase 3b.1 policy. The
dialog explains that an entire-series schedule edit also changes earlier
occurrences. Global logical slots and series lineage remain domain-owned.

## Exceptions, deletion and errors

The editor first invokes the command without an exception decision. When the
domain requires consent, a Blue Thread confirmation explains that modifications
and cancellations retain logical-slot associations and may appear on different
dates. Only the explicit **Retain existing exceptions** action retries with
`retain`. Declining keeps the form open. There is no Clear-and-edit action.
Rejected operations show translated errors and preserve the draft and scope.

**Delete entire series** is separate from **Cancel this occurrence**. Its explicit
confirmation explains that all occurrences, including modified ones, disappear
permanently. It invokes the existing terminal tombstone command. Exceptions stay
inert synchronization records; other entity types are untouched. Calendar
projections update immediately through existing Store signals.

Native labelled controls, the existing dialog focus trap and source-aware focus
restoration are reused. Nested confirmation decline restores focus to the action
button. Form labels stack on narrow screens and weekday choices wrap.

## Validation

Focused tests use real commands/reducers and bounded projection, plus real Material
dialogs for keyboard/focus behavior. They cover all scopes, moved overrides,
metadata versus schedule changes, successive/later-segment edits, recurrence
changes, end bounds, all-day/timed conversion, timezone/DST validation, explicit
retain/decline, unsupported-clear errors, deletion and unrelated-write isolation.
Day, Week, Month and Year components render saved edits and subsequent deletion.
Existing occurrence restoration, one-off Event, provider/WorkSession routing and
Calendar regressions remain included.

The older occurrence editor fixture now uses first-segment offset zero as required
by Phase 3b.1; later nonzero slots are covered by the new split-edit tests.

Validated October 10, 2026: 90 focused Angular tests passed in headless Edge with
an explicit Europe/Berlin browser timezone. App and spec TypeScript checks,
`checkFile` for the six changed TypeScript/template/SCSS files, translation checks,
generated translation constants, documentation links and `git diff --check` passed.

## Limitations

New labels use the existing English translation fallback until localized. Series
creation, atomic exception clearing, deleted-series restoration, occurrence
drag/resize, Weekly Templates and external calendar write-back remain out of scope.
Validation is headless browser/in-process coverage, not a released multi-device
application test or a manual mobile-device review.
