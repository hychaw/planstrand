import {
  CURRENT_SCHEMA_VERSION,
  SUPER_SYNC_OP_TYPES,
  SUPER_SYNC_IMPORT_REASONS,
} from '@sp/shared-schema';
import { KNOWN_ACTION_TYPES } from '../core/action-types.enum';
import { LWW_UPDATE_ACTION_TYPES } from '../core/lww-update-action-types';
import {
  getOperationSchemaVersion,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../persistence/schema-migration.service';

export const KNOWN_OP_TYPES: ReadonlySet<string> = new Set<string>(SUPER_SYNC_OP_TYPES);
// Conflict resolution emits synthetic actions outside the immutable NgRx enum.
// Accept only the exact LWW vocabulary generated from the shared ENTITY_TYPES.
const KNOWN_REMOTE_ACTION_TYPES: ReadonlySet<string> = new Set([
  ...KNOWN_ACTION_TYPES,
  ...LWW_UPDATE_ACTION_TYPES,
]);
const KNOWN_IMPORT_REASONS: ReadonlySet<string> = new Set<string>(
  SUPER_SYNC_IMPORT_REASONS,
);

/** Wire metadata is untrusted, irrespective of the local TypeScript enums. */
interface RemoteOpVocabularyInput {
  opType?: unknown;
  actionType?: unknown;
  syncImportReason?: unknown;
}

export type UnknownOpVocabulary = 'opType' | 'actionType' | 'syncImportReason';

/**
 * Names the vocabulary field of a remote op this client cannot interpret, or
 * `null` when every value is known.
 *
 * The wire contract deliberately parses `opType` / `actionType` / `syncImportReason` as loose
 * strings (#8764) so a newer client's ops never wedge an older one at the
 * transport layer. The receiver must therefore make the call per op: an
 * unknown value means a newer client widened the vocabulary, and this client
 * can neither apply the op (unknown semantics) nor skip it (silent loss).
 */
export const getUnknownOpVocabulary = (
  op: RemoteOpVocabularyInput,
): UnknownOpVocabulary | null => {
  // File envelopes do not have the API transport's structural guarantees.
  // Required vocabulary must be checked even when absent.
  if (!isKnownRequiredVocabulary(op.opType, KNOWN_OP_TYPES)) {
    return 'opType';
  }
  if (!isKnownRequiredVocabulary(op.actionType, KNOWN_REMOTE_ACTION_TYPES)) {
    return 'actionType';
  }
  if (!isKnownOptionalVocabulary(op.syncImportReason, KNOWN_IMPORT_REASONS)) {
    return 'syncImportReason';
  }
  return null;
};

const isKnownRequiredVocabulary = (value: unknown, known: ReadonlySet<string>): boolean =>
  typeof value === 'string' && value.length > 0 && known.has(value);

const isKnownOptionalVocabulary = (value: unknown, known: ReadonlySet<string>): boolean =>
  value === undefined || isKnownRequiredVocabulary(value, known);

/**
 * Why a remote batch stops at an op it cannot terminally process. Every reason
 * freezes the server cursor at the blocked op (see
 * `RemoteOpsProcessingService.processRemoteOps`). `MIGRATION_FAILED` is only
 * known after attempting the migration and is therefore not returned by
 * {@link getRemoteOpBlockReason}.
 */
export type RemoteOpBlockReason =
  | 'VERSION_UNSUPPORTED'
  | 'VERSION_TOO_NEW'
  | 'UNKNOWN_OP_VOCABULARY'
  | 'INVALID_SCHEMA_VERSION'
  | 'MIGRATION_FAILED';

/**
 * The ONE predicate for "this client cannot process this remote op", shared
 * by the processing loop and every pre-processing step that must not act on
 * (or prompt about) an op the loop will then refuse. Order matches the loop:
 * schema-version checks first, vocabulary second.
 */
export const getRemoteOpBlockReason = (
  op: RemoteOpVocabularyInput & { schemaVersion?: unknown },
  currentVersion: number,
): Exclude<RemoteOpBlockReason, 'MIGRATION_FAILED'> | null => {
  let opVersion: number;
  try {
    opVersion = getOperationSchemaVersion(op);
  } catch {
    return 'INVALID_SCHEMA_VERSION';
  }
  // Below minimum supported version: no migration path exists.
  if (opVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    return 'VERSION_UNSUPPORTED';
  }
  // Newer schema version: real migrations rename/split fields, so applying
  // a future op verbatim corrupts state.
  if (opVersion > currentVersion) {
    return 'VERSION_TOO_NEW';
  }
  // Unknown opType / actionType / syncImportReason: a newer client widened the wire
  // vocabulary without a schema bump (the default per the bump policy).
  // Same treatment as VERSION_TOO_NEW — block, lossless, update-app UX —
  // never skip: advancing the cursor past an op this client never
  // understood is silent data loss.
  if (getUnknownOpVocabulary(op) !== null) {
    return 'UNKNOWN_OP_VOCABULARY';
  }
  return null;
};

/**
 * Everything before the first op {@link getRemoteOpBlockReason} would block
 * on. `processRemoteOps` stops at that op, so pre-processing steps (e.g. the
 * full-state conflict gate) must not act on — or prompt the user about —
 * anything from it onwards.
 */
export const takeInterpretableOpPrefix = <
  T extends RemoteOpVocabularyInput & { schemaVersion?: unknown },
>(
  ops: readonly T[],
  currentVersion: number = CURRENT_SCHEMA_VERSION,
): T[] => {
  const blockedIndex = ops.findIndex(
    (op) => getRemoteOpBlockReason(op, currentVersion) !== null,
  );
  return blockedIndex === -1 ? [...ops] : ops.slice(0, blockedIndex);
};
