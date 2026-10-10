# Routines Phase 5b.1 — Real SuperSync synchronization

Validation started October 10, 2026 on clean `feature/v1.2-routines` at
`53053c6ecbb26306d0a83d1c1f6929d5a23b01da`.

## Environment and evidence boundaries

- Actual PostgreSQL **18.4**, using the existing portable binaries with a new
  cluster under `.tmp/phase5b1/postgres`, listening only on `127.0.0.1:55440`.
  Docker was unavailable. All **32 migrations** were applied and recorded,
  including Phase 1c.2 `20261010050000_durable_semantic_requirements`.
- Prisma's documented multi-statement `CONCURRENTLY` migration failure was
  handled using the existing guarded Windows migration helper: execute the
  migration's index statements individually, record it, and resume deployment.
  No migration SQL or compatibility contract changed. See the migration README
  for the repository's equivalent `scripts/migrate-deploy.sh` recovery path.
- Actual SuperSync server built from this checkout, loopback HTTP port **1901**,
  test mode, disposable credentials, and the fresh database. Node **22.18.0**;
  Angular development server on loopback port **4242**; Chrome **155.0.8059.40**.
- Independent Chrome contexts A/B have separate client identities, IndexedDB,
  localStorage and vector clocks. Both use the actual Angular capture/apply
  services, encrypted SuperSync provider and real HTTP endpoints. Domain edits
  use the existing dev-only store-action seam; this is synchronization evidence,
  not another UI-dialog or packaged-desktop acceptance test.
- The unchanged production recurrence projection is bundled into each test
  page to assert canonical occurrence identities from received persisted data.
  No recurrence algorithm or synchronization provider is mocked.
- Offline editing uses real browser-context offline mode. Missing-parent cases
  upload actual child operations before parent operations through the server.
  Duplicate **download** delivery is explicitly simulated: the test fetches a
  real HTTP response, then repeats its operations. The PostgreSQL compatibility
  scenario separately verifies actual duplicate-upload idempotence.
- No production server, actual Planstrand profile, published tag, release or
  deployment was accessed or modified. Per-test accounts are removed in cleanup.

## Focused workflows

`e2e/tests/sync/supersync-routines.spec.ts` covers four scenarios:

1. Daily, weekly and monthly series; a moved/title override; cancellation from B;
   restoration from A; a This-and-future segment plan; Entire-series title edit;
   terminal series deletion; a bounded template with two entries; deactivation,
   reactivation and template deletion. Both application renderers restart in
   their existing independent profiles and reconstruct equal persisted records.
2. Offline conflict batch with A uploading first: different occurrence edits,
   cancellation against an edit of the same occurrence, concurrent monthly and
   weekly schedule plans, series deletion against a late update and exception,
   and template deletion against an independent entry edit. Then missing-parent
   delivery, simulated duplicate download, convergence and restart.
3. The same conflict batch with B uploading first, exercising the opposite
   arrival order rather than relying on the local timestamp winner's upload order.
4. Real provider full-state replacement through the existing encryption-password
   change path, verified as a single server `SYNC_IMPORT` boundary; fresh B
   recovery of overrides, cancellations, inactive template entries and a deleted
   series; automatic local compaction across the production 500-operation
   threshold using 501 actual persisted edits; subsequent bidirectional sync and
   restart. Recent operations remain within retention, so this exercises snapshot
   compaction, not aged-operation garbage collection. The final assertions inspect
   local semantic metadata, snapshot capabilities and a non-empty replay tail.

Every convergence check compares persisted entity maps, ID arrays and production
occurrence projections. Exception IDs retain their JSON lineage/slot encoding;
occurrence IDs remain `eventOccurrence:<lineage/slot key>`. Deleted series and
deleted/inactive template owners contribute no occurrences. No duplicate entity
IDs or projected occurrence IDs are allowed. Tasks, WorkSessions, Planning and
permanent Events are compared against the empty-account baseline.

Independent exceptions and entry edits must survive. Same-occurrence and schedule
conflicts use the existing whole-value deterministic ordering. Series/template
tombstones remain terminal even against a later edit; late exceptions and owned
entries remain stored without resurrecting visible occurrences.

