import { Operation } from '../core/operation.types';
import {
  ArchiveStoreEntry,
  SINGLETON_KEY,
  STORE_NAMES,
  FULL_STATE_OPS_META_KEY,
  RAW_REBUILD_INCOMPLETE_META_KEY,
  RAW_REBUILD_RECOVERY_META_KEY,
} from './db-keys.const';
import { buildFullStateOpsMeta } from './full-state-ops-meta';
import { getFullStateRequiredCapabilities } from '@sp/shared-schema';
import { getOperationRequiredCapabilities } from '../sync/sync-capability.util';
import { OpLogDbAdapter, OpLogTx } from './op-log-db-adapter';
import {
  StateCacheEntry,
  StoredOperationLogEntry,
  decodeStoredEntry,
} from './operation-log-store-rows';

export const SEMANTIC_REQUIREMENTS_META_KEY = 'semanticRequirements';
export const SEMANTIC_REQUIREMENTS_STORES: Array<
  (typeof STORE_NAMES)[keyof typeof STORE_NAMES]
> = [
  STORE_NAMES.OPS,
  STORE_NAMES.META,
  STORE_NAMES.STATE_CACHE,
  STORE_NAMES.IMPORT_BACKUP,
];

/** The existing META store keeps a monotonic floor without a DB version bump.
 * Scan retained rows to adopt requirements written before this metadata existed.
 * Deletion/replacement callers use the same transaction before removing history.
 */
export const preserveSemanticRequirementsInTx = async (
  tx: OpLogTx,
  state?: unknown,
): Promise<string[]> => {
  const key = SEMANTIC_REQUIREMENTS_META_KEY;
  const existing = (await tx.get<string[]>(STORE_NAMES.META, key)) ?? [];
  const required = new Set([...existing, ...getFullStateRequiredCapabilities(state)]);
  await tx.iterate<StoredOperationLogEntry>(STORE_NAMES.OPS, {}, (entry) => {
    for (const capability of getOperationRequiredCapabilities(
      decodeStoredEntry(entry).op,
    ))
      required.add(capability);
    return 'continue';
  });
  // Include the previous compaction snapshot used by recovery, not just live state.
  await tx.iterate<StateCacheEntry>(STORE_NAMES.STATE_CACHE, {}, (entry) => {
    for (const capability of getFullStateRequiredCapabilities(entry.state))
      required.add(capability);
    return 'continue';
  });
  await tx.iterate<{ state?: unknown }>(STORE_NAMES.IMPORT_BACKUP, {}, (entry) => {
    for (const capability of getFullStateRequiredCapabilities(entry.state))
      required.add(capability);
    return 'continue';
  });
  const capabilities = [...required].sort();
  if (capabilities.some((capability) => !existing.includes(capability))) {
    await tx.put(STORE_NAMES.META, capabilities, key);
  }
  return capabilities;
};

export const retainSemanticRequirements = async (
  adapter: OpLogDbAdapter,
  requiredCapabilities: readonly string[],
): Promise<void> => {
  await adapter.transaction([STORE_NAMES.META], 'readwrite', async (tx) => {
    const current =
      (await tx.get<string[]>(STORE_NAMES.META, SEMANTIC_REQUIREMENTS_META_KEY)) ?? [];
    await tx.put(
      STORE_NAMES.META,
      [...new Set([...current, ...requiredCapabilities])].sort(),
      SEMANTIC_REQUIREMENTS_META_KEY,
    );
  });
};

export const saveStateCacheWithSemanticRequirements = async (
  adapter: OpLogDbAdapter,
  snapshot: StateCacheEntry,
): Promise<void> => {
  await adapter.transaction(SEMANTIC_REQUIREMENTS_STORES, 'readwrite', async (tx) => {
    const requiredCapabilities = await preserveSemanticRequirementsInTx(
      tx,
      snapshot.state,
    );
    await tx.put(STORE_NAMES.STATE_CACHE, {
      ...snapshot,
      state: requiredCapabilities.length
        ? { ...(snapshot.state as object), requiredCapabilities }
        : snapshot.state,
    });
  });
};

/** Keep activation and the authored replacement in the same transaction before
 * removing the last requirement-bearing operation. Incoming operation identities
 * are never rewritten; this caller owns a newly authored local replacement.
 */
export const persistReplacementWithSemanticRequirements = async (
  tx: OpLogTx,
  op: Operation,
  buildEntry: (op: Operation) => Omit<StoredOperationLogEntry, 'seq'>,
  snapshot: {
    compactedAt: number;
    snapshotEntityKeys: string[];
    archiveYoung?: ArchiveStoreEntry['data'];
    archiveOld?: ArchiveStoreEntry['data'];
  },
): Promise<number> => {
  const requiredCapabilities = await preserveSemanticRequirementsInTx(tx, op.payload);
  for (const capability of op.requiredCapabilities ?? []) {
    if (!requiredCapabilities.includes(capability)) requiredCapabilities.push(capability);
  }
  if (requiredCapabilities.length) {
    op.requiredCapabilities = requiredCapabilities;
    await tx.put(STORE_NAMES.META, requiredCapabilities, SEMANTIC_REQUIREMENTS_META_KEY);
    op.payload = { ...(op.payload as object), requiredCapabilities };
  }
  await tx.clear(STORE_NAMES.OPS);

  // The caller establishes TabSeqFrontierService only after this transaction commits.
  // eslint-disable-next-line local-rules/require-frontier-report-on-ops-append -- Caller reports seq after commit.
  const seq = await tx.add(STORE_NAMES.OPS, buildEntry(op));
  // op is always a full-state op (both callers pass SYNC_IMPORT);
  // OPS was just cleared, so the pointer is exactly this one op. Use the
  // shared builder so `latest` is derived, never hand-asserted.
  await tx.put(
    STORE_NAMES.META,
    buildFullStateOpsMeta([{ opId: op.id, seq }]),
    FULL_STATE_OPS_META_KEY,
  );

  // This replacement supersedes any interrupted USE_REMOTE rebuild. Clear
  // the marker in the same transaction as the restored/clean-slate
  // baseline so a successful Undo cannot immediately re-enter recovery.
  await tx.delete(STORE_NAMES.META, RAW_REBUILD_INCOMPLETE_META_KEY);
  await tx.delete(STORE_NAMES.META, RAW_REBUILD_RECOVERY_META_KEY);

  const { compactedAt, snapshotEntityKeys, archiveYoung, archiveOld } = snapshot;

  await tx.put(
    STORE_NAMES.VECTOR_CLOCK,
    { clock: op.vectorClock, lastUpdate: Date.now() },
    SINGLETON_KEY,
  );

  await tx.put(STORE_NAMES.STATE_CACHE, {
    id: SINGLETON_KEY,
    state: op.payload,
    lastAppliedOpSeq: seq,
    vectorClock: op.vectorClock,
    compactedAt,
    schemaVersion: op.schemaVersion,
    snapshotEntityKeys,
  });

  if (archiveYoung != null) {
    await tx.put(STORE_NAMES.ARCHIVE_YOUNG, {
      id: SINGLETON_KEY,
      data: archiveYoung,
      lastModified: compactedAt,
    });
  }

  if (archiveOld != null) {
    await tx.put(STORE_NAMES.ARCHIVE_OLD, {
      id: SINGLETON_KEY,
      data: archiveOld,
      lastModified: compactedAt,
    });
  }

  return seq;
};
