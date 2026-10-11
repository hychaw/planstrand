# Routines Phase 5b.2 — Upgrade, backup and recovery compatibility

Validation: October 11, 2026 (UTC), on `feature/v1.2-routines`, starting with a
clean tree at `a995319d50de0b7940e596ae2f0413e6c7e88fcd`.

## Release decision

Upgrade, local downgrade refusal, conditional remote compatibility, real WebDAV
files, backup restoration and the Phase 1c.2 database migration passed their
focused workflows. **Encrypted Routines operation-tail recovery remains a
release blocker.** Full-state encrypted recovery works; generic tail replay
cannot implement Routines ordering and terminal-deletion semantics. This phase
fixes its previously successful but incomplete export by refusing that replay.
It does not introduce a second domain implementation in the server.

## Environment and evidence boundaries

- Published Windows x64 **V1.1 RC1**, tag `v1.1.0-rc.1`, source
  `ef4699f5fd9e2d2d1ffe8bd1598a0b32851211e2`. The locally retained public
  `Planstrand-Portable.exe` matches published SHA-256
  `c4e4065a2841f280a18bafc566a09d9bc17565b92f8770c3b16f20ec511b8598`.
  It was extracted into a new disposable directory, without installation.
- The actual published executable and its unchanged production renderer ran.
  Browser cross-version tests also served the frontend extracted directly from
  that verified published ASAR, rather than rebuilding old source.
- V1.2 is the source candidate at the starting HEAD. Its production frontend
  was built and packaged into a new Windows unpacked directory with the existing
  **Electron 43.5.0** runtime. The normal runtime download failed certificate
  verification; using the installed runtime required no TLS or security-policy
  changes. The candidate executable ran successfully. These tests exercise an
  unpacked desktop candidate, not a new installer or public V1.2 artifact.
- Product metadata in this branch still reads **1.1.0-rc.1** and the upstream
  application/schema version remains **19.1.0 / 5**. No version branding was
  changed to label this test package as a published V1.2 release. Its actual
  IndexedDB version is **12**, versus **11** in the published V1.1 application.
- Node **22.18.0**, Chrome **155.0.8059.40**, PostgreSQL **18.4**. A newly initialized
  PostgreSQL cluster listened only on `127.0.0.1:55441`; the test-mode SuperSync
  listener used `127.0.0.1:1902`, and Angular used `127.0.0.1:4242`.
- Every native profile, browser context, account, credential, recovery key,
  database and file directory was disposable. No real Planstrand profile,
  personal cloud account, production service, release or tag was modified.

The Phase 1c semantic-reader notes and Phase 5b.1 report were read first. The
passing two-modern-client conflict workflows from Phase 5b.1 were not repeated.
This phase adds published-old-client compatibility and recovery execution.

## Upgrade and local downgrade

The published V1.1 executable created a Folder, Task, Today Planning assignment,
scheduled WorkSession and standalone Event through its visible UI, exported a
supported backup, and recorded stable Task and WorkSession IDs. The same native
profile then opened in the packaged V1.2 source candidate.

- IndexedDB upgraded from 11 to 12 before any Routines write.
- Task, Folder, Event and WorkSession persisted records and identities matched
  the V1.1 export, including after a full application restart.
- The legacy Calendar still contained exactly one Task reservation and one
  standalone Event, before and after renderer reload.
- Actual published V1.1 reopening of the upgraded, **unactivated** profile
  produced `VersionError`. The database stayed at 12. V1.2 reopened it intact.
- V1.2 then created a daily recurring Event and Weekly Template through visible
  dialogs. A full process restart and native backup export preserved exactly one
  series and one template, with the original legacy records unchanged and
  `ROUTINES_V1` retained. Stable ID arrays contained no duplicate entities.

Native execution was not blocked by Device Guard in this run. This focused
upgrade validation does not claim to rerun every Phase 5a desktop acceptance
journey or installer/uninstaller test.

## Remote cross-version boundary

An unchanged published V1.1 renderer synchronized an ordinary Task with the
actual V1.2 development client through encrypted SuperSync and PostgreSQL.
Before activation it remained compatible. An offline edit in V1.1 was then
persisted before the modern client made its first Routines write.

