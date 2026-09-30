# SuperSync operation compatibility

## Purpose

Authentication proves that a client may access a SuperSync account. It does not prove that the server understands every entity, operation type, and schema version the client may upload. Before an API upload, the client therefore checks a machine-readable operation capability contract.

This preflight is an additional safety layer. The server's existing operation validation remains authoritative for every request.

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

**Released file-reader limitation:** before this prerequisite, snapshot-included operations can bypass incremental replay entirely and advance the file cursor. The regression reproduces this for both v2 single-file and v3 split-file snapshots. Adding an unknown operation type therefore protects their incremental replay, but cannot by itself protect those released snapshot readers. Phase 2 must also fence snapshots with an envelope version those readers already reject (including compacted snapshots with no retained original op), or require every participating file reader to contain this fix. Until that rollout condition is satisfied, independent planning writes remain blocked. A per-peer registry is not required when both replay and snapshot format fences fail closed; an operation-type fence alone is insufficient for the released file snapshot path.

Operation/action types remain plaintext envelope metadata, with the existing integrity limitations; this change adds no new authentication claim. API AES-GCM payload authentication, mandatory-encryption checks, file encryption, and authenticated payload footprints are unchanged. Compatibility diagnostics do not log decrypted user payloads.

Synthetic future operations are not reachable through current application writers and the server deliberately rejects future types. Tests therefore inject real wire/file shapes through the real client download/upload/processing and IndexedDB paths, with provider transports and reducer application controlled by the integration harness. They are protocol prerequisites, not new domain features.
