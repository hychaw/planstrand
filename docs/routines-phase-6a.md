# Routines Phase 6a — RC1 release readiness

**Phase 6a.2 follow-up:** supported Task/Event recovery remains **P1 / unresolved**.
Real encrypted CLI diagnostics also exposed successful but incomplete Task create
and delete results (missing initial Planning; stale project membership). The
operator now refuses unimplemented generic tails instead of returning those
backups. This is a safety correction, **not completion of Task/Event replay**.
See [Phase 6a.2](routines-phase-6a2.md) for evidence and the required client
replay/archive integration. Current recommendation remains **NO-GO for Phase 6b**;
native Windows sign-off is also incomplete. Historical assessments follow.

**Phase 6a.1 follow-up:** the supported Folder recovery P1 below is resolved by
the validated client-reducer operator path documented in
[Phase 6a.1](routines-phase-6a1.md). The original Phase 6a assessment is preserved
below as historical evidence. Current recommendation remains **NO-GO for Phase
6b**: native Windows sign-off is incomplete, and the wider unimplemented Task/Event
tail cases described in Phase 6a.1 remain a material recovery coverage gap. The
Folder-specific correction does not approve that broader recovery contract.

Assessed October 11, 2026 UTC. **NO-GO for Phase 6b**: final native acceptance
is incomplete, and supported Folder history has a material operator-recovery gap.
No product fix or release metadata update was made.

## 1. Source and scope

- Branch: `feature/v1.2-routines`.
- HEAD: `b0575382b19cf26319fc96f0ba4cd8dab4a1d59b` (matches requested HEAD).
- Working tree was clean before assessment; this report is the only new file.
- Reviewed [5a](routines-phase-5a.md), [5b.2](routines-phase-5b2.md),
  [5b.3](routines-phase-5b3.md), [5c](routines-phase-5c.md), both historical
  RC1 release notes, and [release instructions](release-and-publishing.md).
- No production access, deployment, push, merge, tag, workflow dispatch or release
  modification. Published V1.0/V1.1 releases and retained artifacts were untouched.
  No correction commit; HEAD remains as above.

## 2. Native Windows diagnosis and result

The retained `.tmp/app-builds/win-unpacked/Planstrand.exe` was inspected without
launching or rebuilding it. Phase 5c's recorded failure is a Windows process-start
rejection: **“An Application Control policy has blocked this file.”** It occurs
before application startup, so it is not an observed renderer/domain exception.

| Inspection                     | Result                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Authenticode                   | `NotSigned`; no signer certificate                                                                       |
| Product / description          | `Planstrand` / `Planstrand`                                                                              |
| Company                        | `How Yee Chaw`                                                                                           |
| File / numeric product version | `1.1.0` / `1.1.0.0`, expected before Phase 6b                                                            |
| Packaged package.json          | `planstrand`, `Planstrand`, `1.1.0-rc.1`                                                                 |
| Executable size                | 238,134,272 bytes                                                                                        |
| SHA-256                        | `debec14b0b940307b0f7e033614cb4e0ab6839d01f7959ce4737c3e2e4e15569`                                       |
| Alternate data streams         | Only `:$DATA`; no `Zone.Identifier` present                                                              |
| Embedded frontend revision     | Contains Phase 5c starting SHA `687c0ace8ba41cae8dc9de7de1513a6d68c179b7`; does not contain current HEAD |

Read-only Device Guard CIM and Code Integrity event-log queries were denied by
Windows. The precise policy, publisher/hash rule, trust classification, and
whether this is enterprise WDAC versus another Application Control mechanism
cannot be established with current access. Absence of a download-zone stream
does not establish trust. Unsigned status is consistent with the documented
packaging configuration; it is a plausible trust factor, not proof of the exact
blocking rule. No packaging metadata mismatch was found.

The Planstrand release workflow explicitly builds **unsigned** packages, sets
`CSC_IDENTITY_AUTO_DISCOVERY=false`, and has no signing-service step or owned
certificate provisioning. `signAndEditExecutable: true` permits resource editing;
it does not supply a certificate. The retained SignPath metadata helper targets
upstream `Super-Productivity-Setup` artifacts and is not an authorized Planstrand
signing workflow. Do not repurpose upstream credentials.

The existing GitHub `windows-latest` workflow is a supported future automated
package-smoke environment, but was not dispatched and does not replace physical
native visual/DPI review. No currently accessible policy-approved V1.2 executable
or alternate approved Windows review machine was established. The previous
successful Phase 5b.2 native upgrade run does not approve the final Phase 5c UI.

**Native result: incomplete.** No identical blocked binary was relaunched. No
security protection, trust setting, filename or signing credential was changed.
The retained package also lacks current-HEAD provenance, so it must not be used
as exact-current-source sign-off even on a permissive machine.

## 3. Recovery-format release assessment

The original encrypted **Routines** tail defect was resolved by Phase 5b.3;
that evidence is retained without rerunning its PostgreSQL matrix. The remaining
refusals are fail-closed, not silent successful partial exports.

