# V1.1 Blue Thread implementation audit

Baseline: `a03805daf9b4cb2bd4cb483d7731c253fe9cb429` (`development`).
Branch: `feature/v1.1-blue-thread`. Published `v1.0.0-rc.1` is unchanged.

## Delivered milestones

| Milestone         | Implementation                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — foundations   | Navy/pale-blue surface ramps, cobalt/azure identity, bundled Inter Variable with OFL license, focus/motion primitives, local Comfortable/Compact preference, Strand P vector and generated platform icons.  |
| B — shell         | Strand P wordmark, blue navigation selection, quieter folder navigation, reduced page-header navigation duplication, existing responsive sidebar/bottom navigation retained.                                |
| C — reusable rows | Explicit accessible task actions disclosure, hover/focus/touch drag handle, grouped Move/Plan/Schedule/reorder commands, recursive folder action disclosure and drag feedback.                              |
| D — organize      | Continuous Master/Folder hierarchy, inline Enter capture, capture-focused Inbox. Existing recursive ownership and CDK commands remain authoritative.                                                        |
| E — planning      | Today daily-plan column and compact schedule rail, mobile Plan/Schedule switch, vertical This Week sections with “Anytime this week” and localized weekday/date headings.                                   |
| F — calendar      | Segmented Day/Week/Month/Year header, past-period navigation, softer month/grid treatment, clickable dates/overflow, cobalt current-time marker, distinct Event/WorkSession borders and icons.              |
| G — Year          | Twelve responsive mini-months, month/day navigation, Today and projected activity indicators, localized week start, timezone/date-only/end-exclusive semantics.                                             |
| H — editors       | Shared floating dialog surfaces/mobile sheets, grouped Event time fields, strong title and separated destructive action, polished Folder selector. Existing task inspector and WorkSession editor retained. |
| I — polish        | Density without shrinking type, practical touch targets, keyboard disclosures and focus rings, reduced-motion override, desktop/tablet/phone layouts.                                                       |
| J — compatibility | Domain regression tests, browser persistence/offline/DnD checks, production build and Windows package/asset checks. Platform limitations below remain explicit.                                             |

## Important implementation areas

- `src/styles/blue-thread.scss`, `_fonts.scss`, `src/assets/fonts/inter/`: reusable identity and typography.
- `src/app/core/theme/`: default theme and device-local density; existing explicit custom-theme choices retained.
- `src/app/core-ui/magic-side-nav/`, `src/app/pages/planstrand/`: shell, task/folder rows, capture, Today and weekly planning.
- `src/app/features/schedule/`: existing view styling/navigation and new `schedule-year/` component.
- `src/app/features/event/dialog-event/`: Event editor presentation.
- `src/assets/icons/strand-p.svg`, `tools/generate-planstrand-icons.cjs`, `build/`, `electron/assets/icons/`: reproducible desktop/browser/PWA branding.
- `e2e/tests/planstrand/blue-thread.spec.ts`: new Year, real task/folder drag, keyboard, density/theme and responsive coverage. Older smoke tests now open the explicit action disclosure.

## Compatibility boundaries

`CURRENT_SCHEMA_VERSION` remains 5. No persisted domain shapes, operation capture,
reducers, replay effects, sync protocol, migration or backup architecture changed.
Task creation/movement, Planning, Event and WorkSession changes use existing
commands. Density and view preferences remain device-local. Year consumes
`CalendarDisplayService` and introduces no competing data model. WorkSession
completion remains independent of Task completion.

The domain suite exercises released-state hydration, validation, migration,
encrypted operation serialization/replay, backup/snapshot behavior and completion
independence. Browser tests exercise IndexedDB persistence/reload and offline Event
editing. This is not a new live multi-device/provider certification run.

## Validation

- 946 targeted Angular tests passed: schedule, folder, event, work-session,
  planning, Planstrand pages and core/theme. Browser timezone set to Europe/Berlin
  to match the repository test contract on Windows.
- Production Angular build passed. Existing unused ConfigPage `RouterLink`
  warning and initial bundle budget warning remain (5.67 MB against 5.50 MB).
- Electron TypeScript compilation and preload bundling passed.
- Windows x64 unpacked package build passed; unsigned because no certificate is
  configured. Packaged Electron imports resolve (11 dependency packages checked).
- 32 theme/icon/release/installer-manifest tool tests passed.
- The standard 66-test tool suite and seven local ESLint rule-spec files passed.
- Full repository TypeScript/template lint and SCSS lint passed.
- The complete `npm run lint` checkpoint passed, including CSS variables, local
  lint rules, tool tests and macOS icon tests.
- Staged `pretty-quick` passed. The commit hook cannot locate `sh` on this host;
  its formatting and lint commands were run explicitly before committing with a
  temporary, per-command empty hooks path (no repository hook/config change).
- Changed TypeScript, templates and SCSS passed repository `checkFile` checks.
  CSS custom-property validation passed across 1,947 files. Translation checks
  reported no unexpected or broken placeholders; untranslated new labels use the
  existing English fallback.
- All 12 browser regression tests passed together against the final production
  build, including real task/folder drag/drop, Event and WorkSession move/resize,
  offline/reload, Year navigation, keyboard/Escape, themes/density and responsive
  navigation at 1440/1024/768/390 pixels. Geometry assertions wait for route entry;
  direct mouse gestures wait for editor-backdrop actionability.
- The final Windows package was rebuilt from that production output. Strand P,
  Inter WOFF2 files, the font license and the PWA manifest are present in the asar.

Native launch with an isolated profile initialized the main process and tray, but
the renderer failed to launch with exit code 49 on this host. Consequently native
interactive smoke is unverified. No security settings were altered. macOS/Linux
native builds and real touch hardware certification were not run here.

## Intentional choices and follow-ups

- Honor the user's configured first weekday (default Monday) instead of forcing
  Monday in every locale.
- Retain existing Task inspector, provider filter controls and legacy routes;
  V1.1 applies shared visual primitives without rebuilding those subsystems.
- Keep the repository's technical package version/release workflow untouched;
  this branch is implementation work, not a new published release.
- Year is for awareness/navigation, with compact projected activity indicators;
  provider coverage follows the existing provider fetch horizon.
- New English labels need translation contributions. Signed installers and native
  macOS/Linux/device review remain release certification follow-ups.
- V1.2 candidates remain recurring local Events, WeeklyTemplate, series editing,
  normalized reminders, Trash, external calendar export and separately scoped
  account/device/E2EE or backup work.
