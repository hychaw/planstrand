# Routines Phase 5c — Final UI refinement and native review

Reviewed October 11, 2026, from clean `feature/v1.2-routines` at
`687c0ace8ba41cae8dc9de7de1513a6d68c179b7`. Read the Phase 5a findings first.
All writes used disposable Chrome contexts or new native-profile paths under
`.tmp`; no personal profile was opened. No recurrence/exception semantics,
persistence, synchronization, navigation architecture or release metadata changed.

## Confirmed issues and minimal fixes

- Long unbroken template/entry names overflowed the management content at every
  review width. At 320px the content was 1,529px wide inside a 307px dialog. Names
  and entry Edit buttons now wrap; wrapped buttons retain their natural height.
  The nested Event editor's template-owner label also now wraps. The regression
  checks the actual scroll container, because the host's width hid this overflow.
- Event and template validation summaries were live alerts but had no association
  with their form groups. Conditional `aria-describedby` now associates the
  summaries with the relevant fieldsets. Browser accessible-description assertions
  cover both forms. This is group-level feedback, not field-specific error wording.
- Destructive text in these dialogs used the project warning red directly in dark
  mode: `rgb(225,24,38)` against `rgb(24,46,75)`, approximately **2.85:1**. Both
  dialogs now use the existing Blue Thread `--button-warn-label` token. Browser
  checks require at least **4.5:1** in light and dark themes.
- The inherited picker-icon inversion inverted Chromium's native dark-scheme
  date/time icons twice, making them black on navy. These two editors now leave
  the native icon uninverted. Final dark screenshots show visible white icons.
- Entry summaries read, for example, `90 Duration (minutes)`. They now use the
  existing translated minutes formatter, producing `90 minutes` in English.

The Phase 5a toolbar-height and separator fixes remain intact. No new translation
keys or languages were added.

## Workflows reviewed

Browser UI journeys exercised daily, weekly and monthly timed recurring Events;
intervals, multiple weekdays, inclusive end dates and explicit IANA timezones;
This occurrence, This and future and Entire series; override restoration;
cancellation and toolbar restoration; declining/accepting exception retention
while preserving the draft; and cancelling/confirming whole-series deletion.
Calendar occurrence presence was asserted after the relevant commands.

Template coverage included creation/rename, invalid and inclusive date bounds,
multiple all-day/timed entries, invalid intervals, inactive entry editing,
activation/deactivation/reactivation, start-bound changes, overlapping active
templates, and entry/template deletion confirmations. Long-name stress used nine
entries. The surviving template and standalone data remained independent.

Limited existing-app smoke covered Folder/Task creation, Task title editing and
reload after the existing asynchronous save settled, Today/This Week planning,
WorkSession scheduling/completion, one-off Event creation/editing, Calendar
Day/Week/Month/Year navigation, light/dark themes, and navigation/Utilities/App
menu keyboard behavior. No Phase 5b synchronization or upgrade audit was repeated.

## Desktop, responsive and accessibility results

| Width  | Result                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1440px | Two-column template management; long labels and entry controls wrap.                                                                  |
| 1024px | Compact desktop controls and editors remain contained.                                                                                |
| 768px  | Two-column management remains usable; content scrolls vertically.                                                                     |
| 390px  | Management stacks; nested editor and confirmation actions remain reachable.                                                           |
| 320px  | Long-label stress, recurrence validation and cancelled-occurrence content remain contained; actions remain reachable at 650px height. |

The matrix checks toolbar access with ordinary clicks, actual dialog-content
overflow, scroll reachability, validation visibility and confirmation actions.
Screenshots were inspected at desktop, tablet and narrow widths. No separate mobile
UI was introduced. Long lists use the existing vertical scrolling.

Nested-editor Tab/Shift+Tab traversal stays inside the top dialog. Escape returns
focus to the entry's Edit trigger; closing management returns focus to the Calendar
toolbar. Cancelled-occurrence restoration returns toolbar focus. Confirmation
Cancel returns focus to its destructive-action trigger. Weekday checkboxes retain
implicit labels and a fieldset legend. Destructive actions retain confirmation.
No clipped primary actions or obstructed toolbar controls remained in these checks.

This is automated keyboard/accessibility-tree and screenshot coverage, not a full
screen-reader or physical touch-device certification. Native popup selection,
physical DPI changes and software-keyboard behavior remain manual checks.

Reviewed the English Event and Weekly Template strings, including scope help,
exception retention, inclusive bounds and permanent-deletion warnings. The only
wording correction was the duration summary above. All **27 non-English locale
files** currently lack the **55 Event** and **16 Weekly Template** family keys and
use the established English fallback. This is reported coverage, not translated
UI validation; no translations were manufactured.

## Validation and evidence

- Final focused Chrome suite: **4 passed, 40.3 seconds** — the two new responsive
  journeys, existing Weekly Templates journey and focused shell/Utilities smoke.
  New checks live in `e2e/tests/calendar/routines-responsive.spec.ts`.