After activation, actual V1.1 synchronization received HTTP 409
`FULL_STATE_READER_UNSUPPORTED`; its local pending edit remained durable. A
full-state replacement request using the old client's actual reader
advertisement was also rejected. The modern client could still download its
Routines operation and durable requirement. This replacement-request check is
protocol-level HTTP coverage, not a click through an old-client force-upload UI.

A separate real-server protocol test replaces an encrypted active snapshot with
an encrypted, unactivated baseline using a modern clean-slate snapshot request.
The activating history is removed, but the account capability floor and
old-reader fence remain.
Local IndexedDB refusal is separate: it applies before activation, whereas this
remote boundary is conditional on the account's persisted feature requirement.

## File providers and backups

The actual application-managed **WebDAV provider**, Planstrand transport and file
adapter engine ran over real loopback HTTP against an isolated disk-backed DAV
test server. The server implements GET/PUT/PROPFIND/MKCOL/DELETE and conditional
ETag writes. No synchronization provider or recurrence reducer was mocked.
This is WebDAV coverage; Dropbox, OneDrive, native LocalFile IPC and commercial
cloud implementations were not exercised.

The generated files included the physical Planstrand primary and recovery
backup manifests. Workflows covered:

- Unactivated baseline; actual incremental series/template/exception operation
  upload and download; capability metadata on those operations.
- Series, moved occurrence override, template-owned series, template
  deactivation/reactivation, terminal series/template tombstones and retained
  exceptions; full-state writes, cold provider reads and restoration into a
  fresh V1.2 profile. Persisted maps and stable IDs matched.
- V1.1 native backup restored into fresh V1.2 without activating Routines.
  Active V1.2 backup restoration, re-export and restart preserved all Routines
  records. Deleted/tombstoned state also round-tripped.
- Actual local compaction after replacement with the V1.1 baseline. The
  compaction snapshot, metadata, subsequent backup and restored fresh profile
  retained `ROUTINES_V1` despite empty Routines entity maps. This is snapshot
  compaction, not an aged-operation garbage-collection stress test.
- The activated-empty state was exported through the actual V1.2 backup UI,
  including its protected full-state wrapper.
- The unchanged published V1.1 WebDAV client first used unactivated files,
  then refused both active Routines and activated-empty manifests. Its pending
  edit remained local and physical primary bytes stayed unchanged.
- The published V1.1 manual importer refused both the real encrypted-recovery
  export and the exact activated-empty UI backup. It did not silently import
  the visible ordinary-data subset.

Browser domain fixtures use the existing development store-action seam and
actual capture/apply/persistence services. Most restoration checks call the
actual BackupService directly; native seed/export and the activated-empty export
also use visible UI and the actual supported JSON format. They are not claims
of additional dialog acceptance coverage.

## Encrypted operator recovery and fixes

The supported `scripts/recover-user.ts` CLI was executed with real Prisma rows,
production encryption/decryption, generated temporary recovery credentials and
actual captured application operations. No key, token or recovery secret is
included in this report or committed fixtures.

Confirmed defects and corrections:

1. Routines tails were replayed into generic uppercase maps while normalized
   Routines slices remained unchanged; the CLI exited zero and wrote an
   incomplete result. Shared replay now throws `ROUTINES_REPLAY_UNSUPPORTED`.
   The restore HTTP route returns an explicit 400 with that code and no state.
2. A missing final target operation passed the existing leading/internal gap
   checks and yielded a partial successful export. Recovery now checks that the
   final retained sequence equals the requested target before decrypting/writing.
3. The CLI omitted batch `entityIds` and causal `repairBaseServerSeq` from its
   replay projection. It now retains both, with real encrypted CLI regression
   coverage for normalized multi-Task deletion and full-state causal REPAIR.

Encrypted full-state recovery preserved complete series, exception and template
records, stable IDs, terminal deletion tombstones and the account's capability
floor. Its output imported into fresh V1.2 and survived restart. Published V1.1
refused the protected output. Missing/wrong keys and internal/trailing sequence
incompleteness produced no successful output in the new automated CLI tests.

