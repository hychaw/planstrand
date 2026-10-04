# Contributing to Planstrand

Thanks for helping improve Planstrand. Please follow our [Code of Conduct](.github/CODE_OF_CONDUCT.md). Report vulnerabilities privately through the [Security policy](SECURITY.md).

## Bugs and proposals

Search [existing issues](https://github.com/hychaw/planstrand/issues) before opening a bug report or feature request. For bugs, include your version, package type, OS, reproduction steps, expected result, and actual result. Remove personal data, tokens, and credentials from logs and backups. For proposals, explain the problem and a concrete workflow; discuss significant changes before implementation.

## Development setup

Use Git, Node.js 22.18.0, and npm 11.18.0. Use the repository's local tools; a global Angular CLI is unnecessary.

```sh
git clone https://github.com/hychaw/planstrand.git
cd planstrand
git switch development
npm ci
npm run startFrontend
```

Run `npm start` in another terminal for Electron. Optional integration keys belong in an untracked `.env`; see [environment setup](docs/ENV_SETUP.md). Docker is needed for local sync-provider tests, and Angular unit tests need a Chrome/Chromium binary.

## Focused validation

Run checks appropriate to your change and report the results. **Run `npm run checkFile <filepath>` for every modified `.ts` or `.scss` file.** Package-specific checks are listed in [packages/README.md](packages/README.md#validation).

Use `npm run test:file <filepath>` for an Angular spec and `npm run test:electron` for Electron tests. See the [E2E guide](e2e/development.md) for browser and sync tests; skipped provider tests do not validate a fix. For documentation, run `node tools/check-doc-links.js --docs-only <filepath>` and `git diff --check`. Do not run broad suites merely for documentation edits.

## Persisted and synchronized state

Read the [contributor sync model](docs/sync-and-op-log/contributor-sync-model.md) before changing effects, reducers, or bulk dispatches. One user intent must produce one operation; remote replay must not trigger local effects. Preserve backup and released-client compatibility. New persisted fields need runtime defaults; schema bumps require deliberate compatibility review. Sync fixes need a reproduction that fails before the fix and passes afterward.

## Pull requests and commits

Create a focused branch from `development`. Explain the problem, solution, tests, and any documentation or persisted/sync-state impact in the pull request. Include screenshots for visible UI changes where useful, and link related issues. Keep unrelated refactoring out of the diff.

Use conventional commits: `type(scope): description`, such as `fix(tasks): preserve task ordering`. Use an imperative, lower-case description without a trailing period; scope can be omitted for repository-wide work. Test-only changes use `test`. This is the project convention; no commit-message hook currently enforces it.

See [development guidance](docs/development.md) and the [repository map](docs/repository-map.md) when deeper context is needed.
