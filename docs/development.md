# Development guidance

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, checks, and pull requests. The [repository map](repository-map.md) locates code and focused tests; [architecture decisions](../ARCHITECTURE-DECISIONS.md) explain lasting constraints.

## Project conventions

- Keep core planning offline and private. Sync and integrations are optional; do not add analytics or tracking.
- Prefer existing building blocks and calm defaults. Discuss new dependencies before adding them.
- Use strict TypeScript, immutable reducers, translated UI text, and cleanup for subscriptions. See the [styling guide](styling-guide.md) and [translation guide](TRANSLATING.md).
- Guard Electron-only APIs with platform checks. Use [package validation](../packages/README.md#validation) for package-specific tooling.
- Run focused checks and reproduce bugs before changing behavior. The root TypeScript configuration has an empty file list; compiling it alone does not validate the app.

## Persisted and sync state

Follow the [contributor sync model](sync-and-op-log/contributor-sync-model.md): one user intent produces one operation; remote replay must not trigger local effects. Use action-based effects and the prescribed hydration guard for selector-based effects. Multi-entity changes belong in one reducer pass.

New persisted fields must be optional with runtime defaults. Follow [persisted model guidance](sync-and-op-log/persisted-model-fields.md) and the [operation-log compatibility policy](sync-and-op-log/operation-log-architecture.md) before changing schemas. A schema bump alone does not protect released clients.

Log identifiers and counts rather than user content; logs can be exported. Review replay determinism, concurrent edits, backup compatibility, and data-loss risks. Sync fixes require a failing real-path reproduction and a passing result with the fix.

## Browser tests and videos

The [E2E development guide](../e2e/development.md) covers fixtures, local providers, and test selection. Product recordings use the [video guide](../e2e/store-video/development.md).