**Outstanding:** correct encrypted Routines operation-tail reconstruction is
not implemented. The selected replay range conservatively refuses any Routines
tail, including one preceding a later full snapshot. Recovery from a complete
retained full-state boundary works; general incident recovery requiring the
missing semantic tail remains blocked. This limitation must be resolved or
explicitly accepted as a release limitation before declaring Phase 5b.2 passed.

## Migration readiness and deployment order

All **32 migrations** applied in order to the new PostgreSQL cluster. The
existing guarded Windows helper performed the documented individual-statement
recovery for older multi-statement CONCURRENTLY migrations; no SQL was changed.
Phase 1c.2 itself applied normally.

The supported previous schema (31 migrations) was populated before applying
`20261010050000_durable_semantic_requirements`. A retained Routines operation
before the latest full-state boundary was backfilled into the account floor;
an unactivated account remained empty. The original payload and sequence
metadata survived. The real cross-version replacement test and local
compaction/backup workflows verify preservation after the upgrade.

Required production procedure (documented only; not executed):

1. Before cutover, take a consistent PostgreSQL backup containing users,
   operations, sync-state requirements, snapshots, migration history and related
   records. Preserve configured file-provider data and recovery copies too.
   Verify restoration into an isolated database and record the deployment's
   schema/application revisions. Existing erased requirement metadata cannot be
   reconstructed by the backfill.
2. Quiesce writes and pruning; retire all old server processes. Apply the normal
   migration deployment script, including its existing CONCURRENTLY recovery
   behavior. Verify the new column and the backfilled floors before resuming.
3. Start only the capability-enforcing server/shared-schema build across every
   instance. Confirm capability advertisement and old-reader/write rejection.
   Resume writes/pruning, then enable/distribute V1.2 Routines writers.
4. Do not roll back to an old server that ignores the durable floor. Prefer a
   compatible forward fix or disable new feature entry while retaining the
   enforcing server. Dropping the column or clearing requirements is not a safe
   rollback. Any database restore needs a deliberate, consistent cutover and
   accounting for post-backup writes. Upgraded local profiles cannot be opened
   by V1.1; preserve them for V1.2 or restore a separate pre-upgrade backup.

## Validation and reproduction

- Actual native published-client seed/export, candidate profile upgrade,
  unactivated downgrade refusal, UI Routines creation and full restart: passed.
- Published V1.1 encrypted SuperSync cross-version scenario: passed.
- Published V1.1 WebDAV and manual-import refusal: active and activated-empty
  scenarios passed independently.
- Actual WebDAV incremental/full-state and BackupService/UI round trips,
  compaction snapshot and encrypted operator-output import: passed.
- New actual PostgreSQL/encrypted CLI regression suite: **6 passed**.
- Focused replay and HTTP reader/restore fence suites: **36 passed**, of which
  replay/route tests use the repository's existing mocked service infrastructure.
  These are distinct from the real PostgreSQL CLI and published-client runs.

Disposable evidence and reproduction harnesses remain under `.tmp/phase5b2`:
`migrate.cjs`, `native-seed.cjs`, `native-upgrade.cjs`, `native-boundary.log`,
`native-final.cjs`, `roundtrips.cjs`, `disk-webdav.cjs`, `compat.spec.ts`,
`remote-floor.cjs`, `file-old.spec.ts`, `file-old-empty.spec.ts`, `recovery.cjs`
and their logs.
These local generated profiles, plaintext fixtures, credentials and diagnostic
traces must not be published. The interrupted native-boundary harness used an
inapplicable `planstrand-page` wait after reloading Calendar; the separate full
process restart/export subsequently verified preservation. Early harness-only
path, hydration-wait and UI-selector failures were corrected; they were not
application defects.

Run the committed focused regressions from `packages/super-sync-server`, using
the actual Node executable and `DATABASE_URL` pointing only at a migrated
disposable instance:

```text
vitest run --config vitest.integration.config.ts --maxWorkers=1 tests/integration/operator-recovery.integration.spec.ts
vitest run tests/op-replay.spec.ts tests/full-state-reader.routes.spec.ts
tsc
```

Repository-required commit checks, final commit and working-tree status are
reported with the task result. No migration schema, persisted payload contract,
release artifact or tag was changed. Phase 5b.2 stops with the explicit recovery
blocker above; no production deployment or push is authorized or performed.
