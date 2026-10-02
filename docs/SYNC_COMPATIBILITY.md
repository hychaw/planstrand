# SuperSync operation compatibility

## Purpose

Authentication proves that a client may access a SuperSync account. It does not prove that the server understands every entity, operation type, and schema version the client may upload. Before an API upload, the client therefore checks a machine-readable operation capability contract.

This preflight is an additional safety layer. The server's existing operation validation remains authoritative for every request.

Planstrand's schema-5 release sets `operationSync.minSchemaVersion` to 5 for
**live uploads**, including snapshots, imports, and repairs. Missing or older
upload schemas are rejected; retained schema-4 history remains downloadable as
a bounded migration source. Deploy this enforcement on **every serving server
instance before enabling migration clients**. Authentication and download access
do not permit legacy clients to write.

The cutover must materialize the complete legacy state and recoverable tail,
including local work, before one-time Planning projection. Validate that result,
capture recovery, and then use the existing causal clean-slate schema-5 import.
Only confirmed replacement completes cutover. Client preparation keeps the
legacy replay anchor at schema 4, suppresses live Planning translation, and
uses deterministic counter-0 migration records. Ambiguous undated Today actions
fail materialization rather than guessing the replay day or a UTC date.

Prepared migration checkpoints durably bind their completed-download cursor to
their existing opId and projected state. Snapshot upload forwards that unchanged
as `lastKnownServerSeq`, separately from REPAIR's `repairBaseServerSeq`. The
existing server row-lock check rejects a competing stale checkpoint before any
wipe or sequence allocation. Durable same-op retry recognition runs first, so a
lost committed response resolves without another wipe. Stale checkpoints retain
source/recovery data and existing rejection metadata; they require reconciliation,
never a refreshed cursor attached to old state. No new cutover marker is used.
The schema-5 upload floor rejects late schema-4 operations, and replay fails
closed on legacy full-state replacement after schema-5 authority.

## Contract

An authenticated `GET /api/sync/status` response may advertise:

```json
{
  "capabilities": {
    "operationSync": {
      "contractVersion": 1,
      "supportedEntityTypes": ["TASK", "PROJECT"],
      "supportedOpTypes": [
        "CRT",
        "UPD",
        "DEL",
        "MOV",
        "BATCH",
        "SYNC_IMPORT",
        "BACKUP_IMPORT",
        "REPAIR"
      ],
      "minSchemaVersion": 1,
      "maxSchemaVersion": 4
    }
  }
}
```

`contractVersion` versions the meaning and shape of this advertisement. Schema versions are checked separately. The server derives `supportedEntityTypes` from the same shared `ENTITY_TYPES` definition used by server validation, derives `supportedOpTypes` from the same `SUPER_SYNC_OP_TYPES` definition used by validation, and derives the schema range from the shared schema-version constants.

The status schema keeps `capabilities` optional so an older authenticated server can be recognized as a known incompatible server. Missing or malformed metadata is not treated as successful compatibility.

## Provider boundary

The handshake applies only to providers with `providerMode: 'superSyncOps'` that explicitly require server capabilities. File-backed providers (`fileSnapshotOps`, including WebDAV, Dropbox, OneDrive, and local-file adapters) continue to use their existing snapshot/operation format and do not make a SuperSync status request.

## Upload gate and states

The gate runs in `OperationLogUploadService` after the durable pending operations are selected under the operation-log lock and before either the SuperSync snapshot or operation upload endpoint is called.

- Compatible: upload proceeds unchanged.
- Known incompatible, missing, or malformed capability metadata: no operation in the cycle is uploaded. Operations remain durable and pending, and the application reports an `INCOMPATIBLE` sync status with a user-safe message.
- Capability request authentication failure: existing authentication handling applies.
- Capability request network or other transient failure: existing transient retry/error handling applies; it is not converted into incompatibility.

The gate never edits, strips, downgrades, converts, or acknowledges an unsupported operation. Payload sanitization that already excludes local-only configuration remains independent of compatibility checks.

## Partial synchronization policy

Phase 0 uses a conservative cycle-atomic policy. The client checks the exact uploadable pending set, including every entity in a multi-entity operation and every known entity for a full-state `ALL` operation. If any requirement is unsupported, none of that cycle is uploaded. The operation log does not currently encode enough cross-operation intent boundaries to prove that an arbitrary supported subset would represent complete local intent.

