# GitHub Actions

Planstrand inherited GitHub Actions from the Super Productivity repository. The active set is limited to validation that is useful to this codebase and does not publish releases, deploy applications, mutate upstream services, or require upstream private deployment credentials.

## Active workflows

| Workflow | Purpose |
| --- | --- |
| `android-tests.yml` | Runs Android JVM, instrumentation, compatibility, and packaged-launch checks. |
| `ci.yml` | Checks the lockfile, reviews dependency changes, lints, runs unit/Electron/E2E/PWA tests, builds the web app, and runs Lighthouse. Lighthouse results are not sent to temporary public storage. |
| `codeql-analysis.yml` | Runs CodeQL JavaScript analysis and reports results to this repository's GitHub security scanning. |
| `docs-links.yml` | Checks local documentation links, images, and source references. |
| `e2e-scheduled.yml` | Runs regular, WebDAV, SuperSync, server, and released-client compatibility E2E coverage. Services are local to the runner. |
| `e2e-sync-pr.yml` | Gates relevant pull requests with SuperSync and WebDAV E2E coverage. Services are local to the runner. |
| `electron-smoke.yml` | Packages an unpublished Linux Electron directory and tests startup, task creation, and persistence. |
| `plugin-tests.yml` | Runs tests for changed plugin packages and their shared plugin APIs. |
| `pr-preview-build.yml` | Builds a pull-request web preview and stores it only as a GitHub Actions artifact. It does not deploy the preview. |
| `supersync-server-tests.yml` | Runs SuperSync server unit, Helm-rendering, and local PostgreSQL integration tests. |

Some retained build and E2E workflows accept optional `UNSPLASH_KEY` and `UNSPLASH_CLIENT_ID` values. They do not require store, signing, hosting, container-registry, wiki, or upstream automation credentials.

## Disabled upstream workflows

Disabled definitions are preserved under `.github/workflows-disabled/upstream/`, outside the directory GitHub Actions scans for workflows.

- Release and packaging: `build.yml`, `build-android.yml`, `build-create-windows-store-on-release.yml`, `build-ios.yml`, `build-ios-testflight.yml`, `publish-ios-testflight.yml`, `build-publish-to-mac-store-on-release.yml`, `build-publish-to-snap-on-release.yml`, `manual-build.yml`, and `test-mac-dmg-build.yml`.
- Store, hosting, preview, and container publishing: `auto-publish-google-play-on-release.yml`, `build-update-web-app-on-release.yml`, `pr-preview-deploy.yml`, `publish-to-hub-docker.yml`, and `supersync-docker.yml`.
- Wiki and community automation: `wiki-sync.yml`, `stale.yml`, `stale-discussions.yml`, `issue-triage.yml`, `issue-reproduce.yml`, `welcome-first-time-contributors.yml`, and `claude.yml`.

These workflows contain Super Productivity package identities, accounts, credentials, deployment targets, release assumptions, or community-management behavior that is not Planstrand infrastructure. Their definitions are retained only as reference material.

Planstrand release, store, container, preview, and production deployment workflows will be designed separately when those channels are ready. Upstream private credentials must never be copied into Planstrand. Future publishing workflows must use Planstrand package identifiers, accounts, credentials, signing material, and deployment targets.
