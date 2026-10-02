import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { FileSyncProvider, FileSnapshotOpDownloadResponse } from '../provider.interface';
import { SyncProviderId } from '../provider.const';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { EncryptAndCompressHandlerService } from '../../encryption/encrypt-and-compress-handler.service';
import {
  FileBasedOpsFile,
  FileBasedStateFile,
  FileBasedSyncData,
} from './file-based-sync.types';
import { assertSyncFileVersion } from './assert-sync-file-version';
import { compactToSyncOp } from './file-based-operation-conversion.util';
import { getRemoteOpBlockReason } from '../../sync/remote-op-block.util';
import { compareVectorClocks } from '../../../core/util/vector-clock';
import {
  DecompressError,
  DecryptError,
  InvalidDataSPError,
  JsonParseError,
  RemoteFileNotFoundAPIError,
  SyncDataCorruptedError,
  UploadRevToMatchMismatchAPIError,
} from '../../core/errors/sync-errors';
import {
  LEGACY_SP_FILE_NAMESPACE as L,
  logicalSnapshotPath,
  PlanstrandFileIncompatibleError,
} from './planstrand-file-protocol';
import { filePresent } from './planstrand-file-transport';

type Provider = FileSyncProvider<SyncProviderId>;
export interface LegacyImportSource {
  response: FileSnapshotOpDownloadResponse;
  schemaVersion: number;
  verifyRevision: () => Promise<void>;
}

/** Read/import only. No source upload, tombstone, migration resume, or deletion. */
export const readLegacyImportSource = async (
  provider: Provider,
  cfg: EncryptAndCompressCfg,
  key: string | undefined,
): Promise<LegacyImportSource> => {
  const handler = new EncryptAndCompressHandlerService();
  const revisions = new Map<string, string>();
  const read = async <T extends { version: number }>(
    path: string,
    version: number,
    backup?: string,
  ): Promise<T> => {
    const response = await provider.downloadFile(path);
    revisions.set(path, response.rev);
    try {
      const data = await handler.decompressAndDecryptData<T>(cfg, key, response.dataStr);
      assertSyncFileVersion(data, version, path);
      return data;
    } catch (e) {
      const recoverable =
        e instanceof InvalidDataSPError ||
        e instanceof JsonParseError ||
        e instanceof DecryptError ||
        e instanceof DecompressError ||
        (e instanceof SyncDataCorruptedError && !e.isRemoteNewer);
      if (!recoverable || !backup) throw e;
      return read<T>(backup, version);
    }
  };
  let state: FileBasedSyncData | FileBasedStateFile;
  let ops: FileBasedSyncData | FileBasedOpsFile;
  if (await filePresent(provider, L.opsFile)) {
    ops = await read<FileBasedOpsFile>(L.opsFile, 3, L.opsBackupFile);
    if (ops.migration)
      throw new Error('Finish the interrupted legacy migration before importing.');
    const snapshotPath = ops.snapshotRef.file;
    if (snapshotPath) {
      // Same grammar used by namespace translation; no external paths allowed.
      logicalSnapshotPath(`planstrand-${snapshotPath}`);
      state = await read<FileBasedStateFile>(snapshotPath, 3);
    } else {
      state = await read<FileBasedStateFile>(L.stateFile, 3, L.stateBackupFile);
    }
    if (
      state.syncVersion !== ops.snapshotRef.syncVersion ||
      compareVectorClocks(state.vectorClock, ops.snapshotRef.vectorClock) !== 'EQUAL'
    ) {
      throw new PlanstrandFileIncompatibleError();
    }
  } else {
    state = ops = await read<FileBasedSyncData>(L.syncFile, 2, L.backupFile);
  }
  if (
    !Number.isInteger(ops.schemaVersion) ||
    ops.schemaVersion < 1 ||
    ops.schemaVersion > CURRENT_SCHEMA_VERSION ||
    !Array.isArray(ops.recentOps) ||
    !state.state ||
    typeof state.state !== 'object'
  ) {
    throw new PlanstrandFileIncompatibleError();
  }
  const converted = ops.recentOps.map(compactToSyncOp);
  if (converted.some((op) => getRemoteOpBlockReason(op, CURRENT_SCHEMA_VERSION))) {
    throw new PlanstrandFileIncompatibleError();
  }
  const snapshotSeq = state.syncVersion;
  const applied =
    'snapshotRef' in ops
      ? ops.recentOps
          .filter((op) => op.sv === undefined || op.sv <= snapshotSeq)
          .map((op) => op.id)
      : converted.map((op) => op.id);
  return {
    schemaVersion: ops.schemaVersion,
    response: {
      ops: converted.map((op, i) => ({ op, serverSeq: i + 1, receivedAt: op.timestamp })),
      hasMore: false,
      latestSeq: ops.syncVersion,
      snapshotVectorClock: ops.vectorClock,
      snapshotAppliedOpIds: applied,
      snapshotSchemaVersion: state.schemaVersion ?? ops.schemaVersion,
      snapshotState: {
        ...(state.state as object),
        ...(state.archiveYoung ? { archiveYoung: state.archiveYoung } : {}),
        ...(state.archiveOld ? { archiveOld: state.archiveOld } : {}),
      },
    },
    verifyRevision: async () => {
      for (const [path, rev] of revisions) {
        let fresh: string;
        try {
          fresh = (await provider.getFileRev(path, null)).rev;
        } catch (e) {
          if (!(e instanceof RemoteFileNotFoundAPIError)) throw e;
          fresh = '';
        }
        if (!rev || fresh !== rev) throw new UploadRevToMatchMismatchAPIError();
      }
    },
  };
};
