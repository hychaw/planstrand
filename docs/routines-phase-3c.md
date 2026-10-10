# Routines Phase 3c — Recurring Event creation UI

The existing Calendar Event creation dialog now offers **Does not repeat**
(default), **Daily**, **Weekly** and **Monthly**. One-off creation retains its
existing start/end controls and Event command. Existing occurrence editing scopes,
exception confirmations and terminal series deletion remain unchanged.

Recurring creation reuses the series editor's interval, ISO weekday choices,
optional inclusive end date and elapsed duration controls. It preserves Calendar
date/time defaults and carries an already edited one-off duration into the
recurring form. Monthly recurrence uses the start date's day of the month; the
dialog explains that months lacking that day are skipped. Recurrence-specific
fields stay hidden for one-off Events.

## Creation and validation

A recurring Save calls the existing `EventSeriesService.create` once. The service
validates the complete definition and creates one series with one initial schedule
segment at logical offset zero. No one-off Event or generated occurrence is
persisted. Existing bounded Calendar projection and conditional `ROUTINES_V1`
activation consume that series without new persistence or synchronization code.
Successful creation blocks subsequent submissions while the dialog closes.
Rejected input leaves the form open, preserves its data and permits correction.

Timed creation prepopulates a valid configured timezone, or the system timezone
when no configured timezone is set. An invalid configured zone or unavailable
system zone leaves a recurring timed timezone blank for explicit correction;
the one-off editor's historical UTC fallback is never adopted silently for a
series. All-day series store civil dates without a timezone.

Domain recurrence validation remains authoritative. Weekly intervals use the
existing Monday-based phase and ISO weekday ordering. Invalid monthly dates and
DST gaps are skipped; folds use the earlier instant. In particular, a recurring
anchor in a DST gap is valid and reserves its skipped logical slot. Timed
durations represent elapsed real time.

## Calendar and accessibility

Creation uses the existing Day/Week/Month toolbar and timed grid placeholder.
Native labelled controls, wrapped weekday choices and the existing Blue Thread
mobile layout are reused. The Calendar placeholder disappears when it opens a
dialog; its close handler now restores focus to the Calendar if that temporary
launcher is gone, following the existing occurrence-editor fallback pattern.

Focused tests cover one-off creation, all six recurrence/timing combinations,
intervals, multiple weekdays, inclusive bounds, skipped monthly dates, DST gaps
and folds, explicit/configured/system timezone handling, invalid-input correction,
duplicate submission prevention, initial segment data, conditional capability
activation and reactive Calendar projection without duplicate one-off blocks.
The headless browser smoke test opens the real Calendar placeholder's dialog,
selects weekly recurrence and weekdays, saves through real commands/reducers,
checks rendered Calendar blocks and verifies focus restoration. Existing series
editing, cancellation/restoration and unrelated timed entry-point tests remain
included.

Validated October 10, 2026: 202 focused Angular tests passed in headless Edge
with an explicit Europe/Berlin browser timezone, including the creation smoke
test. App/spec TypeScript checks, all six changed source/template/spec `checkFile`
checks, 21 translation-tool tests, translation validation, generated constants,
documentation links and `git diff --check` passed.

## Limitations

New labels use the established English fallback until localized. No advanced
recurrence preview is provided. Weekly Templates, occurrence dragging, exception
clearing, deleted-series restoration, external write-back and new persistence/sync
semantics remain outside this milestone. The smoke check runs in the headless
Angular browser fixture; it is not a full application or manual mobile-device run.