| Case                                        | Actual support boundary                                                                                                                                                                                                                                                                                                                          | RC1 decision                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folder operation tails                      | Normal Add/Update/Move/Remove actions in `src/app/features/folder/store/folder.actions.ts` emit persistent singleton `FOLDER:*` Update envelopes containing `folderState`. `op-replay.ts` unconditionally rejects every FOLDER row, including with the operator Routines adapter.                                                                | **P1 recovery blocker**, not unsupported legacy data. If all client recovery points/copies are unavailable and the necessary retained range includes a Folder operation, the supported CLI cannot reconstruct that user's otherwise supported history.                                                                                 |
| Markerless REPAIR                           | Shared replay refuses absent causal bases. Current client repair code can generate these outside a valid sync context or after that context is withdrawn. Current normal SuperSync upload sends REPAIR with `isCleanSlate=false`, so a missing base is rejected as `REPAIR_STALE`; the server retains a legacy clean-slate compatibility branch. | **Documented conservative limitation** for retained noncausal/legacy history; do not describe it as exclusively old client data. It cannot safely be treated as an authoritative full replacement. Any affected incident requires a complete supported client/full-state backup; its recoverability remains unproven if none survives. |
| Unknown/future or invented Routines formats | V1.2 emits the validated single-register actions with empty `entityChanges`. Invented multi-entity batches, partial compensation, future schema/action vocabularies and malformed envelopes are outside that contract.                                                                                                                           | **Acceptable fail-closed boundary** for RC1, not permission to skip a supported operation or silently export its subset.                                                                                                                                                                                                               |

The CLI selects all retained operations at or below the target, validates
contiguity, and replays them in sequence. An unsupported prefix still fails even
if a later valid snapshot exists. A full-state backup is a valid alternative only
when it actually contains the desired complete data and can be restored through
a supported path; simply selecting a later CLI target does not bypass that prefix.
Folder records already inside snapshots survive, but that does not cover Folder
changes after the snapshot or arbitrary retained-prefix reconstruction.

The [operator runbook](../packages/super-sync-server/docs/backup-and-recovery.md)
prefers surviving clients/local recovery points, then offers server recovery when
none survives. The Folder gap is historically documented in Phase 4 and 5b.3,
but those alternatives are conditional, not a guarantee for this last-resort
case. Under this phase's supported-data recovery requirement, it remains material.
No replay rewrite or lossy workaround was attempted. Resolution needs either a
separately validated semantic recovery path or an explicitly reviewed, narrower
release recovery contract and concrete backup requirements; this report does
not silently accept that risk.

## 4. Release configuration and exact Phase 6b edits

- **Version source to edit:** `planstrand-product.json`, from `1.1.0-rc.1` to
  `1.2.0-rc.1`. `src/app/util/planstrand-product-version.ts` imports this directly
  for About/Settings/update comparisons. `tools/planstrand-product-build.cjs`
  derives packaged version and numeric Windows build version from it.
- **New release notes to add:** `docs/releases/v1.2.0-rc.1.md` (required by release
  tooling). Include IndexedDB downgrade refusal, conditional remote Routines
  compatibility, server/migration ordering, unsigned execution restrictions and
  the final resolved/accepted recovery scope.
- **Current-release documentation to update:** `docs/release-and-publishing.md`
  when V1.2's actual preparation/publication state warrants it; preserve the
  historical V1.0/V1.1 notes and evidence.
- **Generated, not hand-versioned:** regenerate ignored
  `src/environments/versions.ts` during the build with the reviewed SHA; rebuild
  frontend, Electron, executable resources and artifacts. Record matching
  `SOURCE_SHA.txt`, `SHA256SUMS.txt` and `release-manifest.json`.
- **Do not bump:** root `package.json`/`package-lock.json` compatibility version
  `19.1.0`, schema version 5, or server package `1.0.0` just to label this product
  RC. IndexedDB is already 12; no further database bump is indicated.

Windows identity remains `io.github.hychaw.planstrand`, product/shortcuts remain
Planstrand, and icons use `build/icon.ico` (existing Strand P artwork). No identity,
icon, installer naming or workflow version edit is required. Distribution names
remain `Planstrand-Setup.exe` and `Planstrand-Portable.exe`; workflow artifacts
are scoped as `Planstrand-v1.2.0-rc.1-windows-x64`.

`release-planstrand.yml` requires an exact reviewed SHA, matching existing RC tag,
notes and confirmed absence of a release; it fails on existing releases or lookup
failure. Optional creation is a new draft prerelease with `--latest=false`, never
an edit/upload to old releases. V1.2 can therefore be prepared independently of
V1.0/V1.1. Tag creation/dispatch/publication still require a later phase.

Electron publishing remains disabled. Desktop update checks use Planstrand's
GitHub `/releases/latest` and link to downloads; no automatic installation or
separate RC feed is configured. RC discovery must use explicit release links.
Build tooling pins Node 22.18.0, npm 11.18.0 and Electron 43.5.0. The server Docker
build/runtime uses Node 24 Alpine. These configurations were inspected, not
newly certified across runtimes. Operator recovery needs the full checkout and
root dev dependencies, not just the production image.

