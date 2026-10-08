# Planstrand release-candidate procedure

Publishing requires explicit approval of the reviewed commit, release notes,
unsigned artifacts, checksums and verification limitations. Local validation does
not authorize a push, tag, workflow dispatch, upload or release.

The product version is `planstrand-product.json`, independently of the inherited
source package compatibility version. RCs retain `-rc.N`; never silently bump an
RC to stable. Windows PE numeric versions encode the base version, while runtime,
About, Settings, installer/portable product strings and Installed Apps retain the
full RC version.

## Manual workflow safeguards

`release-planstrand.yml` runs only on manual dispatch in `hychaw/planstrand`.
Supply an exact 40-character reviewed commit and an existing annotated RC tag.
The checked-out commit, tag target, product version and tracked
`docs/releases/<tag>.md` notes must agree. The protected `v1.0.0-rc.1` is refused.
Existing releases (including drafts), lookup errors and provenance/hash mismatch
fail closed. The workflow never edits or replaces releases or creates tags.

Build permissions are read-only. Only the optional draft job has contents-write
permission, behind the `planstrand-release` environment. It creates a new draft
prerelease with `--latest=false`. Per-tag concurrency prevents overlapping runs.
Publishing the reviewed draft is a separate explicit approval step.

The workflow validates packaged version, compiled revision, original MIT,
upstream acknowledgement, dependency notices and Inter OFL before upload. The
manifest binds the exact filenames, sizes and SHA256 values to the revision,
product version and normalized packaging-configuration hashes. The draft job
checks these again after downloading the build artifacts.

## Local preparation

Use the documented `npm run build` production pipeline, then:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx --no-install electron-builder --win nsis portable --x64 --publish never
$env:RELEASE_REF = git rev-parse HEAD
$env:RELEASE_TAG = 'v' + (Get-Content planstrand-product.json -Raw | ConvertFrom-Json).version
node tools/planstrand-release.cjs record-artifacts .tmp/app-builds
```

Use a new output directory to preserve previous candidates. Preparation under
`.tmp` is ignored by Git; retain it separately before any cleanup. Do not commit
executables. Changing the release commit requires rebuilding and repeating
metadata/smoke verification; do not relabel old binaries with a new source SHA.

Native checks use disposable profiles. The installer safety script refuses an
existing default installation, registration or shortcut, checks fresh/custom
install and uninstall, sentinels, shortcuts, ownership guards and reinstall.
It never launches the user's default profile. An optional `-PreviousInstaller`
tests a local V1 RC1 installer whose sibling `SOURCE_SHA.txt` matches the
protected tag, then upgrades an isolated Task/Folder/Planning/WorkSession/Event
workspace. Never run it over a user's installation. File-symlink fixture EPERM
requires a suitably provisioned test host; do not skip the test or change security
settings to manufacture a passing local result.

## Approved publication sequence

Before running these commands, verify a clean tree, the approved exact HEAD,
remote development ancestry, no existing proposed tag/release, the protected V1
tag, and the approved artifact hashes. Stop if any condition differs. An
authenticated GitHub CLI and repository/environment permissions are required.

```powershell
git switch development
git fetch origin --prune
$releaseRef = git rev-parse HEAD
$releaseTag = 'v' + (Get-Content planstrand-product.json -Raw | ConvertFrom-Json).version
git merge-base --is-ancestor origin/development $releaseRef
git status --short --branch
git push origin development
git tag -a $releaseTag $releaseRef -m "Planstrand $($releaseTag.Substring(1))"
git push origin "refs/tags/$releaseTag"
gh workflow run release-planstrand.yml --ref development -f "ref=$releaseRef" -f "release_tag=$releaseTag" -f create_draft=true
```

Watch the specific new workflow run to completion. Review its draft prerelease,
five assets (`Planstrand-Setup.exe`, `Planstrand-Portable.exe`, `SHA256SUMS.txt`,
`SOURCE_SHA.txt`, `release-manifest.json`), downloaded checksums, notes and source
revision. Workflow-built binaries have their own hashes; do not substitute them
for locally approved binaries without reviewing the new outputs.

Alternatively, after pushing the reviewed commit and tag, create a draft directly
with the five validated local assets using `gh release create --verify-tag
--draft --prerelease --latest=false` and the tracked notes. Do not use a broad
artifact wildcard or `gh release upload --clobber`.

Only after approval to publish the reviewed draft:

```powershell
gh release edit $releaseTag --repo hychaw/planstrand --draft=false --prerelease --latest=false
```

Keep V1 history, tags and release assets untouched. A later stable release is a
separate version and release decision.