The existing `routines-compatibility.integration.spec.ts` also ran against this
migrated PostgreSQL instance and actual HTTP listener. It verifies ordinary-data
access before activation, duplicate operation storage exactly once, activation,
blocked unsupported downloads/uploads without consuming pending operations,
and retention of the durable account capability floor after a clean-slate
replacement removes the activating operation and omits requirements.

## Confirmed correction

The initial browser run failed before data synchronization because the shared
SuperSync page helper tried to click Sync inside a closed Utilities popover.
The helper now opens Utilities when needed. Sync status icons are conditionally
created/removed by Angular, so their attachment determines state even when the
popover closes. Completion still requires a newly observed successful ops HTTP
response, the remote-confirmed status and a drained pending-operation log.

No application, server, recurrence, conflict policy or compatibility machinery
has needed modification.

## Validation status

- Expanded real two-client browser run: **4 passed**, 4.9 minutes. After
  strengthening both sides of the schedule conflict and adding direct local
  metadata/snapshot/tail assertions, the affected scenarios were rerun:
  **3 passed**, 3.1 minutes. These are four distinct browser scenarios, not seven.
- Existing real HTTP/PostgreSQL compatibility scenario: **1 passed**, 1.03 seconds.
  Total focused coverage: **5 distinct integration scenarios**. No earlier
  Routines unit suites or broad synchronization suites were repeated.
- All persisted maps and canonical occurrence identities converged. Independent
  exceptions and entry edits survived; terminal tombstones did not resurrect;
  cancellation/restoration and template visibility remained correct. No generated
  Task, WorkSession, Planning or permanent Event records appeared.
- Real full-state replacement, fresh-client reconstruction, automatic local
  compaction and subsequent persisted snapshot-tail replay passed. `ROUTINES_V1`
  remained in both clients' semantic metadata, the compaction snapshot and the
  server requirement advertisement. Unsupported readers remained blocked; the
  unactivated-account compatibility scenario passed without Routines requirements.
- File-quality checks passed for both changed TypeScript files. E2E-tree
  TypeScript checking passed with repository-root `baseUrl` supplied by a temporary
  config wrapper. Plain `e2e/tsconfig.json` retains an existing unresolved
  `src/app/core/util/vector-clock` alias error, reproduced with the new spec
  excluded; no unrelated compiler configuration was changed.
- No Routines application/server regression was found. Only the shared test
  helper required correction. There is **no new Phase 5b.1 release blocker**.

Required commit hooks passed full lint, CSS-variable validation, lint-rule
specifications, tooling tests and icon checks. The disposable SuperSync,
PostgreSQL and frontend services were stopped after validation. Local disposable
data and diagnostics remain under `.tmp/phase5b1` for reproduction. The excluded
native-release validation below remains outstanding.

## Reproduction and diagnostics

Use a fresh disposable database, apply migrations with the existing server
migration deployment/recovery script, and start the test-mode server and frontend.
Set `E2E_REQUIRE_SUPERSYNC=true` so an unavailable server fails instead of skips.

```powershell
$env:E2E_BASE_URL = 'http://127.0.0.1:4242'
$env:SUPERSYNC_E2E_URL = 'http://127.0.0.1:1901'
$env:E2E_REQUIRE_SUPERSYNC = 'true'
npx playwright test --config e2e/playwright.config.ts e2e/tests/sync/supersync-routines.spec.ts --project chromium --workers 1 --reporter line
```

On this host the existing `.tmp/weekly-templates.playwright.config.ts` selects
installed Chrome and disables global setup/dev-server startup, since both servers
were already running. The installed Node executable was invoked directly to avoid
the sandbox's Volta download attempt. The real database compatibility test runs
from `packages/super-sync-server` with `DATABASE_URL` set only to the disposable
instance:

```text
vitest run --config vitest.integration.config.ts --maxWorkers=1 tests/integration/routines-compatibility.integration.spec.ts
```

Local diagnostics live under `.tmp/phase5b1`: migration history, server build and
request summaries, browser run logs, PostgreSQL compatibility output and focused
quality checks. Shared report/commit content contains no tokens or passwords.
Failure traces are local test artifacts and must not be published with credentials.

Phase 5b.1 stops here. The previous Phase 5a final native validation remains
outstanding; this browser/provider milestone does not resolve its Device Guard
blocker. Packaged V1.1 upgrades, file providers, encrypted operator recovery and
all other explicitly excluded validation remain separate work.
