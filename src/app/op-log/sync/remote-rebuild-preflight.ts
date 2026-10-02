import {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  SchemaMigrationService,
  getOperationSchemaVersion,
} from '../persistence/schema-migration.service';
import { getUnknownOpVocabulary } from './remote-op-block.util';
import { Operation } from '../core/operation.types';
import { OpLog } from '../../core/log';
export const preflightRemoteRebuild = (
  remoteOps: Operation[],
  migration: SchemaMigrationService,
  onIncompatible: () => void,
): Operation[] => {
  for (const op of remoteOps) {
    let version: number;
    try {
      version = getOperationSchemaVersion(op as { schemaVersion?: unknown });
    } catch (e) {
      // Keep the root cause diagnosable (id-only, no payloads) — this is a
      // rare, support-heavy failure path.
      OpLog.err('OperationLogSyncService: USE_REMOTE preflight version parse failed', {
        id: op.id,
        name: (e as Error | undefined)?.name,
      });
      throw new Error(
        'USE_REMOTE aborted: remote history has an invalid schema version.',
        { cause: e },
      );
    }

    if (version < MIN_SUPPORTED_SCHEMA_VERSION) {
      throw new Error(
        'USE_REMOTE aborted: remote history contains an unsupported schema version.',
      );
    }
    if (version > CURRENT_SCHEMA_VERSION || getUnknownOpVocabulary(op) !== null) {
      onIncompatible();
      throw new Error(
        'USE_REMOTE aborted: remote history contains ops from a newer schema version or with an unknown op type — update the app first.',
      );
    }
  }

  try {
    return migration.migrateOperations(remoteOps);
  } catch (e) {
    OpLog.err('OperationLogSyncService: USE_REMOTE preflight migration failed', {
      name: (e as Error | undefined)?.name,
    });
    throw new Error('USE_REMOTE aborted: remote operation migration failed.', {
      cause: e,
    });
  }
};
