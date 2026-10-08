# Planstrand release and publishing

Planstrand `v1.1.0-rc.1` is publicly released for Windows x64, with installer and portable artifacts. [GitHub Releases](https://github.com/hychaw/planstrand/releases) is the authoritative download location. Keep both published tags (`v1.0.0-rc.1` and `v1.1.0-rc.1`), releases, assets, and their evidence unchanged.

## Current release tooling

[release-planstrand.yml](../.github/workflows/release-planstrand.yml) is manually dispatched with an explicitly reviewed commit or tag. It builds unsigned Windows x64 packages, runs release contracts and packaged smoke checks, and produces checksums and source provenance. Its optional draft job uses the `planstrand-release` environment.

The workflow requires an exact reviewed commit and matching product-version tag, and refuses to publish an existing release. Do not dispatch it to recreate or replace either public release. Updating it for a future version is separate release work.

Electron publishing is disabled in [electron-builder.yaml](../electron-builder.yaml). Future packages include Planstrand's [LICENSE](../LICENSE) and the preserved [Super Productivity MIT license](../LICENSES/SUPER_PRODUCTIVITY_MIT.txt). Angular copies the Planstrand license to `assets/planstrand-license/LICENSE`; `assets/upstream-license.txt` retains the original upstream notice. About links to both and to generated dependency licenses. Release verification compares both packaged project licenses and their frontend copies with source, while retaining dependency and Inter font notice checks. Electron/Chromium notices remain part of desktop packaging. Existing published releases are unchanged. Signing, mobile/store ownership, Linux distributions, macOS notarization, and hosted-service publishing are deferred. Retained platform tooling and tests do not authorize distribution under inherited identities.

## Build and validation

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
