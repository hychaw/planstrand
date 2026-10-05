# Development CI baseline

Starting point: `chore/ci-baseline-cleanup` at
`c8aba65b1dc914953073d1dd31afe45f9ca4df51`, the development merge of PR #6.
The checkout was clean. PR #6 changed repository configuration and activated
previously dormant development checks; it did not change product TypeScript or SCSS.

## Original failure inventory

Evidence: PR #6 CI run 37244812178, server run 37244812172, and sync run 37244812174.
The failed logs were reviewed before editing expectations.

| Category                       | Original result                                                    | Classification and response                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stale product expectations     | 10 guard fallbacks and 4 Android fallback expectations             | Canonical fallback is `/today`; explicit legacy Today still resolves to `/tag/TODAY/tasks`. Preserve both behaviors.                                                                                                                                                                                                                                        |
| Angular harness/model fixtures | 27 board, 27 repair, 2 day-panel, enum and compaction model checks | Missing WorkSession/Schedule methods, missing Event fixture/coverage mapping, and pre-Event enum cardinality. Update fixtures without relaxing invariants.                                                                                                                                                                                                  |
| Sync-client integration        | Hydration/compaction and 4 archive replay cases                    | Snapshot-service mocks omitted Folder and WorkSession backfill. Keep real IndexedDB/reducers and recovery assertions.                                                                                                                                                                                                                                       |
| Date fixture                   | Non-scheduled repeat overflow placement                            | UTC offsets were added to elapsed durations and applied twice to the starting instant. Pin Berlin instants and a full work-day duration; remove this case's timezone skip.                                                                                                                                                                                  |
| Product defect                 | 4 Android canonical-start exit regressions                         | Top-level destination recognition omitted Today, Inbox, Master Tasks and This Week. Add the routes; retain the enum-wide exit invariant.                                                                                                                                                                                                                    |
| Server PostgreSQL              | 15 failed, 82 passed across 5 files                                | Live-upload fixtures still used schema 1 despite the schema-5 ingress floor. Historical database rows stay historical. The remaining 5-versus-8 assertion measures heap fetches, not sequence counts. Appended tuples invalidate the last seed page's visibility; pad with ordinary rows before VACUUM while retaining the exact 5-fetch budget.            |
| WebDAV                         | 23 failed, 38 passed                                               | Current physical paths are `planstrand-sync-*`, with protocol-4 product/capability envelopes for both single and split layouts. Upstream v16 data requires explicit adoption; automatic destructive force-overwrite is unsupported. Rewrite that scenario to prove no remote mutation and local-data preservation. Remaining races require hosted evidence. |
| SuperSync E2E                  | Shards 1, 2, 3, 4, 6 failed; 5 passed                              | Removed `/work` and `/work-view` routes fall through to primary navigation; legacy project/tag navigation closes and Today can render multiple projections of a task. Use supported context task routes. Align example-task copy with current onboarding. Keep convergence, switching, conflict and replay coverage.                                        |
| Local infrastructure           | Windows timezone and shell differences                             | Chrome can report no IANA system zone here. Linux shell tests also require Bash and LF scripts. Use hosted Linux checks for CI-equivalent proof; do not change gates around workstation limitations.                                                                                                                                                        |

## Scope and validation

No test suite is removed, disabled or made optional. Development branch filters,
required gates, synchronization semantics, database migrations and release tags are
unchanged. Android back navigation is the only product-code change so far.

Focused Angular validation repaired the original failing files. A full local run
reported 16,934 passing and two system-timezone diagnostic failures, with 19 existing
timezone-dependent skips. Hosted Linux validation remains authoritative for both
configured timezone passes. Server validation/service unit tests passed (201 tests)
and the server TypeScript build passed. Root `checkFile` passes for modified app and
E2E TypeScript; it intentionally refuses the five server spec paths, which use the
package's formatting/build/test validation instead.

Hosted results and final totals will be recorded after the PR checks finish.
