# Planstrand V1 release preparation audit

Updated 2026-10-04. The earlier RC artifacts below are superseded by the Calendar and safe custom installer corrections. No tag or GitHub Release is authorized by this audit.

## Calendar and custom destination correction (2026-10-04)

Resumed the intentional WIP on `release/planstrand-v1` from committed SHA `a76d9e0a76005b1800c27e0d8a50420677b23fba`; the external recovery backups were preserved. Read-only inspection found `Testing` stored at `2026-10-04T09:00:00Z`–`10:00:00Z`, timezone `UTC`: **2–3 AM Vancouver**, rather than 1 PM. It survived the unified projection, but Day/Week scroll near the current time left it above the viewport. The former ambiguous `1:00` badge and the runtime's incorrect local offset obscured this finding. Twelve-hour badges and tooltips now include AM/PM.

The genuine one-hour defect came from local `Date` getters on a Windows system using the new `British Columbia Standard Time` ID, which bundled ICU did not recognize. Calendar now resolves one display IANA zone (valid explicit localization, otherwise system, otherwise UTC) and carries it through date membership, civil-day boundaries, work clocks, Event/WorkSession/legacy Task rows, drag coordinates and the current-time indicator. Electron supplies the observed Windows ID's IANA identity when ICU cannot resolve it; IANA rules determine offsets. Persisted Event instants and stored zones are unchanged.

Focused Calendar validation passed 383 tests, with 37 targeted follow-up tests after final helper changes. Regressions cover persisted early UTC Events, WorkSessions and legacy Tasks in 1/7/35-day projections, Vancouver October 4 at 12:21 (grid row 149), the March 2026 spring transition and historical November 2025 repeated hour/day boundaries. The production Chrome regression confirmed Month/Week/Day membership, 2 AM placement, scrollable visibility, current-time alignment, AM/PM and reload persistence.

The assisted Windows installer restores the destination page. New/empty targets are allowed; existing installations require matching registration, identity marker, executable/uninstaller and an exact packaged-content allowlist. Unknown non-empty folders, repositories, links, unsafe `/D=` overrides and foreign prior registrations are rejected without an override button. Uninstall deletes only the compiled package file list and removes directories non-recursively, preserving unrelated additions and `%APPDATA%\Planstrand`. Custom installations retain the normal **Planstrand** Installed Apps entry and valid uninstall command. The real UI/sentinel regression is included in the existing hosted portable-smoke entry point; local executable launch restrictions are distinguished from hosted application smoke results.

Production frontend/Electron builds, unsigned Windows packaging/import checks, 16 focused release/artifact/manifest/native-zone contracts, changed-file checks and production browser verification passed. The local real-installer regression passed safe custom UI and `/D=`, unsafe UI/non-empty/prior registration, owned upgrades, Git/mixed-content refusal, Installed Apps metadata, uninstall/profile retention and root/nested sentinel survival (`.tmp/installer-safety-final.log`); the final UI helper also passed independently. Local packaged launch was blocked by Code Integrity event 3077 (enterprise signing policy); portable launch timed out. Hosted Windows smoke remains the application execution check. The stale run `37200645732` must be cancelled only after pushing the corrected source; dispatch master's RC workflow with that exact SHA and `create_draft=true`, and leave `planstrand-release` waiting for manual approval.

First corrected hosted run `37232004924` passed production build, packaging and import checks, then exposed a smoke-input race: Angular's initial empty NgModel value could overwrite text entered before binding completed. Smoke now waits for bound controls and route/view transitions, installs its running test clock before application timers, and reads the exported backup envelope correctly. The complete production-browser UI flow (including restart, restore, legacy import and zero page errors) passed with these checks; portable smoke uses the same input readiness checks. This follow-up changes test automation only and requires a fresh exact-SHA RC run.

## Initial Windows installer safety correction (superseded mitigation)

Manual RC testing selected the existing source checkout as the installation directory. Uninstall recursively removed its contents, including `.git`. Recovery from GitHub lost no pushed source or history. Safety work began from clean `release/planstrand-v1` SHA `4f5d716d26d5767e46fc40b491941575a7ec18ba` in `Planstrand-recovered`; the damaged checkout was not used. Unsafe workflow run `37195686206` is cancelled and must not supply a release.

Electron Builder's installed NSIS templates explain the failure: `assistedInstaller.nsh` appends a subdirectory only when the full path does not contain the application filename. The repository path already contained Planstrand. `multiUser.nsh` also honors `/D=` independently of the directory page; `uninstaller.nsh` recursively removes `$INSTDIR` rather than tracking individual installed files.

RC1 intentionally disables custom directory selection and uses a one-click per-user install at `%LOCALAPPDATA%\Programs\Planstrand`. `build/planstrand-installer.nsh` rejects `/D=` (including lowercase), foreign/orphaned prior uninstall registrations, and non-empty defaults without hardened-install provenance (registration, app identity marker, executable and uninstaller). The uninstaller also refuses a foreign destination or missing identity marker. Existing unhardened installations must not be upgraded/uninstalled automatically through this guard; review their contents separately. No profile deletion policy changed: ordinary uninstall retains `%APPDATA%\Planstrand`.