## 5. Server deployment/migration readiness

**Documentation/source ready; production readiness not asserted or exercised.**
The server's numeric package version is not a sufficient compatibility test.
Use the reviewed branch's enforcing server/shared-schema source (including
Phase 1c.2 and 5b.2 fixes), which advertises `ROUTINES_V1` and persists/enforces
the account floor. Do not infer that an arbitrary server labelled `1.0.0` suffices.

`20261010050000_durable_semantic_requirements/migration.sql` is included and adds
`user_sync_state.required_capabilities`, backfilling from retained operations.
The server Dockerfile copies the migration tree; startup migrations default off.
Phase 5b.2 already verified all 32 migrations and the prior-schema upgrade.

The documented production order is adequate: verified consistent backup and
isolated restore rehearsal; quiesce writes/pruning and retire old instances;
apply migrations with the supported deployment script; verify column/backfill;
start only compatible enforcing instances; verify advertisement and old-reader/
writer rejection; resume service; only then distribute/enable Routines writers.
There is no feature switch here that makes premature client distribution safe.
Backfill cannot recover already erased capability evidence.

Rollback must retain capability enforcement: prefer a compatible forward fix,
never clear floors/drop the column or restore an old ignoring server. Database
restore requires consistent cutover and accounting for later writes. V1.1 cannot
open an IndexedDB-12 profile even before Routines activation; keep a separate
pre-upgrade backup. No production endpoint or database was accessed.

## 6. Checks and remaining gates

- **23 release-contract tests passed** across `verify-planstrand-release`,
  `planstrand-release`, `verify-windows-artifact-contract` and
  `verify-linux-wm-class`; no workflow dispatched.
- Retained ASAR dependency verification passed for all **11 packages**.
- No broad unit suite, browser journey, rebuild or PostgreSQL matrix repeated.
- **P1:** exact-current-source native acceptance and physical Windows review.
- **P1:** supported Folder-history last-resort operator recovery gap above.
- **Conditional recovery limitation:** retained markerless REPAIR; investigate
  affected history before promising recovery, never reinterpret or skip it.
- Existing English fallback and bundle warning remain informational; no new
  reproducible product defect was established that warrants a small code fix.

## 7. Approved-environment native sign-off procedure

1. Have the administrator inspect the blocked file's hash and Code Integrity
   event at the Phase 5c failure time using approved administrative tooling.
   Establish an approved testing machine or owned signing/trust process. Keep
   all protections enabled; do not rename executables or use alternate launchers
   to evade the rejection.
2. On that environment, build the reviewed source using Phase 5a's documented
   individual stages with a valid OS timezone. Use a new output directory,
   `--publish never`, and matching revision metadata. Keep previous artifacts.
   Verify About's build SHA and packaged imports before accepting results.
3. From the repository root, run the committed native journey runner:

   ```powershell
   node e2e/electron/routines-desktop-smoke.cjs <approved-build>/Planstrand.exe --review
   ```

   It allocates a fresh `.tmp/routines-desktop-smoke/run-*/profile`, asserts the
   user-data path/revision, and checks same-profile restart. Follow its printed
   `review.done` procedure only after review; retain results and screenshots.

4. Separately launch with a unique disposable path for physical review:

   ```powershell
   $reviewProfile = Join-Path $PWD ('.tmp/phase6a-manual-' + [guid]::NewGuid())
   & '<approved-build>/Planstrand.exe' "--user-data-dir=$reviewProfile"
   ```

   Create daily/weekly/monthly timed and all-day recurring Events; vary weekdays,
   interval, inclusive end and timezone. Exercise This occurrence, This and
   future, Entire series, override/restore, cancel/restore, exception-retention
   decline/accept and destructive confirmations. Create/edit/activate/deactivate/
   reactivate/delete Weekly Templates and entries, including overlapping ones.

5. Inspect Day/Week/Month/Year, overlapping labels, actual Windows date/time
   popup selection, Tab/Shift+Tab trapping, Escape/Cancel and focus restoration.
   Test light/dark themes, wide/narrow windows and physical 100/125/150/200% DPI
   where available; record actual Windows scale and display configuration.
6. Leave an override, cancellation and inactive template. Export; close normally;
   reopen with **the same `$reviewProfile`**; compare records/IDs and capability
   metadata, occurrence visibility and template states. Check no duplicates or
   generated Tasks/WorkSessions/Planning entries. Installer/portable acceptance
   remains part of the later release workflow, also with disposable profiles.

If launch is blocked, stop and retain the exact error, hash and environment;
native sign-off remains incomplete. Browser results cannot close this gate.

**Final recommendation: NO-GO for Phase 6b until both P1 gates are closed.**
The version/configuration and server procedure are prepared, but neither
incomplete native verification nor unsupported recovery of ordinary Folder
operations can be represented as satisfied release-critical checks.
