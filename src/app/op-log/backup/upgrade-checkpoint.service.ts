import { inject, Injectable } from '@angular/core';
import { BackupService } from './backup.service';
import { OperationWriteFlushService } from '../sync/operation-write-flush.service';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { getPhantomChangeRisk } from '../capture/phantom-change-guard.util';
import { HydrationStateService } from '../apply/hydration-state.service';
import { UpgradeCheckpointResult } from '../../../../electron/shared-with-frontend/upgrade-checkpoint.model';

/** Read-only capture of supported models, for the future desktop updater. */
@Injectable({ providedIn: 'root' })
export class UpgradeCheckpointService {
  private _backup = inject(BackupService);
  private _writeFlush = inject(OperationWriteFlushService);
  private _taskTimeSync = inject(TaskTimeSyncService);
  private _capture = inject(OperationCaptureService);
  private _hydration = inject(HydrationStateService);

  async prepare(): Promise<UpgradeCheckpointResult> {
    if (!window.ea?.writeUpgradeCheckpoint) {
      return { ok: false, reason: 'UNAVAILABLE' };
    }
    try {
      this._taskTimeSync.flush();
      const data = await this._writeFlush.flushThenRunExclusive(async () => {
        if (
          this._hydration.isHydrationInProgress() ||
          this._hydration.isHydrationFallbackActive() ||
          this._hydration.isInSyncWindow() ||
          getPhantomChangeRisk(this._capture)
        ) {
          throw new Error('Checkpoint consistency boundary unavailable');
        }
        const backup = await this._backup.loadCompleteBackup(true);
        const { validateFull, validateAppDataProperty } =
          await import('../validation/validation-fn');
        if (
          !validateFull(backup.data).isValid ||
          !validateAppDataProperty('archiveYoung', backup.data.archiveYoung).success ||
          !validateAppDataProperty('archiveOld', backup.data.archiveOld).success
        ) {
          throw new Error('Checkpoint state is invalid');
        }
        // Detach from live store references before releasing the boundary.
        return JSON.parse(JSON.stringify(backup)) as typeof backup;
      });
      return await window.ea.writeUpgradeCheckpoint(data);
    } catch {
      // Fail closed without repair, import, reset, or logging private data.
      return { ok: false, reason: 'PREPARATION_FAILED' };
    }
  }
}