`e2e/electron/planstrand-installer-safety.ps1` exercises real unsigned NSIS binaries, spaces in a temporary target, root/nested unrelated sentinels, an unsafe prior registration, an unowned non-empty default, default installation/reinstallation, runtime identity/profile isolation, Start Menu/uninstall metadata, packaged application smoke and uninstall retention. It refuses a host with an existing default installation/registration and never targets source. The existing portable-smoke CI entry point invokes the complete regression, including when dispatching master's workflow definition with the corrected source ref.

Corrected local production desktop build, unsigned installer/portable packaging, packaged import verification, 14 release/Windows contracts, repository lint, changed JS `checkFile`, formatting and `git diff --check` passed. Installer-only regression passed: `/D=` and `/d=` refused; prior unsafe registration and unowned default refused; dedicated install metadata/version/shortcut, reinstallation, native `_?=` uninstall override, app file removal, retained profile and root/nested sentinels verified. Evidence: `.tmp/installer-safety-only.log`. Application launches through Playwright were blocked locally by Windows Device Guard; portable restart also timed out. No security policy was changed.

Hosted build-only verification [37199760161](https://github.com/hychaw/planstrand/actions/runs/37199760161), dispatched from `master` at safety commit `a71ecb4f7c9c18a1a30d4f804b786977f1224a5e`, passed all Windows steps, including packaged imports, application backup/legacy-import smoke, portable launch/restart/persistence and the complete installed-app safety regression (`Application smoke executed: True`). Installation launched as Planstrand with separate default profile, correct Start Menu/uninstall identity and dedicated directory; uninstall removed application files and retained profile and unrelated root/nested sentinels. Evidence is in the run's portable-smoke log. Draft creation was skipped. The final commit containing this audit changes documentation only; dispatch its exact SHA from `master` with `create_draft=true`, inspect provenance/checksums and leave `planstrand-release` unapproved. No tag or release has been created.

Branch: `release/planstrand-v1`. Verified clean base: `development` = `origin/development` = `6eab0a6204db64fafc7b027667d2d14cbd545482`. Audited application/packaging commit: `d4ec0636b4073a6a124c494621c77d779cb7d121`. The final branch SHA is the commit containing this audit; obtain it with `git rev-parse HEAD`. This final commit changes documentation only.

## Identity and compatibility

See [the surface decision table](PLANSTRAND_RELEASE_IDENTITY.md) for the pre-edit values and version evidence.

- Desktop app/bundle ID: `io.github.hychaw.planstrand`; visible product/package name: `Planstrand` / `planstrand`. Windows executable, shortcut and uninstall entry are Planstrand. NSIS uninstall GUID `f742ac0b-6794-588a-a5f8-d13e36ad8eb9` differs from upstream. Linux executable/desktop/WM class is `planstrand`; Linux/macOS builds were not exercised on their platforms.
- Desktop deep links register only `planstrand://`, avoiding upstream protocol ownership. Native mobile callback schemes remain in source and are deferred with mobile distribution. Plugin OAuth retains loopback desktop and same-origin web callbacks, requiring user/plugin-owned registrations.
- Default Windows data is `%APPDATA%\Planstrand`, set before settings/backup IPC initialization. IndexedDB/profile storage, settings and local backups use this isolated profile. No live upstream profile import. Explicit `--user-data-dir` remains available and must name a separate directory.
- Technical version remains **19.1.0**; public release/tag is **Planstrand v1.0.0-rc.1** / **v1.0.0-rc.1**. Backup/sync schemas have separate versions, but update comparisons use application versions and Android has inherited monotonic native versioning. Reset safety was not proven; no cosmetic migration was added. Public 1.x tags require manual download checks while technical version is 19.x.
- Preserve `SUP_OPS`, legacy `pf`, `SUP_*` localStorage keys, schema/model versions, backup/sync file namespaces, historical compatibility fixtures and workspace/plugin API identifiers. Use a separate sync destination/account and web origin.
- Preserve source-only Android `com.superproductivity.superproductivity`, Capacitor/iOS `com.super-productivity.app`, Share Extension/app-group identifiers and native callback schemes. Package namespaces, OAuth, entitlements and store ownership must be handled together before mobile distribution.
- Inherited Dropbox default credential and bundled Google Calendar OAuth defaults were removed. Their authorization flows are deferred until Planstrand-owned credentials exist. No upstream provider ownership is borrowed. Production hosted SuperSync is not supplied; configure a server you control.

## Repository, licensing and workflow

Repository/homepage/bugs/update-download links target `hychaw/planstrand`. Builder automatic publishing is disabled; release configuration cannot target `johannesjo/super-productivity`. README is Planstrand-specific and acknowledges the independent Super Productivity fork without endorsement.

The original MIT LICENSE and `Copyright (c) 2018 Johannes Millan` are unchanged. The packaging allowlist includes the root LICENSE, verified inside the final application. Desktop/PWA icons use an existing neutral calendar asset; store-grade artwork is a follow-up.

[release-planstrand.yml](../.github/workflows/release-planstrand.yml) is manual-only, takes an explicit ref and guards `hychaw/planstrand`. Default behavior builds/uploads unsigned Windows x64 installer/portable, checksums and source SHA; `--publish never` is used. Optional draft creation is a separate environment-gated job using `--draft --prerelease`. It records/embeds the checked-out SHA, not the dispatch event SHA. Syntax/contracts, local equivalent builds and corrected GitHub-hosted verification passed as recorded above. No upstream secrets or store uploads are required.

## Original Windows artifacts and packaged smoke (superseded)

Final local artifacts are ignored files under `.tmp/app-builds/`; binaries are not committed.

| Artifact                |     Bytes | SHA-256                                                          |
| ----------------------- | --------: | ---------------------------------------------------------------- |
| Planstrand-Setup.exe    | 125390569 | 502b7bdacfc585d010a020789b1a1a8a4b40fd9ee194231848bb5f58e177db68 |
| Planstrand-Portable.exe | 125179035 | 82b20c8fac25cc4b05e87d40caf0267381d797f0b54d90f69e4264b6dc6bb985 |

Both are unsigned (`NotSigned`); Windows SmartScreen/unknown-publisher warnings are expected. Local binaries used the final packaging inputs and have local embedded revision `NO_REV`. The workflow stamps its checked-out revision. Final audit documentation does not require rebuilding.

- **Installer passed:** installation, executable/product/title/first Today route, shortcut/uninstall metadata; Folder, Task, Today planning, WorkSession, Event; process restart/persistence; UI backup export and clean-profile restore; legacy v10 backup import. Evidence: `.tmp/rc-smoke/run-8onQKQ/result.json` and `install-metadata.json`.
- **Portable passed:** real launcher, Folder/Task, process restart and persistence. Evidence: `.tmp/rc-smoke/portable-855opP/result.json`.
- **Default profile/uninstall passed:** `%APPDATA%\Planstrand` confirmed; final uninstall exit 0 removed executable, shortcut and uninstall entry while retaining profile data/sentinel. Evidence: `.tmp/rc-smoke/default-profile.json` and `final-uninstall.json`. Test profile data remains intentionally.
- **Side-by-side:** structural isolation verified through distinct GUID, protocol/application identity, profile and install naming. Super Productivity was not installed on this host, so literal two-installed-app coexistence was not tested. This is a useful follow-up, not an RC blocker.
- The host reports an unknown OS timezone; scheduling automation used UTC through Chromium's timezone override. Users need a valid OS timezone. No product/timezone behavior was changed.

## Migration and validation

Migration path: export a full Super Productivity backup, retain an independent copy, import into a clean Planstrand profile and verify converted data. No live-profile migration subsystem was added.

Packaged backup export/restore and Super Productivity v10-compatible import passed. Existing legacy Project-to-Folder, independent Planning and timed Task-to-WorkSession migration validation passed **87 tests**. Backup service validation passed 55 cases with v10/v13/v18 fixtures. Google Calendar package validation/typecheck passed, including the credential-removal regression check.

Production frontend/Electron build and Windows packaging passed. Generated `.tmp` content is excluded from stylesheet linting. Targeted release/native/Windows/Linux/profile contracts, packaged imports, Electron identity/protocol/backup/settings/tray checks, update checks and relevant Planstrand tests passed. Modified root TS passed `checkFile`; root-excluded plugin files used formatting/package typecheck/tests. Normal commit lint hooks passed. Final docs links, workflow contracts, formatting and `git diff --check` are checked again for this audit; packaging/smoke and the historical full E2E/sync matrix are not rerun.

Nonfatal production warnings: initial bundle budget, unused RouterLink and legacy browser support. No persistence schemas, sync semantics or product features changed.

## Deferred work and remaining manual actions

Initial RC is desktop/web-first with validated Windows x64 artifacts. Mobile/Play/App Store identities and distribution, Microsoft Store, Snap/Flathub, macOS signing/notarization/store publishing and wider native platform validation are deferred. No Planstrand signing credentials are configured; signing requires owned credentials later.

1. Review this audit, [release notes](releases/PLANSTRAND_V1_RC1.md), [checklist](PLANSTRAND_RELEASE_CHECKLIST.md) and artifact checksums. This task pushes the reviewed release branch only; no merge/tag/release.
2. Configure required reviewers for GitHub environment `planstrand-release` before optional draft creation.
3. Dispatch from `master` at the final reviewed SHA with `create_draft=true`; inspect CI artifacts, smoke results, checksums and source provenance. Leave the draft environment waiting; final manual visual approval remains separate.
4. After explicit final approval, create `v1.0.0-rc.1` tag/draft prerelease in `hychaw/planstrand` (optionally through the draft job). Publishing is a separate manual decision.
