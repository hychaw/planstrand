# Planstrand release and publishing

Planstrand [`v1.3.0-rc.1`](https://github.com/hychaw/planstrand/releases/tag/v1.3.0-rc.1) was published as a Windows x64 prerelease on October 15, 2026 UTC at source revision `58b9471b92dee0c5fe8bcabf15d3ec194bb47793`. [GitHub Releases](https://github.com/hychaw/planstrand/releases) is the authoritative download location. Keep all published V1.0, V1.1, V1.2 and V1.3 tags, releases, assets and their evidence unchanged. No hosted SuperSync service is provided.

## Current release tooling

[release-planstrand.yml](../.github/workflows/release-planstrand.yml) is manually dispatched with an explicitly reviewed commit or tag. It builds unsigned Windows x64 packages, runs release contracts and packaged smoke checks, and produces checksums and source provenance. Its optional draft job uses the `planstrand-release` environment.

The workflow requires an exact reviewed commit and matching product-version tag, and refuses to publish an existing release. Do not dispatch it to recreate or replace any public release. Updating it for a future version is separate release work.

Electron publishing is disabled in [electron-builder.yaml](../electron-builder.yaml). Future packages include Planstrand's [LICENSE](../LICENSE) and the preserved [Super Productivity MIT license](../LICENSES/SUPER_PRODUCTIVITY_MIT.txt). Angular copies the Planstrand license to `assets/planstrand-license/LICENSE`; `assets/upstream-license.txt` retains the original upstream notice. About links to both and to generated dependency licenses. Release verification compares both packaged project licenses and their frontend copies with source, while retaining dependency and Inter font notice checks. Electron/Chromium notices remain part of desktop packaging. Existing published releases are unchanged. Signing, mobile/store ownership, Linux distributions, macOS notarization, and hosted-service publishing are deferred. Retained platform tooling and tests do not authorize distribution under inherited identities.

## Build and validation

The current published candidate is **V1.3 RC1**, with five integrity-verified release
assets. The exact Windows Portable and Setup executables passed owner runtime
acceptance, including persistence, backup/restore and installation/uninstallation.
A genuine V1.2 → V1.3 in-place installer upgrade remains **NOT TESTED**. See the
[V1.3 release notes](releases/v1.3.0-rc.1.md) for the final evidence and limitations;
the [earlier readiness record](v1.3-phase-5b-release-readiness.md) remains historical
preparation evidence. Publication does not certify a server deployment or imply
that all inherited GitHub Actions checks passed.

For V1.2 RC1, use the [final readiness requirement and result](routines-rc1-final-readiness.md)
and complete the [independent pre-upgrade backup/restore rehearsal](v1.2-backup-restore.md).
Complete backup restoration is required; encrypted operator tail reconstruction
is limited to admitted histories and is not a universal recovery guarantee.

For a future candidate, the general build entry points are shown below. They are
not instructions to recreate the published V1.3 assets. V1.3 used an approved
installation-free staged build because the root `prebuild` helper can invoke
dependency installation even when hoisted workspace dependencies are valid.
Review the script chain and prerequisites before selecting a future build procedure.

```sh
npm ci
node --test tools/verify-planstrand-release.test.cjs tools/verify-windows-artifact-contract.test.js tools/verify-linux-wm-class.test.js
npm run build
npx electron-builder --win nsis portable --x64 --publish never
```

Use the workflow's smoke checks and metadata steps for an actual release. Build only with deliberately configured project-owned credentials. Unsigned downloads may trigger SmartScreen.

## Historical evidence

The [RC1 notes](releases/PLANSTRAND_V1_RC1.md), [release identity decisions](PLANSTRAND_RELEASE_IDENTITY.md), [release-prep audit](PLANSTRAND_V1_RELEASE_PREP_AUDIT.md), and [RC1 preparation checklist](PLANSTRAND_RELEASE_CHECKLIST.md) record the release-preparation period. Old checklist items and branch/run references are historical evidence, not current instructions.

See [GitHub Actions](GITHUB_ACTIONS.md) for current workflow scope and repository settings.
