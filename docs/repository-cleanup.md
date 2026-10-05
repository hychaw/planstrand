# Public repository cleanup audit

Audit date: 2026-10-04. Base: `development` at `a61cb811c65f02151bfbfdea0e044a29fb5e9a1b`. Scope is public repository hygiene after RC1 publication; no product behavior, schema, release tag, or historical RC1 evidence is changed.

## Reference classifications

Tracked files were searched for upstream domains, repository/maintainer names, sponsorship and wiki/issue/discussion URLs, release/image names, store IDs, and `master` assumptions. Each match falls into the following disposition groups; names alone are not grounds for deletion.

| Class                                  | Disposition                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: legal/historical attribution        | Keep original MIT copyrights, third-party notices, authorship and historical audit/release records.                                                                                          |
| B: compatibility/technical identifiers | Keep package/import names, database/schema keys, mobile IDs, release-compatibility fixtures/assets, lockfile origins and source references. No cosmetic rename of persisted or wire formats. |
| C: intentional upstream/history links  | Keep README attribution, architecture's upstream remote, historical bug/PR evidence, external themes/plugins and upstream article links explicitly identified as background.                 |
| D: stale public inherited content      | Replace community contacts, downloads, development links, store-rating instructions, release/Apple runbooks, security policy, templates and funding presentation with current project facts. |
| E: obsolete configuration              | Remove unused funding manifests, hosted-workspace examples, signing policies, duplicate contributions, repository-control material and disabled deployment/community automation.             |

## Operational exceptions retained

- `LICENSE` is unchanged. Electron packaging explicitly includes it; existing release contracts enforce the original notice and distribution inclusion.
- `.github/workflows-disabled/upstream/supersync-docker.yml` is read by the server migration contract test. It remains a disabled fixture; do not activate it. All other disabled upstream workflows were obsolete publishing/store/community definitions and were removed.
- `package.json` and lockfiles, `build/` packaging, native signing/build helpers, `Gemfile` and native Fastlane source remain referenced by package scripts, tests or platform build tooling. This does not mean those platforms are supported distributions.
- Docker/Compose/Helm defaults retain upstream images/endpoints for compatibility. Sync-server docs identify them as upstream infrastructure. Changing those defaults needs focused server/deployment validation.
- The `android` submodule metadata and inherited native IDs remain technical compatibility material. Mobile distribution is deferred.
- Runtime links and localized legacy branding remain in application source where changing them would require functional code/translation checks. This includes rating destinations and optional hosted-service defaults. They are retained for separate behavior review, not advertised as Planstrand services.
- Existing source comments still cite retired development guidance filenames. Their substantive rules remain in current human documentation; source edits were excluded from this hygiene task.
- Historical plans, upstream changelogs, RC1 preparation audits and notes remain dated evidence. Their old branch/deployment assumptions are not current instructions.
- Editor, dev-container, hooks, lint/test and Docker development files remain useful. The dev container now uses Node.js 22 and the project's npm setup. The old hosted-workspace and placeholder environment-service examples were unreferenced and removed.

Before deletion, tracked references were checked across scripts/manifests, active and disabled workflows, tooling, imports, and documentation. The obsolete issue automation helpers were tested only by their own obsolete CI step; that step was removed together with the helpers. Useful fixture/provider/video guidance was retained under neutral development-document filenames.

## Validation and settings

Use [GitHub Actions](GITHUB_ACTIONS.md) for workflow classification. Validate Markdown links (including source-document references), changed YAML/JSON, formatting and `git diff --check`. Release/artifact contracts verify the unchanged release boundary and license inclusion; the full application suite is unnecessary for this scope.

Manual settings to verify: private vulnerability reporting, `development` branch rules and code-owner review, contributor workflow approval, and protection on the existing `planstrand-release` environment. Repository files do not prove these settings are enabled. RC1's existing release workflow remains version-specific; do not reuse its draft step for the published release.

Validation results: all local Markdown links and source-document references pass; changed YAML/JSON parses; formatting and whitespace checks pass; all 18 release/artifact contracts pass. The existing Windows app archive contains a LICENSE identical to source. Three documentation-checker unit tests have pre-existing Windows limitations (path separator expectation and symlink permission); the actual repository link scan passes.

Public HTTP checks returned 200 for release, issue, security, and attribution links. The repository API confirms development as default, RC1 public with installer/portable/checksum assets, and private vulnerability reporting disabled as of this audit. A maintainer must enable private reporting in GitHub Settings.
