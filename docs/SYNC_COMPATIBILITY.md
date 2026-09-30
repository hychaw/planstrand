# SuperSync operation compatibility

## Purpose

Authentication proves that a client may access a SuperSync account. It does not prove that the server understands every entity and schema version the client may upload. Before an API upload, the client therefore checks a machine-readable operation capability contract.

This preflight is an additional safety layer. The server's existing operation validation remains authoritative for every request.

## Contract

An authenticated `GET /api/sync/status` response may advertise:

```json
{
  "capabilities": {
    "operationSync": {
      "contractVersion": 1,
      "supportedEntityTypes": ["TASK", "PROJECT"],
      "minSchemaVersion": 1,
      "maxSchemaVersion": 4
    }
  }
}
```

`contractVersion` versions the meaning and shape of this advertisement. Schema versions are checked separately. The server derives `supportedEntityTypes` from the same shared `ENTITY_TYPES` definition used by server validation, and derives the schema range from the shared schema-version constants.

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

## Adding a future entity

When a future phase introduces an entity such as `WORK_SESSION`:

1. Add it to the shared production `ENTITY_TYPES` only as part of that entity's implementation phase.
2. Ensure capture/replay and schema-version behavior are defined.
3. Upgrade the server so its shared-schema build validates and advertises the entity.
4. Add client/server compatibility fixtures for supported and unsupported deployments.

No Phase 0 fixture registers a new production entity; tests use synthetic future entity strings to exercise the gate.
