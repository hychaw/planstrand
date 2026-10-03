# Semantic sync reader capabilities

Semantic reader support is separate from entity vocabulary and persisted schema
versions. `TASK_FOLDER_OWNERSHIP_V1` is defined once in shared-schema. Optional
`supportedCapabilities` advertisements and `requiredCapabilities` operation or
snapshot metadata use string lists, alongside unchanged `requiredEntityTypes`.
Missing advertisements support no semantic capabilities. Missing requirements
retain ordinary legacy compatibility; unknown requirements block safely.
`CURRENT_SCHEMA_VERSION` remains unchanged.

The current client intentionally advertises `CLIENT_SYNC_READER_CAPABILITIES = []`.
It understands the requirement infrastructure, but does not implement or claim
Task Folder ownership. Phase 4E must enable that capability atomically with the
ownership implementation. A pre-4E reader advertising `FOLDER` therefore still
fails a `TASK_FOLDER_OWNERSHIP_V1` requirement. Supporting the semantic capability
does not satisfy a separate `FOLDER` entity requirement.

The server's operation-sync advertisement lists semantic requirements it can
enforce; it is not a claim that the server implements client Task reducers.
Deploy the `semantic_reader_requirements` SQL migration and enforcing server
version consistently before allowing writers to require this capability.
Old servers cannot enforce semantic capabilities they do not understand. Writers
check the server's advertised semantic support before upload.

## Enforcement and persistence

- The existing SuperSync pre-handler gates every route against the causal
  full-state entity boundary and semantic requirements in that boundary and its
  retained operation tail. A missing full-state boundary starts the semantic
  check at sequence zero. Thus an ordinary Task operation can fence unaware
  readers and writers without inventing a full-state operation.
- The existing response gate checks requirements on returned operations,
  piggybacks and declared full-state metadata. Rejection returns HTTP 409 with
  the existing reader-unsupported code and no state, operation batch or cursor.
  As in Phase 4C, response screening closes delivery races; ingress checks are
  not a universal transactional lock against writers admitted before a new
  requirement commits. Reader advertisements remain trusted claims.
- Requirements are stored in the operation row's default-empty
  `required_capabilities` column. Snapshot ingress, download selects, request
  fingerprints and duplicate identity checks retain them. The optional metadata
  remains visible outside encrypted payloads, like entity requirements; this
  increment does not change the encryption authentication contract.
- Client remote processing checks semantic requirements before interpreting a
  batch, deduplication or cursor advancement. Full-state/import checks run before
  unwrapping, conversion and repair; decrypted wrappers are checked too. The
  existing blocked outcome is reused.
- File sync carries semantic tokens in the existing durable `requiredOpTypes`
  manifest, independently of `ENTITY:*` tokens. Existing pre-4E file readers
  reject the unknown token. Snapshot writes, retained operations, backups,
  compaction, force writes and password rotation keep that manifest floor.
  Compact operation key `k` preserves optional `requiredCapabilities`; key `q`
  continues to preserve entity requirements. Both file conversion directions
  retain the metadata.
- Backup wrappers can carry explicit semantic requirements, checked by current
  importers before state extraction. This does not retrofit the new check into
  previously shipped manual importers; SuperSync protection requires the
  enforcing server, and file protection uses the existing semantic manifest.

No current Task field, migration, reducer, Project bridge, Folder UI, conflict
machinery, dependency, or automatic Task ownership requirement is introduced.
Future Phase 4E writers must declare ownership requirements on authoritative Task
operations and full-state snapshots, including replacements that compact a tail.

The server subset query and migration defaults are also verified against real PostgreSQL semantics in PGlite.

## Changed files

