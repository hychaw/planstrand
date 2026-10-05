# GitHub Actions

Planstrand uses `development` as its default integration branch. Retained validation workflows target that branch where they have branch filters. No store or hosted-service deployment is active.

| Workflow                     | Classification and purpose                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                     | Current CI: dependency/lockfile review, lint, unit/Electron/E2E/PWA tests, web build and Lighthouse.                                        |
| `codeql-analysis.yml`        | Current security scanning.                                                                                                                  |
| `docs-links.yml`             | Current documentation and source-reference checks.                                                                                          |
| `e2e-scheduled.yml`          | Current regular, WebDAV, SuperSync, server and released-client compatibility tests. Services run locally on the runner.                     |
| `e2e-sync-pr.yml`            | Current sync-provider PR gate.                                                                                                              |
| `supersync-server-tests.yml` | Current server, Helm and PostgreSQL contract checks.                                                                                        |
| `plugin-tests.yml`           | Current plugin and shared API tests.                                                                                                        |
| `electron-smoke.yml`         | Useful cross-platform validation: unpublished Linux packaging and startup/persistence smoke. This does not imply a validated Linux release. |
| `android-tests.yml`          | Useful future platform validation: native JVM/emulator checks. No store publishing.                                                         |
| `pr-preview-build.yml`       | Current web build check; artifact only, no deployment.                                                                                      |
| `release-planstrand.yml`     | Current manual Windows RC validation/build flow, with an optional draft step behind the `planstrand-release` environment.                   |

The release workflow still names RC1 explicitly. RC1 is already public: do not use its draft step to recreate or replace that release. A future release requires separate reviewed release work. See the [release runbook](release-and-publishing.md).

Optional Unsplash keys in build/test workflows belong to configured integrations; the checks do not require inherited deployment credentials.

## Removed and retained historical configuration

Obsolete disabled store, web, container, wiki, preview deployment and community automation definitions were removed. Their history remains in Git.

One disabled upstream definition remains under `.github/workflows-disabled/upstream/supersync-docker.yml`: the server migration contract test reads its migration ordering. It is a test fixture outside the active workflow directory and cannot run as GitHub automation. Removing that dependency needs a separate test change.

## Repository settings

Maintainers should verify private vulnerability reporting, branch rules for `development` (including code-owner review for sensitive paths), external-contributor workflow approval, and the existing `planstrand-release` environment's reviewers/branch restrictions. CODEOWNERS alone does not require review. This document does not assert that these settings are enabled.
