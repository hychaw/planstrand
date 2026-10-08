# V1.1 visual redesign review

Branch: `feature/v1.1-blue-thread`. Base: `0644294`.
This pass does not merge to development or alter `v1.0.0-rc.1`.

## Presentation

- Existing Blue Thread tokens now drive a restrained static sky canvas, navy/ice working surfaces, softer borders, editorial headings, and consistent menus/dialogs. The small project-owned `sky-route.svg` works offline. Mobile uses a solid canvas. Reduced motion remains supported.
- The floating desktop sidebar pairs the flowing Strand P vector with the Planstrand wordmark. Primary navigation is Today, This Week, Tasks, Calendar. Search, Settings, and More remain secondary.
- Inbox is a special capture destination beneath Folders, linked to `/inbox`; it is no longer a primary menu item. Its existing sentinel/domain semantics remain intact. Folder creation uses the refined “Folders +” heading.
- Tasks preserves `/master-tasks` internally while displaying “Tasks”. Inbox comes first, followed by the complete recursive Folder hierarchy in one working surface. Indentation, disclosure, small icons, and subtle nested tint replace decorative connectors. Existing capture, commands, nesting, and drag/drop remain available. Empty Folder drop zones retain usable geometry during drag.
- Today separates active Focus, Unplanned, and Completed presentation, with My Day beside the plan on desktop. The narrower layout switches between Plan and Schedule. Reordering translates visible active-task positions back to the full Planning order, including completed tasks, through the existing single command boundary.
- This Week uses an Anytime section and editorial Monday–Sunday groups with date markers. Desktop uses two columns; narrow screens use one. Empty days show a quiet dash. There are no connecting routes or repeated explanatory empty messages.
- Calendar has an integrated date/navigation/view/New Event bar, soft Month grid and current-day treatment, matching Day/Week/Year surfaces, blue creation preview, stronger WorkSession cards and softer Events. Existing type icons and leading-edge widths provide non-color distinctions. The preview accurately offers WorkSession scheduling or Event creation. Work Start/End defaults off; saved explicit preferences remain respected.
- Settings retains its existing search, tabs, forms, and architecture inside a new shell and surface language. Appearance remains under General. Comfortable and Compact remain device-local. Event fields and shared dialogs use the same surfaces and focus treatment.

## Main implementation locations

- `src/styles/blue-thread.scss`, `src/app/app.component.scss`, `src/assets/sky-route.svg`, `src/assets/icons/strand-p.svg`
- `src/app/core-ui/magic-side-nav/` and `src/app/pages/planstrand/`
- `src/app/features/schedule/` and `src/app/features/event/dialog-event/`
- `src/app/pages/config-page/`, `src/app/core/theme/theme-selector/`
- `src/app/features/config/default-global-config.const.ts`, `src/assets/i18n/en.json`
- `docs/DESIGN_SYSTEM.md`, `e2e/tests/planstrand/`

## Naming and attribution audit

Changed user-facing Master Tasks to Tasks, Day schedule to My Day, and task creation preview wording to its actual supported actions. Settings feedback and desktop download links now point to Planstrand. CalDAV, OpenProject, and WebDAV help describe the actual Planstrand origin instead of an upstream hosted origin. Anonymized export copy no longer directs Planstrand support data to an upstream email address.

Retained upstream licenses, support acknowledgement, genuine plugin authorship, browser-extension naming/links, upstream changelog and privacy links (explicitly labelled upstream), OneDrive protocol identifiers, and legacy storage-path examples. No blind replacement was performed.

## Validation

- Relevant Angular unit suites: **139 passed**, covering Planstrand commands/selectors, sidebar, theme, Settings, schedule, Folder persistence/encoding, and Event/calendar projection. Run with the repository's `Europe/Berlin` test timezone.
- Full lint: passed, including TypeScript/templates, SCSS, CSS variables, and local tool checks.
- Full production frontend build: passed, including all 24 bundled packages. Final Angular production rebuild passed after presentation changes.
- Planstrand browser suite: **13 passed**. Covers actual task/Folder drag/drop, recursive Folder operations, keyboard capture/actions, Planning, WorkSession move/resize/unplan/reload, Event drag/resize/all-day/offline persistence, navigation, themes, density, and responsive layouts. The new completion/reordering check verifies persistence without duplicated Tasks. Calendar gesture helpers center targets inside the scrollable grid before dragging to accommodate the taller header.
- Legacy full-backup migration browser fixture: **1 passed**, preserving Tasks, Projects, Tags, sync configuration, and archives.
- Additional browser visual review: **1 passed**; captures Today, Tasks, This Week, Calendar Day/Week/Month/Year, Settings, and Event editor in light/dark, both densities, desktop 1500 px and representative 1024/768/390 px layouts. Narrow layouts were checked for horizontal overflow. Review captures are local artifacts under `.tmp/redesign-*.png`, not shipped screenshot assets.
- Browser validation used installed Chrome because bundled Playwright Chromium is absent. Its context timezone was explicitly set to match the suite's selected `Pacific/Guadalcanal` timezone; Windows otherwise returned an invalid system timezone to calendar APIs.

## Boundaries and remaining limitations

Schema stays at version 5. No persisted domain, NgRx, operation-log, IndexedDB, sync, or normalized Calendar projection rewrite was made. WorkSession completion remains independent of Task completion. Legacy-data migration, persistence unit coverage, and browser reload/offline scenarios provide compatibility evidence; live multi-device server sync was not rerun for this visual pass.

The production bundle is 5.67 MB, exceeding the 5.50 MB warning threshold by 174.49 kB; it builds successfully. Browserslist also reports inherited Chrome 107 outside Angular's supported range. These are not addressed by this presentation pass.

Low-priority More screens retain inherited structure. No new persisted inspector, screenshot-only controls, or speculative attachments feature was introduced. Existing advanced theme/wallpaper settings remain available. Work Start/End markers can still appear for previously saved enabled preferences. New copy is provided in English with the existing fallback mechanism; additional locale translation is outstanding. Validation used Chrome, not a cross-browser matrix.