- `ARCHITECTURE-DECISIONS.md`
- `docs/sync-and-op-log/README.md`
- `docs/sync-and-op-log/semantic-reader-capabilities.md`
- `packages/shared-schema/src/index.ts`
- `packages/shared-schema/src/reader-capabilities.ts`
- `packages/shared-schema/src/supersync-http-contract.ts`
- `packages/shared-schema/tests/reader-capabilities.spec.ts`
- `packages/super-sync-server/prisma/migrations/20261003010000_semantic_reader_requirements/migration.sql`
- `packages/super-sync-server/prisma/schema.prisma`
- `packages/super-sync-server/src/sync/conflict.ts`
- `packages/super-sync-server/src/sync/full-state-reader-gate.ts`
- `packages/super-sync-server/src/sync/services/operation-download.service.ts`
- `packages/super-sync-server/src/sync/services/operation-upload.service.ts`
- `packages/super-sync-server/src/sync/services/request-deduplication.service.ts`
- `packages/super-sync-server/src/sync/sync.routes.snapshot-handler.ts`
- `packages/super-sync-server/src/sync/sync.routes.ts`
- `packages/super-sync-server/src/sync/sync.types.ts`
- `packages/super-sync-server/tests/conflict.spec.ts`
- `packages/super-sync-server/tests/e2ee-upload-gate.routes.spec.ts`
- `packages/super-sync-server/tests/full-state-reader.routes.spec.ts`
- `packages/super-sync-server/tests/operation-download.service.spec.ts`
- `packages/super-sync-server/tests/request-dedup-failure-caching.routes.spec.ts`
- `packages/super-sync-server/tests/semantic-reader-gate.pglite.spec.ts`
- `packages/super-sync-server/tests/setup.ts`
- `packages/super-sync-server/tests/sync-compressed-body.routes.spec.ts`
- `packages/super-sync-server/tests/sync-fixes.spec.ts`
- `packages/super-sync-server/tests/sync-upload-rate-limit.routes.spec.ts`
- `packages/sync-core/src/operation.types.ts`
- `packages/sync-providers/src/provider-types.ts`
- `packages/sync-providers/src/super-sync/super-sync.model.ts`
- `packages/sync-providers/src/super-sync/super-sync.ts`
- `packages/sync-providers/tests/super-sync/super-sync.spec.ts`
- `src/app/op-log/apply/operation-applier.service.spec.ts`
- `src/app/op-log/apply/operation-applier.service.ts`
- `src/app/op-log/backup/backup.service.ts`
- `src/app/op-log/backup/full-state-backup-envelope.spec.ts`
- `src/app/op-log/backup/full-state-backup-envelope.ts`
- `src/app/op-log/core/types/sync.types.ts`
- `src/app/op-log/persistence/compact/compact-operation.types.ts`
- `src/app/op-log/persistence/compact/operation-codec.service.ts`
- `src/app/op-log/sync-providers/file-based/file-based-operation-conversion.util.ts`
- `src/app/op-log/sync-providers/file-based/planstrand-file-protocol.ts`
- `src/app/op-log/sync-providers/file-based/planstrand-file-sync-adapter.service.spec.ts`
- `src/app/op-log/sync-providers/file-based/planstrand-file-sync-adapter.service.ts`
- `src/app/op-log/sync-providers/file-based/planstrand-file-transport.ts`
- `src/app/op-log/sync-providers/super-sync/response-validators.spec.ts`
- `src/app/op-log/sync-providers/super-sync/response-validators.ts`
- `src/app/op-log/sync-providers/super-sync/super-sync.ts`
- `src/app/op-log/sync/folder-full-state-gate.spec.ts`
- `src/app/op-log/sync/folder-full-state-gate.ts`
- `src/app/op-log/sync/operation-encryption.service.spec.ts`
- `src/app/op-log/sync/operation-log-upload.service.spec.ts`
- `src/app/op-log/sync/operation-log-upload.service.ts`
- `src/app/op-log/sync/operation-sync.util.ts`
- `src/app/op-log/sync/remote-op-block.util.ts`
- `src/app/op-log/sync/sync-capability-gate.service.ts`
- `src/app/op-log/sync/sync-capability.util.spec.ts`
- `src/app/op-log/sync/sync-capability.util.ts`
- `src/app/op-log/sync/verify-decrypted-op-integrity.ts`
