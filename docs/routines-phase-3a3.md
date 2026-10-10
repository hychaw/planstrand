# Routines Phase 3a.3 — individual occurrence editing

Phase 3a.3 connects the existing exception commands to the Calendar. It builds on
[persisted exceptions](sync-and-op-log/routines-phase-3a1.md) and
[exception-aware projection](routines-phase-3a2.md), without changing persistence,
recurrence rules, or provider integration.

## Editing and scope

Click a recurring Event in Day, Week, or Month (including padded grid dates), or
focus it and press Enter or Space. The existing
[Event dialog](../src/app/features/event/dialog-event/dialog-event.component.ts)
identifies the scope as **Recurring Event · This occurrence**. Year activity
counts retain their existing day-navigation behavior; open a day to edit a block.

The dialog resolves `[seriesId, logicalSlot]` against current parent and exception
state using [direct slot resolution](../src/app/features/routines/resolve-event-occurrence.ts).
It initializes from the effective override, if any, including its scheduling
timezone, dates, and times. A moved occurrence retains its original canonical key.
Unavailable parents or invalid original slots cannot be edited or restored.

Save sends one complete Event value through `OccurrenceExceptionService.edit`.
Repeated saves replace the same exception. All-day values remain floating dates;
timed values use the explicitly displayed IANA scheduling timezone. The existing
strict conversion rejects invalid civil dates, times, zones, DST gaps, and
non-positive durations. Unchanged fields retain sub-minute precision and an
existing later-fold instant. Switching a timed occurrence to all-day and back
defaults to its parent's scheduling timezone. A floating parent has no stored
timezone, so the normal Event timezone default is shown and can be changed.

## Cancellation and restoration

**Cancel this occurrence** uses the existing confirmation dialog and writes
`cancelled`; the commitment disappears. The confirmation explains where to find
restoration. An overridden block also offers **Restore original schedule**,
which writes `inherit` and closes the editor.

The Calendar toolbar exposes **Cancelled occurrences** in Day, Week, Month, and
Year. Its lightweight
[dialog](../src/app/features/routines/dialog-cancelled-occurrences/dialog-cancelled-occurrences.component.ts)
searches persisted cancellations by original title/date/time, independently of
the visible Calendar range. Each entry shows the original schedule and timed
scheduling zone, with an accessible Restore action. Restore writes `inherit`,
closes the dialog, and returns focus to its launcher. Orphan and invalid-slot
exceptions remain stored but are omitted until their original slot is available.
Cancelling replaces any override; restoration returns to the parent schedule.

## Interaction isolation and accessibility

Occurrences remain excluded from drag, resize, Event deletion, Task context
menus, and provider commands. Only the occurrence click/keyboard branch opens
the editor. One-off Events, WorkSessions, and external provider events retain
their existing source-specific routes. No Task or Planning actions or series
updates are emitted by these workflows.

Dialogs reuse existing form, confirmation, and Material focus-trap components.
Occurrence blocks have button semantics and visible keyboard focus. Close or
Escape returns focus to the original block; cancellation or a move outside the
visible range returns focus to the containing Calendar grid. Drag previews are
not interactive. The restoration list wraps on narrow screens and supports
keyboard search and actions. New English labels use the existing fallback for
locales without translations.

## Verification and boundaries

Focused tests exercise actual exception commands/reducers with Calendar queries,
canonical identity, repeated edits, moving without duplicates, all-day/timed
conversion, explicit timezone changes, invalid inputs, DST gaps/folds,
cancellation confirmation, and restoration without a visible block. Real-dialog
browser tests cover Enter/Space, initial focus, Close/Escape, removal/move focus,
and restoration focus. Toolbar tests cover all four Calendar views. Existing
Calendar/Routines/Event regressions cover projection and source isolation.

Validated on October 10, 2026: all 717 scoped Calendar/Routines/Event browser
specs passed in headless Edge with an explicit Europe/Berlin browser timezone.
App/spec TypeScript checks, changed TypeScript/SCSS `checkFile` checks,
translation validation, and documentation-link checks passed. The generated
translation constant is excluded from root ESLint and was verified through its
generator, formatting, and type checks.

Whole-series editing/deletion, This-and-future splitting, occurrence drag/resize,
series creation UI, Weekly Templates, and external write-back remain excluded.
This is browser/in-process validation, not a full application or multi-device
sync run. Phase 3b will supply the additional editing scopes.
