import { SUPER_SYNC_BASELINE_OP_TYPES } from '@sp/shared-schema';
import { FILE_BASED_SYNC_CONSTANTS as LEGACY } from './file-based-sync.types';
import { SyncOperation } from '../provider.interface';

export const PLANSTRAND_FILE_VERSION = 4 as const;
/** Phase 2 must add its stable operation family here with its first writer. */
export const PLANSTRAND_REQUIRED_FILE_OP_TYPES: readonly string[] = Object.freeze([]);

export interface FileSyncNamespace {
  readonly syncFile: string;
  readonly backupFile: string;
  readonly opsFile: string;
  readonly opsBackupFile: string;
  readonly stateFile: string;
  readonly stateBackupFile: string;
  readonly stateGenPrefix: string;
  readonly migrationLockFile: string;
  readonly legacyMetaFile: string;
}

export const LEGACY_SP_FILE_NAMESPACE: FileSyncNamespace = Object.freeze({
  syncFile: LEGACY.SYNC_FILE,
  backupFile: LEGACY.BACKUP_FILE,
  opsFile: LEGACY.OPS_FILE,
  opsBackupFile: LEGACY.OPS_BACKUP_FILE,
  stateFile: LEGACY.STATE_FILE,
  stateBackupFile: LEGACY.STATE_BACKUP_FILE,
  stateGenPrefix: LEGACY.STATE_GEN_FILE_PREFIX,
  migrationLockFile: LEGACY.MIGRATION_LOCK_FILE,
  legacyMetaFile: LEGACY.LEGACY_META_FILE,
});
export const PLANSTRAND_FILE_NAMESPACE: FileSyncNamespace = Object.freeze(
  Object.fromEntries(
    Object.entries(LEGACY_SP_FILE_NAMESPACE).map(([key, value]) => [
      key,
      `planstrand-${value}`,
    ]),
  ) as unknown as FileSyncNamespace,
);

export interface PlanstrandFileEnvelope {
  product: 'planstrand';
  version: typeof PLANSTRAND_FILE_VERSION;
  compatibility: { requiredOpTypes: string[] };
}

/** Separate from recoverable corruption: never adopt a backup past this error. */
export class PlanstrandFileIncompatibleError extends Error {
  override name = 'PlanstrandFileIncompatibleError';
  constructor() {
    super('Unsupported Planstrand file protocol or semantics. Update before syncing.');
  }
}
export class LegacyFileImportRequiredError extends Error {
  override name = 'LegacyFileImportRequiredError';
  constructor() {
    super('Legacy sync data found. Explicitly import it, start fresh, or cancel.');
  }
}

export const requiredFileOpTypes = (
  remote: readonly string[],
  build: readonly string[],
  ops: readonly Pick<SyncOperation, 'opType'>[] = [],
): string[] => {
  const baseline: ReadonlySet<string> = new Set(SUPER_SYNC_BASELINE_OP_TYPES);
  return [
    ...new Set([
      ...remote,
      ...build,
      ...ops.filter((op) => !baseline.has(op.opType)).map((op) => op.opType),
    ]),
  ].sort();
};

export const assertPlanstrandFileEnvelope: (
  data: unknown,
  supported: ReadonlySet<string>,
) => asserts data is PlanstrandFileEnvelope & Record<string, unknown> = (
  data,
  supported,
) => {
  if (!data || typeof data !== 'object') throw new PlanstrandFileIncompatibleError();
  const d = data as Partial<PlanstrandFileEnvelope>;
  const required = d.compatibility?.requiredOpTypes;
  if (
    d.product !== 'planstrand' ||
    d.version !== PLANSTRAND_FILE_VERSION ||
    !Array.isArray(required) ||
    required.some((op) => typeof op !== 'string' || !op.length || !supported.has(op))
  )
    throw new PlanstrandFileIncompatibleError();
};

/** Map only protocol-owned paths; arbitrary paths cannot escape this boundary. */
export const planstrandPath = (logical: string): string => {
  for (const key of Object.keys(
    LEGACY_SP_FILE_NAMESPACE,
  ) as (keyof FileSyncNamespace)[]) {
    if (logical === LEGACY_SP_FILE_NAMESPACE[key]) return PLANSTRAND_FILE_NAMESPACE[key];
  }
  if (/^sync-state__\d+__[a-f0-9]{16}\.json$/.test(logical))
    return `planstrand-${logical}`;
  throw new PlanstrandFileIncompatibleError();
};

export const logicalSnapshotPath = (physical: unknown): string => {
  if (
    typeof physical !== 'string' ||
    !/^planstrand-sync-state__\d+__[a-f0-9]{16}\.json$/.test(physical)
  ) {
    throw new PlanstrandFileIncompatibleError();
  }
  return physical.slice('planstrand-'.length);
};
