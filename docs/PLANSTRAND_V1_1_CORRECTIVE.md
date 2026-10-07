# Planstrand V1.1 corrective pass

Baseline: `cc81011106569838e517153940f60f3a27914c50` on `feature/v1.1-blue-thread`.
No merge, release retag, schema change or domain redesign belongs to this pass.

## Background and shell

The canvas uses the project-owned, static `src/assets/sky-atmosphere.svg` (about 3 kB): soft blue sky depth, cloud banks, high-altitude haze and a distant aircraft with restrained contrails. Theme-specific veils preserve contrast. Small mobile screens use a simple gradient. No screenshot, mountains, slogans, network image service or continuous animation is shipped.

The floating sidebar retains Strand P plus Planstrand when expanded. Its collapsed reservation is now 88px, with a 72px inner rail, centered navigation icons and an intentionally positioned expand button. Icon-only navigation retains explicit accessible names and hover titles. Primary destinations remain Today, This Week, Tasks and Calendar. Inbox remains special capture under Folders/Tasks. Recursive Folder and weekly Planning hierarchy stay intact, without decorative connectors.

Global tracking, capture, focus, counters, sync, plugins, work context and secondary-panel controls remain mounted once inside Utilities. A quiet trigger replaces the inherited always-visible icon strip. Escape, light-dismiss and a close control dismiss the popover. Counter reminders and plugin lifecycle are preserved.

Task hover is tinted/elevated, focus adds a blue edge, keyboard focus has an accessible outline, drag previews are raised, and receiving task lists have blue drop feedback. Idle rows do not glow. Shared dialogs now use the current Material surface tokens as well as the legacy bridge, avoiding gray Event editors.

## Task to My Day regression

Two defects broke the redesigned task list's integration with the existing scheduler:

1. `PlanstrandTaskListComponent` never registered its CDK Task/DragRef with `ScheduleExternalDragService`.
2. The timeline drop zone used `height: 100%` within a fixed-height scroll viewport. The 24-hour grid overflowed it; later visible hours were outside the hit-test bounds after scrolling.

The task list now registers and clears scheduling drags through that existing service. The drop zone grows with its full grid. The scheduler recognizes the new task-entry preview wrapper. A successful scheduler drop cancels the source list's placement callback; a pointer outside a task list cannot also emit a Planning or Folder move. `WorkSessionService.scheduleTask` remains the only scheduling path, preserving estimate/default duration, Task completion independence and normalized calendar projection.

The browser regression performs a real pointer drag into My Day, checks exactly one WorkSession, unchanged Task completion and Planning placement, then reloads and checks persistence. Unit coverage checks registration, cleanup and duplicate destination suppression. Existing Folder, Planning, Event and WorkSession drag/resize coverage passes.

Idle creation previews now clear when the pointer leaves the grid and stay off existing calendar items. An open inline editor remains intact. Preview wording continues to describe WorkSession scheduling and the separate Event action; the preview/current-time styling stays blue.

## Working-hour marker compatibility

Calendar and My Day previously selected inherited persisted `isWorkStartEndEnabled`. Changing the default to false did not affect restored data containing the old true default.

`WorkingHoursDisplayService` gates rendering behind an explicit device-local Appearance setting (`PLANSTRAND_SHOW_WORKING_HOURS`). Its default is off. The old schedule flag, configured times and scheduling behavior remain intact. No synced config or schema field is added.

A restored legacy backup test verifies Tasks migrate, the old true flag is retained, both Day and Week hide markers, explicit opt-in survives reload and enables both markers, and opting out hides them again without deleting legacy configuration.

## Branding assets

The existing ribbon master `src/assets/icons/strand-p.svg` now actually generates all raster/desktop assets. The previous pass updated the master but left old raster artwork in use.

- Electron BrowserWindow: regenerated `electron/assets/icons/icon_256x256.png`.
- Windows executable: `build/icon.ico`, containing 16/24/32/48/64/256px Strand P resources; explicit builder path.
- NSIS installer, uninstaller and header: explicitly use the same multi-size ICO.
- Browser/PWA: favicon, touch/tile and manifest sizes regenerated; Safari uses an opaque monochrome strand mask.
- macOS: regenerated iconset and ICNS, with corrected inset for the 64px master viewBox.
- Actual system tray: `electron/indicator.ts` loads the separate `indicator/stopped-*`, `running-*` and progress-frame families. Every family now uses a simplified Strand P with 16px/32px pairs; running/progress adds a small status marker. The tray GUID, event wiring and timer lifecycle are unchanged.

No upstream authorship or legal attribution was falsified or removed. This corrective pass replaces stale imagery and adds precise utility/working-hour copy; it does not perform broad product-name replacements. Genuine Super Productivity plugin authorship, credits and licenses remain.

## Validation

- Targeted Angular suites: 161 passed covering Planstrand, external scheduling entry points, WorkSessions, weekly drag, main header and navigation; five ScheduleWeek component tests also passed, including preview dismissal.
- Electron tray unit tests: 10 passed, including actual asset-family dimensions and paired high-DPI artwork.
- Full lint passed: TypeScript/templates, SCSS, CSS-variable checks, lint-rule tests, tools and 12 macOS icon tests.
- Production frontend build passed (all bundled packages built first); final Angular production build passed. Electron TypeScript/preload build passed.
- Final Planstrand browser suite: 16 passed, including Task to My Day scheduling/reload, repeated sidebar collapse/expand at 1600/1024px, Utilities access/Escape, restored working-hour opt-in, recursive Folder/task moves, Planning, Event drag/resize/offline CRUD, WorkSession move/resize/reload, light/dark, density and representative mobile/tablet layouts.
- Legacy full-backup migration: passed separately, preserving Tasks, Projects, Tags, sync configuration and archives.
- Windows unpacked build passed using the installed Electron runtime. Binary verification confirmed every ICO image payload is embedded in `Planstrand.exe`.

### Actual Electron checks

An isolated `.tmp/corrective-electron-profile` was used; the normal user profile was untouched. The production frontend was loaded by real Electron, without browser-only substitution. Native checks covered task focus, Task drag into My Day, resulting WorkSession, restart persistence, Calendar WorkSession move, My Day resize, Day/Week/Month/Year, Event creation, expanded/collapsed navigation, Utilities, Settings, light/dark and Comfortable/Compact. Narrow desktop/tablet layout was inspected separately. The runtime log confirms Windows Tray creation with the actual indicator path family present.

## Remaining verification limits

- The Windows shell notification area/taskbar could not be independently captured through the available window-scoped native automation. Actual Electron startup and tray creation were checked; tray artwork and high-DPI pairs were tested. A visual tray check at multiple Windows DPI settings remains outstanding.
- The unpacked executable was built and its embedded icon verified. An NSIS install/uninstall round trip and Windows icon-cache refresh were not performed; installer/uninstaller paths are explicitly configured.
- No signing certificate was configured for this local package. No release was published.
- The production bundle remains above its existing 5.50 MB warning threshold (5.68 MB total); Chrome 107 Browserslist support also warns. Neither warning blocks the build.
- Live multi-device server sync, a cross-browser matrix, macOS runtime and Linux runtime were not rerun. Domain schema, persistence, sync and operation-log architecture remain unchanged. New copy uses the existing English fallback; translation is outstanding.
