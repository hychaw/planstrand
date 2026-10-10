# Routines Phase 5a — Desktop integration validation

Validated October 10, 2026, starting from clean `feature/v1.2-routines` at
`2290e0ee4f4fbee0d7e2cd09f88c3559e738ffde`. Reviewed the Phase 3a3, 3b1,
3b2, 3c and 4a notes. All test writes used fresh disposable Electron profiles
or isolated Playwright browser contexts. No real user profile was opened.

## Confirmed fixes

- At the default Windows window size, the Calendar utilities wrapped onto another
  row, but the flex layout shrank the toolbar underneath the sticky day header.
  Ordinary clicks on Cancelled occurrences and Weekly Templates were intercepted.
  Keeping the toolbar's natural height fixes both controls. The browser regression
  now exercises both buttons at an 800px viewport before the template journey.
- Template state, date ranges and entry schedule summaries displayed corrupted
  UTF-8 separator text. Replaced the affected literals with HTML entities, including
  the template date range in the Event dialog. The browser test rejects the broken
  characters and captures a narrow management dialog for visual inspection.

No model, synchronization, recurrence, ownership or exception policy changed.

## Application journeys and evidence

The new `e2e/electron/routines-desktop-smoke.cjs` runner launches the packaged
Windows application, asserts its actual user-data path and build revision, writes
domain data through UI controls, and reads UI-created backup exports for assertions.
It fixes the application clock to October 5, 2026 in Europe/Berlin. It never imports
backups or invokes reset. Test profiles, exports, screenshots and results stay under
`.tmp/routines-desktop-smoke/run-*`.

The packaged run `run-qkXELU` completed these ten automated journeys after the
toolbar fix:

1. Folder/Task creation, Today planning, This Week navigation, WorkSession
   scheduling/completion and a one-off Event.
2. Daily, weekly and monthly recurrences, each all-day and timed; multiple weekdays,
   weekly interval two, duration/timezone and optional inclusive end bounds.
3. Occurrence title/date override, cancellation, toolbar restoration and restored
   keyboard focus.
4. This and future, Entire series, declining and accepting exception-retention
   consent while preserving the draft.
5. Whole-series deletion with cancellation/confirmation and a persistent cancellation.
6. Template creation/rename, invalid dates and intervals, multiple entries, editing
   while inactive and entry deletion with confirmation.
7. Activation/deactivation/reactivation with equal Calendar DOM identity, template
   start-bound changes and overlapping active templates.
8. Template permanent deletion with cancellation/confirmation, with the surviving
   template and standalone Events unaffected.
9. Day/Week/Month/Year navigation, narrow dialogs, scroll reachability, Escape and
   focus restoration.
10. Export comparison proving no generated Tasks, WorkSessions, Planning memberships,
    Folder records or permanent Event instances.

The process then closed, restarted with the same profile, and exported its persisted
data. Its initial equality assertion stopped because the existing Folder housekeeping
flag `legacyProjectMigrationComplete` appeared on restart. A subsequent comparison
of those saved exports passed for Task, WorkSession, Planning, Event, EventSeries,
OccurrenceException and WeeklyTemplate slices, plus Folder IDs and records. The
runner now excludes only that Folder bookkeeping flag. This is evidence of record
and exception-key preservation; the subsequent post-restart Calendar assertions
in the corrected runner have **not** completed on the final build.

The native screenshots were visually inspected for the wrapped toolbar, management
layout and scrollable timed entry editor. One narrow management capture was taken
during its opening transition, so it is not a settled-layout approval. Captures now
disable animations. The final Chrome screenshot at 390px shows a readable, contained
management dialog and corrected separators. This is screenshot inspection and
automated interaction, not a complete human Windows accessibility review.

## Validation results

- Final focused Chrome Calendar/template journey: **1 passed**, 8.5 seconds, against
  the prepared stage application. Includes activation visibility, inactive entry
  editing, Day/Week/Month/Year, ordinary utility clicks, keyboard focus and 390px layout.
- App and spec TypeScript checks: passed (`src/tsconfig.app.json` and
  `src/tsconfig.spec.json`). Stage Angular compilation also passed.
