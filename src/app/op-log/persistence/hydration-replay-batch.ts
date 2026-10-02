import { Operation, OperationLogEntry } from '../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import {
  getOperationSchemaVersion,
  SchemaMigrationService,
} from './schema-migration.service';
import { OpLog } from '../../core/log';
export interface HydrationReplayBatch {
  operations: Operation[];
  atomicReplayGroups: string[][];
  sourceOpIdByReplayedOpId: Map<string, string>;
  sourceOpIdsWithReplay: Set<string>;
  sourceEntryByOpId: Map<string, OperationLogEntry>;
}
export const buildHydrationReplayBatch = (
  entries: OperationLogEntry[],
  schemaMigrationService: SchemaMigrationService,
): HydrationReplayBatch => {
  // Lenient boundary: a malformed stored schemaVersion (legacy or corrupt
  // entry) must not abort the WHOLE hydration into attemptRecovery() — that
  // trades one questionable op for possible tail-data loss on every boot.
  // Strict parsing stays on the receive/upload paths; locally we replay the
  // op verbatim as a best effort (stamping the current version so
  // migrateOperations passes it through unchanged, preserving order).
  const sanitizedOps = entries.map(({ op }) => {
    try {
      getOperationSchemaVersion(op);
      return op;
    } catch {
      OpLog.warn(
        'OperationLogHydratorService: Stored op has a malformed schemaVersion; replaying verbatim without migration.',
        { id: op.id },
      );
      return { ...op, schemaVersion: CURRENT_SCHEMA_VERSION };
    }
  });

  // Check if any ops need migration
  const needsMigration = sanitizedOps.some((op) =>
    schemaMigrationService.operationNeedsMigration(op),
  );

  const sourceOpIdByReplayedOpId = new Map<string, string>();
  const sourceOpIdsWithReplay = new Set<string>();
  const sourceEntryByOpId = new Map(entries.map((entry) => [entry.op.id, entry]));

  if (!needsMigration) {
    for (const op of sanitizedOps) {
      sourceOpIdByReplayedOpId.set(op.id, op.id);
      sourceOpIdsWithReplay.add(op.id);
    }
    return {
      operations: sanitizedOps,
      atomicReplayGroups: [],
      sourceOpIdByReplayedOpId,
      sourceOpIdsWithReplay,
      sourceEntryByOpId,
    };
  }

  OpLog.normal(
    `OperationLogHydratorService: Migrating ${sanitizedOps.length} tail ops to current schema version...`,
  );

  const atomicReplayGroups: string[][] = [];
  const operations = sanitizedOps.flatMap((op) => {
    const migrationResult = schemaMigrationService.operationNeedsMigration(op)
      ? schemaMigrationService.migrateOperation(op)
      : op;
    const migratedOps = migrationResult
      ? Array.isArray(migrationResult)
        ? migrationResult
        : [migrationResult]
      : [];
    if (migratedOps.length > 0) {
      sourceOpIdsWithReplay.add(op.id);
    }
    if (migratedOps.length > 1) {
      atomicReplayGroups.push(migratedOps.map((migratedOp) => migratedOp.id));
    }
    for (const migratedOp of migratedOps) {
      sourceOpIdByReplayedOpId.set(migratedOp.id, op.id);
    }
    return migratedOps;
  });

  return {
    operations,
    atomicReplayGroups,
    sourceOpIdByReplayedOpId,
    sourceOpIdsWithReplay,
    sourceEntryByOpId,
  };
};