- Affected component suites: **66 passed** — weekly-template-ui,
  series-creation-ui and series-editing-ui.
- App and component-spec TypeScript checks passed. Changed UI files and the new
  browser spec passed `checkFile`; `git diff --check` passed.
- Translation tool tests: **21 passed**; all 27 locale files validated with no
  new blocking placeholder/brace defects. Existing fallback/baseline differences
  remain informational.
- Stage Angular compilation, Electron compilation and Windows directory packaging
  passed. Packaged dependency verification passed for all 11 required packages.
  The existing initial bundle warning remains: 5.60 MB against 5.50 MB.
- Local evidence: `.tmp/phase5c-browser-final-candidate.log`,
  `.tmp/phase5c-tests/`, `.tmp/phase5c-component-final.log`,
  `.tmp/phase5c-edit-smoke-final.log`, and `.tmp/phase5c-smoke/run-Zgn2Fy/`.
  The last path records the limited browser-adapted desktop journeys; it is not
  native evidence. Test setup issues with clocks, transition timing, explicit
  timezone defaults and immediate reload were corrected before final validation.

## Native Windows result

Built using the individual supported stages documented in Phase 5a, including
package builds, stage Angular compilation, license preparation, Electron build,
and `electron-builder --win --dir --publish never
--config.electronDist=node_modules/electron/dist`. Installed Node 22.18.0 was used
directly because the sandbox's Volta shim tried to download it again. No TLS or
machine security protections were disabled.

The final candidate is `.tmp/app-builds/win-unpacked/Planstrand.exe`. Attempted
launch with `.tmp/phase5c-final-native-profile` failed before application startup:

> An error occurred trying to start process 'D:\How Yee Data\GitHub Projects\Planstrand\Planstrand\.tmp\app-builds\win-unpacked\Planstrand.exe' with working directory 'D:\How Yee Data\GitHub Projects\Planstrand\Planstrand'. An Application Control policy has blocked this file.

The exact exception is saved in `.tmp/phase5c-native-launch.log`. Playwright's
native runner also reported `Error: Process failed to launch!`. This is an
environment execution-policy rejection, not an observed application exception.
**Native visual/restart/persistence/DPI verification did not pass and is not claimed.**

Packaging reports no signing certificate configured. The repository's
`docs/release-and-publishing.md` documents unsigned Windows packages and defers
signing. No documented policy-approved alternate execution path was found in the
reviewed build/runbook configuration. No credentials were provisioned, executable
renamed, alternate executable used to evade policy, policy changed, or release
workflow dispatched. Native sign-off needs a machine where this development build
is permitted, or a separately authorized signing/trust process.

## Remaining issues by priority

1. **Release verification blocker:** native launch, final visual review and
   same-profile restart remain blocked by Application Control.
2. **Important manual verification:** actual Windows date/time popup interaction,
   physical DPI/resizing, complete screen-reader traversal and overlapping timed
   Event readability at the user's display scale. Browser-width checks are passed;
   they do not substitute for these native checks.
3. **Cosmetic/localization coverage:** routine strings fall back to English in the
   non-English locales above. The existing bundle warning remains informational.

No unresolved reproducible routines UI defect remains in the exercised browser
workflows. Phase 6 version metadata and release work are excluded.

## Short Windows manual checklist

On a machine permitted to run the development build, from the repository root:

```powershell
& ".\.tmp\app-builds\win-unpacked\Planstrand.exe" "--user-data-dir=$PWD\.tmp\phase5c-manual-profile"
```

- Use a fresh disposable profile. Create a one-off and daily/weekly/monthly Events;
  vary all-day/timed, interval, weekdays, end dates and timezones. Open the actual
  date/time popups; inspect overlapping timed labels in light and dark themes.
- Edit each scope. Override and restore an occurrence; cancel and restore through
  the toolbar. Decline then accept exception retention. Cancel then confirm series
  deletion and ensure the preserved draft/confirmation wording is clear.
- Create two overlapping templates with long names and several entries. Rename,
  change inclusive dates, edit while inactive, activate/deactivate/reactivate,
  and cancel/confirm entry/template deletion.
- Resize through the five review widths at normal and high DPI. Tab/Shift+Tab
  through nested dialogs, use Escape/Cancel, and check focus restoration, validation
  announcements, scrolling and reachable Save/Cancel actions.
- Create/edit a Task, schedule/complete a WorkSession, visit Today/This Week and
  use navigation/Utilities. Close normally, reopen the **same disposable profile**,
  and verify overrides, cancellations and template states without duplicate Events.
- If Application Control rejects launch, retain the exact error and obtain an
  administrator-approved execution/signing path; do not disable protections.

Phase 5c stops here. Nothing was pushed, deployed, published or tagged.