## Cache and refresh

Capability results are cached in memory for five minutes. The cache is cleared when provider credentials/configuration are replaced or their in-memory cache is invalidated. It does not survive application restart. A manual sync bypasses the cache, and expiry lets an open client observe a server upgrade. Known incompatibility is therefore never cached permanently. Transient fetch failures are not cached.

## Adding a new entity

Phase 1 adds `WORK_SESSION` as the first production consumer of this contract. Its shared entity definition drives both server validation and capability advertisement; the upload gate needs no entity-specific branch. Local creation works while an older server remains incompatible, and manual refresh permits the durable pending operation to upload after the server is upgraded.

When introducing another entity:

1. Add it to the shared production `ENTITY_TYPES` only as part of that entity's implementation phase.
2. Ensure capture/replay and schema-version behavior are defined.
3. Upgrade the server so its shared-schema build validates and advertises the entity.
4. Add client/server compatibility fixtures for supported and unsupported deployments.

No Phase 0 fixture registers a new production entity; tests use synthetic future entity strings to exercise the gate.

## Immutable semantic-vocabulary rule (Phase 2A)

A semantically new cross-version operation family that an older client must not silently ignore **must use an immutable operation type unknown to that client**. Never introduce such semantics merely as a new action under `UPD` or `MOV`, a schema/application-version bump, or an entity capability. Phase 2 will choose its own stable family identifier (conceptually `PLANNING_V1`); this prerequisite registers no production family or planning action.

The replay contract is: unknown operation type → `UNKNOWN_OP_VOCABULARY` → stop before migration/conversion/dispatch → neither the blocked operation nor its suffix is stored/applied → keep the persisted cursor before the blocked operation → show update-required UI. The already-processed prefix may remain applied and is deduplicated on retry. This branch adds the same defense for unfamiliar action strings using `KNOWN_ACTION_TYPES`. It protects readers containing this fix, not previously released readers that silently dispatch unfamiliar actions.

`getOperationCapabilityRequirement` includes the exact envelope `opType`, entity requirements (including atomic multi-entity changes), and schema version. Capability contract v1 gains optional `supportedOpTypes` as an additive extension; old Phase 0/1 clients continue parsing it. When present, the advertisement is authoritative, including an empty list. When absent, **only** `SUPER_SYNC_BASELINE_OP_TYPES` is implicit: `CRT`, `UPD`, `DEL`, `MOV`, `BATCH`, `SYNC_IMPORT`, `BACKUP_IMPORT`, `REPAIR`. This is an immutable historical baseline, not an alias for an ever-growing current enum. Future server support is added to `SUPER_SYNC_OP_TYPES`, never to the baseline. Missing the entire Phase 0 contract remains incompatible; successful authentication is insufficient.

A future type requires explicit advertisement even when entity and schema are compatible. Missing/malformed metadata, an explicitly unsupported type, and an unsupported contract remain distinct from network/authentication failures. The gate runs before encryption/upload/acknowledgement and conservatively blocks the pending cycle without mutating operations. Operation-type information uses the existing five-minute in-memory cache, manual forced refresh, and provider/config/credential invalidation. A server upgrade can upload the identical pending operation on retry.

## Receive architecture and audited limits

| Wire value                           | Existing incremental receiver                                                                                                    | After Phase 2A                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Unknown `opType`                     | Block before migration/replay; cursor frozen                                                                                     | Same                                                                           |
| Unknown `actionType`, known `opType` | Conversion preserves string; reducer may ignore it while processing completes                                                    | Block before migration/replay; cursor frozen                                   |
| Unknown `entityType`                 | Transport/converter preserve it; no entity-vocabulary fence in the receiver; action-derived reducer targeting may still dispatch | Unchanged; entity support alone never substitutes for the operation-type fence |
| Newer `schemaVersion`                | Block before migration/replay; cursor frozen                                                                                     | Same                                                                           |

SuperSync downloads and upload piggyback responses decrypt payloads before the processing loop. The loop screens vocabulary before imports, conflict resolution, operation-store append, and applier dispatch. Callers persist server sequence only after successful processing; incompatible results stop the sync session, including has-more follow-ups. Forced raw rebuild checks vocabulary before destructive replacement. Compaction/action-code conversion preserves unknown wire strings; it does not make them interpretable. PLANNER map LWW replay remains unsupported and is not extended here.