- `checkFile`: passed for both changed HTML templates, Calendar SCSS, browser spec
  and native smoke runner.
- Required commit hooks: passed full lint, CSS-variable validation, seven lint-rule
  spec files, 67 tooling tests and 12 icon checks.
- Translation tool tests: **21 passed**; all 27 locale files validated with no
  blocking placeholder/brace defects. Existing missing keys use English fallback.
- Prepared Windows build and packaged dependency check: passed. The stage bundle
  retains an initial-size warning (5.60 MB against the 5.50 MB warning threshold).
- The final packaged native smoke run is **blocked**, not passed: Windows reports
  that `Planstrand.exe` was blocked by the organization's Device Guard policy.
  No security settings were changed or bypassed. Earlier packaged execution and
  restart succeeded; final native visual/restart sign-off remains outstanding.

## Build and launch

The normal frontend prebuild stalled on a package-local dependency installation.
The established build stages were run individually using the installed workspace
dependencies:

```powershell
node tools/git-version.js
npm run sync-core:build
npm run sync-providers:build
npm run shared-schema:build
npx --no-install ng build --configuration stage
node tools/publish-licenses.js
npm run removeWOFF1
npm run electron:build
npx --no-install electron-builder --win --dir --publish never --config.electronDist=node_modules/electron/dist
node tools/verify-electron-requires.js .tmp/app-builds/win-unpacked/resources/app.asar
```

The local Electron distribution was used because the default packaging download
failed certificate validation. TLS verification was not disabled. The prepared
development directory is `.tmp/app-builds/win-unpacked`; this milestone did not
produce a new installer, portable release or signed release. Its About revision is
the starting HEAD above, with the two source fixes included in its compiled frontend.

On a Windows machine where the development executable is permitted, from the
repository root, launch **with the disposable-profile argument**:

```powershell
& ".\.tmp\app-builds\win-unpacked\Planstrand.exe" "--user-data-dir=$PWD\.tmp\v1.2-manual-profile"
```

After rebuilding with the current revision metadata using the steps above, run the
native automation with a new automatically isolated profile. The runner deliberately
checks the About revision against HEAD; the already prepared directory still reports
the starting revision:

```powershell
node e2e/electron/routines-desktop-smoke.cjs
```

Add `--review` after the executable path to pause for native visual inspection after
all assertions. Create `review.done` inside the printed run directory to finish.

## Remaining checks, in priority order

1. **Release verification blocker:** complete the corrected native runner and final
   visual review on a Windows machine permitted to launch the development build.
   Device Guard rejection is an environment/build trust issue, not evidence of a
   recurrence defect. No final native pass is claimed.
2. **Manual UI review:** native date/time picker popups, full Tab/Shift+Tab focus
   traversal, timed event overlap readability and physical high-DPI resizing. The
   automated journeys fill the native inputs but do not exercise OS picker dialogs.
3. **Localization:** new routine labels retain the established English fallback in
   locales without translations. No new locale regressions were introduced.

## Short Windows manual checklist

- Launch with the disposable profile above. Create one-off and daily/weekly/monthly
  Events; include timed/all-day schedules, multiple weekdays, interval and end bounds.
  Navigate Day, Week, Month and Year; inspect overlapping timed labels.
- Edit/move one occurrence; cancel it and find Cancelled occurrences to restore it.
  Try This and future and Entire series. Decline then accept exception retention;
  confirm invalid drafts remain editable. Cancel then confirm series deletion.
- Create a template with two entries. Edit an entry while inactive. Activate,
  deactivate and reactivate; change template dates; add an overlapping template.
  Cancel then confirm entry/template deletion and check standalone Events survive.
- Resize wide/narrow and at your normal DPI. Tab/Shift+Tab through both nested
  dialogs; Escape should restore trigger focus. Open date/time picker popups and
  check scrolling, clipping, scope labels and validation feedback.
- Schedule/complete a WorkSession and use Folder/Task/Today/This Week navigation.
  Leave an override, cancellation and inactive template; close/relaunch with the
  **same disposable profile**. Confirm preserved state and no duplicate occurrences
  or extra Task/WorkSession/Planning records.

Phase 5a stops here. Multi-client synchronization and V1.1 upgrade testing were not run.