File adapters decrypt/decompress the entire file internally. Their cursor is a logical `syncVersion`, not an API operation sequence. Downloads stage expected versions, clocks, and revisions; `setLastServerSeq` promotes these only after apply. A raw retained-operation check now runs before clock/applied-ID dedup or snapshot hydration. A snapshot containing incompatible vocabulary is rejected atomically rather than partially hydrated; later operations are not treated as applied. The revision stays staged and single-file writes refuse an unapplied baseline, and both file layouts explicitly reject incompatible retained operations before merge, trim, append, or compaction (including after a cold reload), preserving the remote file for upgrade/retry. No SuperSync status request is made.

**Released file-reader limitation:** snapshot-included operations can bypass incremental replay entirely and advance the file cursor. A frozen v19.1.0 client also treats an unsupported envelope as recoverable corruption: a delayed legacy backup write survives a failed primary CAS, and a cold released reader can recover it and heal legacy data over a same-name newer envelope. A same-name version bump is therefore abandoned. Phase 2B separates the write namespace and persists semantic requirements independently of retained operations.

## Planstrand file compatibility (Phase 2B)

Planstrand is an independent product. Cross-product backwards compatibility means explicit read/import, not live mixed writes. Production file sync exclusively uses:

| Artifact                        | Planstrand filename                                          |
| ------------------------------- | ------------------------------------------------------------ |
| Single commit / recovery        | `planstrand-sync-data.json` / `.json.bak`                    |
| Split commit / recovery         | `planstrand-sync-ops.json` / `.json.bak`                     |
| Fixed split snapshot / recovery | `planstrand-sync-state.json` / `.json.bak`                   |
| Immutable split snapshots       | `planstrand-sync-state__<syncVersion>__<16-hex-random>.json` |
| Migration lock                  | `planstrand-migration.lock`                                  |

Every snapshot, commit and internal split tombstone uses `product: 'planstrand'`, `version: 4`, and `compatibility: { requiredOpTypes: string[] }`; the encoding prefix model version is also 4. Missing/malformed metadata, unsupported versions, prefix disagreement or an unsupported required type fail before hydration, operation application or cursor/revision acknowledgement. Errors contain no decrypted payload. Phase 2A retained-op screening remains independently required.

The sorted unique manifest is the union of remote requirements, the readonly build requirement and published non-baseline operation types. It survives trimming/compaction and full snapshot replacement, including REPAIR/BackupImport/force upload. A compatible cold reader learns it from the remote, regardless of local metadata. Recovery validates the same product/version/manifest and encryption intent. A readable incompatible primary cannot adopt a weaker backup. Before committing stronger semantics, an existing recovery copy's manifest is conditionally upgraded without replacing its state with an uncommitted candidate.

The layout engine reuses its v2/v3 in-memory shapes behind `PlanstrandFileTransport`; these projections are never written to legacy paths. Only v4 is serialized in the Planstrand namespace. The immutable path descriptor maps all engine I/O, including backup/delete/tombstone/cleanup paths, and rejects arbitrary snapshot paths. Production entry points are `PlanstrandFileSyncAdapterService`, `WrappedProviderService` and the file encryption service.

Discovery prefers any Planstrand protocol artifact, including damaged or zero-byte data. A legacy-only target raises `LegacyFileImportRequiredError`. Explicit `importLegacy` requires host hooks to persist a local recovery point and materialize the validated source through normal state validation/migration/replay, including split operations not represented in the snapshot. Explicit `startFresh` creates a new namespace without altering legacy. A successful import is create-only, read-verified and idempotent when a Planstrand primary already exists. Before the first commit, a create-only backup reservation carries the compatibility floor without candidate state; it cannot hydrate. A crash leaving only that reservation requires explicit recovery or a new target and is not reported as a successful import. Backup replacement uses revision matching so a delayed weaker writer cannot erase a stronger recovery floor. No automatic post-cutover re-import occurs. Normal Planstrand deletion never deletes legacy data.

Import verifies the authoritative legacy revision and any referenced state/backup revisions immediately before publishing. There is no cross-file atomic transaction with a legacy writer: changes after the final revision check remain in the divergent legacy world. LocalFile has best-effort content-revision checks rather than atomic CAS; weak network revisions have similar limits. Quiesce legacy writers for the one-time import in these configurations. Subsequent namespace isolation does not depend on quiescence. Interrupted legacy split migration is rejected rather than resumed by modifying the source.

The audited released v19.1.0 WebDAV/Nextcloud, Dropbox and OneDrive paths append an explicit filename to their configured target; normal adapter deletion uses explicit known protocol names. Electron deletes individual files with `unlinkSync`; Android SAF uses `findFile(fileName)` and deletes that document only. Listing capability in that tag is not a wildcard deletion call. The examined v16.1.0 model deletion likewise addresses known model filenames. This is isolation from released application's sync paths, not an access-control boundary against a storage administrator or a deliberately modified client.

**Phase 2 activation:** add stable immutable `PLANNING_V1` to the operation vocabulary **and** to `PLANSTRAND_REQUIRED_FILE_OP_TYPES` in `planstrand-file-protocol.ts` with the first incompatible writer. Never add it to `SUPER_SYNC_BASELINE_OP_TYPES`. SuperSync must advertise/validate it before API upload. Namespace isolation protects against released SP writers; the manifest makes older Phase 2B Planstrand readers stop even after compaction removes all planning operations. Phase 2B adds no production planning family and makes no SuperSync protocol changes.

Operation/action types remain plaintext envelope metadata, with the existing integrity limitations; this change adds no new authentication claim. API AES-GCM payload authentication, mandatory-encryption checks, file encryption, and authenticated payload footprints are unchanged. Compatibility diagnostics do not log decrypted user payloads.

Synthetic future operations are not reachable through current application writers and the server deliberately rejects future types. Tests therefore inject real wire/file shapes through the real client download/upload/processing and IndexedDB paths, with provider transports and reducer application controlled by the integration harness. They are protocol prerequisites, not new domain features.

## Phase 2 normalized Planning activation (schema 5)

PLANNING_V1 is now registered independently from the immutable deployed generic baseline. SuperSync advertises both PLANNING and PLANNING_V1. Set and Remove conflict only on PLANNING:Task.id; dense order keys are absolute and equal keys use lexical Task-ID ordering. Deterministic per-Task register merge resolves originals directly, retaining tombstones and revision metadata without replacement operations.

Planstrand's build-level requiredOpTypes now always includes PLANNING_V1, even when callers supply an empty custom requirement. Requirements survive snapshots, operation trimming, repair, force writes, backups, password rotation and cold reload independently of retained operations. Legacy namespace and baseline vocabulary remain unchanged.

The released v18.22.0/schema-4 oracle runs its actual compatibility predicate against schema-5 SYNC_IMPORT, BACKUP_IMPORT and REPAIR payloads and rejects before hydration/cursor advancement. The independent semantic fence also rejects PLANNING_V1 mislabeled with schema 4. The source pin and executable oracle live in packages/shared-schema/tests/released-client-oracles/planning-v5.spec.ts. Older pre-schema-4 tolerance bands are not treated as proof of full-state safety; Planstrand namespace isolation and the durable manifest remain independently necessary.

Released schema 4 is the legacy migration source; schema 5 is the Planstrand cutover. Complete legacy state/history and supported local unsynced edits are materialized before schema4→5 projection, validation, recovery creation and durable checkpoint preparation. The checkpoint binds baseServerSeq; the schema-5 clean-slate replacement is CAS-protected. Response-loss retry reuses the original checkpoint/operation; stale checkpoints require reconciliation. Compaction remains deferred until confirmation.

After confirmation, PLANNING_V1 and revisioned PlanningRecords are authoritative. Ordinary schema-5 hydration/replay never projects Planner, Today or due fields into Planning. Legacy runtime translation, prefix permissions, synthetic Planning compensation and physical removal are absent. Old clients cannot live-upload schema 4. Unfinished Phase-2 development formats (revisionless placements, earlier payload shapes and temporary compensation formats) are unsupported.

One-time migration evidence precedence is explicit PlannerState.days membership/order, then valid dueDay with usable Today order, then valid dueDay with deterministic lexical Task-ID fallback, otherwise no active placement. Duplicate Planner membership chooses the earliest valid date deterministically. Today-only, dueWithTime-only, WorkSession, reminders, deadlines and transient current-Today context provide no placement evidence. Migration revisions use counter 0; authored counter-1 writes and tombstones beat them.

File sync preserves the explicit one-time boundary: legacy namespace → full import/materialization → schema-5 state → Planstrand namespace. It never automatically re-reads the legacy namespace afterward.
