import { inject, Injectable } from '@angular/core';
import { Task, TaskArchive, TaskWithSubTasks } from '../tasks/task.model';
import { flattenTasks } from '../tasks/store/task.selectors';
import { createEmptyEntity } from '../../util/create-empty-entity';
import { taskAdapter } from '../tasks/store/task.adapter';
import {
  sortTimeTrackingAndTasksFromArchiveYoungToOld,
  sortTimeTrackingDataToArchiveYoung,
} from './util/sort-data-to-flush';
import { Store } from '@ngrx/store';
import { TimeTrackingActions } from '../time-tracking/store/time-tracking.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { ArchiveCommandV1, assertArchiveCommand } from './archive-command';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { isReducerRejectedAction } from '../../root-store/meta/reducer-failure-guard.meta-reducer';
import { getDbDateStr } from '../../util/get-db-date-str';
import { Log } from '../../core/log';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from './archive.model';
import { TimeTrackingState } from '../time-tracking/time-tracking.model';
import { first } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { selectTimeTrackingState } from '../time-tracking/store/time-tracking.selectors';
import { isValidEntityId } from '../../op-log/validation/is-valid-entity-id';
import { LockService } from '../../op-log/sync/lock.service';
import { LOCK_NAMES } from '../../op-log/core/operation-log.const';
import { selectWorkSessionFeatureState } from '../work-session/store/work-session.selectors';
import { assertNoWorkSessionsForTasks } from '../work-session/store/work-session.reducer';

/**
 * Maps tasks to archive format by:
 * - Setting isDone=true
 * - Computing doneOn from task.doneOn, parent.doneOn, or fallback to now
 * - Clearing reminder/scheduling fields
 */
const mapTasksToArchiveFormat = (
  flatTasks: Task[],
  now: number,
  logPrefix: string,
): Task[] => {
  return flatTasks.map((task: Task) => {
    let doneOn: number;
    if (task.isDone && task.doneOn) {
      doneOn = task.doneOn;
    } else if (task.parentId) {
      const parent = flatTasks.find((t) => t.id === task.parentId);
      if (parent) {
        doneOn = parent.doneOn || now;
      } else {
        Log.warn(
          `[ArchiveService] ${logPrefix}: Subtask ${task.id} has parentId ${task.parentId} but parent not found in flatTasks, using current time`,
        );
        doneOn = now;
      }
    } else {
      doneOn = now;
    }
    return {
      ...task,
      reminderId: undefined,
      isDone: true,
      dueWithTime: undefined,
      dueDay: undefined,
      _hideSubTasksMode: undefined,
      doneOn,
    };
  });
};

const replaceTasksInArchive = (
  archiveTasks: Task[],
  taskArchiveState: TaskArchive,
): TaskArchive => {
  const updatedTaskArchive = taskAdapter.setMany(archiveTasks, taskArchiveState);
  const uniqueStringIds = new Set(
    updatedTaskArchive.ids.filter((id): id is string => typeof id === 'string'),
  );

  return {
    ...updatedTaskArchive,
    // Keep retry output deterministic even when an older archive already
    // contains duplicate or unsorted IDs.
    ids: [...uniqueStringIds].sort(),
  };
};

export const sanitizeTasksForArchiving = (
  tasksIn: TaskWithSubTasks[],
  logPrefix: string,
): TaskWithSubTasks[] => {
  let droppedRootTasks = 0;
  let droppedSubTasks = 0;

  const sanitizedTasks = tasksIn.flatMap((task) => {
    if (!task || !isValidEntityId(task.id)) {
      droppedRootTasks++;
      return [];
    }

    const subTasks = (task.subTasks || []).filter((subTask) => {
      const isValid = !!subTask && isValidEntityId(subTask.id);
      if (!isValid) {
        droppedSubTasks++;
      }
      return isValid;
    });

    // Keep subTaskIds in sync with the surviving subTasks so the archived
    // parent cannot carry dangling references when subtasks are dropped.
    const survivingSubTaskIds = new Set(subTasks.map((st) => st.id));
    const subTaskIds = Array.isArray(task.subTaskIds)
      ? task.subTaskIds.filter((id) => survivingSubTaskIds.has(id))
      : [];

    return [
      {
        ...task,
        subTasks,
        subTaskIds,
      },
    ];
  });

  if (droppedRootTasks > 0 || droppedSubTasks > 0) {
    Log.warn(`[ArchiveService] ${logPrefix}: Dropped malformed archive payload tasks`, {
      // eslint-disable-next-line local-rules/no-user-content-in-logs -- grandfathered log baseline (2026-09), not yet triaged
      droppedRootTasks,
      // eslint-disable-next-line local-rules/no-user-content-in-logs -- grandfathered log baseline (2026-09), not yet triaged
      droppedSubTasks,
      originalTaskCount: tasksIn.length,
      sanitizedTaskCount: sanitizedTasks.length,
    });
  }

  return sanitizedTasks;
};

/*
# Considerations for flush architecture:
** The main purpose of flushing is mainly to reduce the amount of data that needs to be transferred over the network **
Roughly we aim at these 3 syncs to occur under normal circumstances:

every sync  => sync the meta file
daily       => +archiveYoung (moving tasks to archive)
less often  => +archiveOld (after flushing data from archiveYoung to archiveOld)

## Other considerations:

timeTracking:
* (currently) there seems to be no writing of archiveYoung or archiveOld like there is for archive tasks, when editing tasks in worklog
=> archiveOld.timeTracking and archiveYoung.timeTracking can be read-only
* data for today should never be in the archive and always be in the store to avoid problems when doing partial updates
=> timeTracking should always retain some data, at least for today (or  maybe later for the whole current week, if we want to make it editable)

taskArchive:
* data in archiveYoung should be faster to access and write
* when updating some old data, we need to upload archiveOld regardless of flushing
=> makes sense to retain data in archiveYoung that is likely to be accessed more often
=> 21 days is maybe a good middle ground for this, since it allows us to write data from the last month
 */

export const ARCHIVE_ALL_YOUNG_TO_OLD_THRESHOLD = 1000 * 60 * 60 * 24 * 14;
export const ARCHIVE_TASK_YOUNG_TO_OLD_THRESHOLD = 1000 * 60 * 60 * 24 * 21;

const DEFAULT_TIME_TRACKING: TimeTrackingState = {
  project: {},
  tag: {},
};

const DEFAULT_ARCHIVE: ArchiveModel = {
  task: createEmptyEntity(),
  timeTracking: DEFAULT_TIME_TRACKING,
  lastTimeTrackingFlush: 0,
};

@Injectable({
  providedIn: 'root',
})
export class ArchiveService {
  private readonly _archiveDbAdapter = inject(ArchiveDbAdapter);
  private readonly _store = inject(Store);
  private readonly _lockService = inject(LockService);
  private readonly _captureService = inject(OperationCaptureService);

  /**
   * Serializes task archive read-modify-write cycles. Separate task actions can
   * arrive before either IndexedDB write finishes; without one shared queue,
   * both calls can read the same archive and the last save silently drops the
   * other task. A failed mutation does not poison later retries.
   */
  private _runTaskArchiveMutation(mutation: () => Promise<void>): Promise<void> {
    return this._lockService.request(LOCK_NAMES.TASK_ARCHIVE, mutation);
  }

  /** Owns archive insertion, optional flush, and their single captured command. */
  moveTasksToArchiveAndFlushArchiveIfDue(tasks: TaskWithSubTasks[]): Promise<void> {
    // Same lock order as sync. Snapshots cannot observe unacknowledged archive
    // writes; on release the dispatched action is counted as pending capture.
    return this._lockService.request(LOCK_NAMES.OPERATION_LOG, () =>
      this._runTaskArchiveMutation(() =>
        this._moveTasksToArchiveAndFlushArchiveIfDue(tasks),
      ),
    );
  }

  private async _moveTasksToArchiveAndFlushArchiveIfDue(
    tasks: TaskWithSubTasks[],
  ): Promise<void> {
    const now = Date.now();
    const sanitizedTasks = sanitizeTasksForArchiving(tasks, 'moveToArchive');
    const flatTasks = flattenTasks(sanitizedTasks);
    if (!flatTasks.length) return;
    const sessions = await firstValueFrom(
      this._store.select(selectWorkSessionFeatureState).pipe(first()),
    );
    assertNoWorkSessionsForTasks(sessions, new Set(flatTasks.map((task) => task.id)));
    const archiveYoung =
      (await this._archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    const archiveOld = (await this._archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
    const timeTracking = await firstValueFrom(
      this._store.select(selectTimeTrackingState).pipe(first()),
    );
    // Only the transferred records belong to this command. Later reducers and
    // archive-only crash retries must never read a later window's active store.
    const transferred = sortTimeTrackingDataToArchiveYoung({
      timeTracking: timeTracking || DEFAULT_TIME_TRACKING,
      archiveYoung: DEFAULT_ARCHIVE,
      todayStr: getDbDateStr(now),
    }).archiveYoung.timeTracking;
    const isFlushDue =
      archiveOld.lastTimeTrackingFlush === undefined ||
      now - archiveOld.lastTimeTrackingFlush > ARCHIVE_ALL_YOUNG_TO_OLD_THRESHOLD;
    // Normalize the source through the wire representation too: optional fields
    // must not differ between local IndexedDB and a serialized remote command.
    const archiveCommand: ArchiveCommandV1 = JSON.parse(
      JSON.stringify({
        version: 1,
        archivedTasks: mapTasksToArchiveFormat(flatTasks, now, 'moveToArchive'),
        transferredTimeTracking: transferred,
        lastFlush: now,
        ...(isFlushDue ? { flushTimestamp: now } : {}),
      }),
    );
    assertArchiveCommand(archiveCommand, sanitizedTasks);
    const result = this._applyArchiveCommand(archiveYoung, archiveOld, archiveCommand);
    await this._archiveDbAdapter.saveArchivesAtomic(
      result.archiveYoung,
      result.archiveOld,
    );
    const action = TaskSharedActions.moveToArchive({
      tasks: sanitizedTasks,
      archiveCommand,
    });
    try {
      this._store.dispatch(action);
      if (isReducerRejectedAction(action))
        throw new Error('Archive command reducer rejected');
    } catch (error) {
      try {
        await this._archiveDbAdapter.saveArchivesAtomic(archiveYoung, archiveOld);
      } catch (rollbackError) {
        this._captureService.markUnrecoveredPersistFailure();
        throw new AggregateError(
          [error, rollbackError],
          'Archive command rollback failed',
        );
      }
      throw error;
    }
  }

  /** Replay also uses the prepared records on archive-only retries. */
  applyArchiveCommand(
    tasks: TaskWithSubTasks[],
    command: ArchiveCommandV1,
  ): Promise<void> {
    assertArchiveCommand(command, tasks);
    return this._runTaskArchiveMutation(async () => {
      const young = (await this._archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
      const old = (await this._archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
      const result = this._applyArchiveCommand(young, old, command);
      await this._archiveDbAdapter.saveArchivesAtomic(
        result.archiveYoung,
        result.archiveOld,
      );
    });
  }

  private _applyArchiveCommand(
    young: ArchiveModel,
    old: ArchiveModel,
    command: ArchiveCommandV1,
  ): { archiveYoung: ArchiveModel; archiveOld: ArchiveModel } {
    const timeTracking: TimeTrackingState = {
      project: { ...young.timeTracking.project },
      tag: { ...young.timeTracking.tag },
    };
    for (const category of ['project', 'tag'] as const) {
      for (const [id, dates] of Object.entries(
        command.transferredTimeTracking[category],
      )) {
        timeTracking[category][id] = { ...timeTracking[category][id], ...dates };
      }
    }
    const archiveYoung = {
      ...young,
      task: replaceTasksInArchive(command.archivedTasks, young.task),
      timeTracking,
      lastFlush: command.lastFlush,
    };
    if (command.flushTimestamp === undefined) return { archiveYoung, archiveOld: old };
    const sorted = sortTimeTrackingAndTasksFromArchiveYoungToOld({
      archiveYoung,
      archiveOld: old,
      threshold: ARCHIVE_TASK_YOUNG_TO_OLD_THRESHOLD,
      now: command.flushTimestamp,
    });
    return {
      archiveYoung: {
        ...sorted.archiveYoung,
        lastTimeTrackingFlush: command.flushTimestamp,
      },
      archiveOld: { ...sorted.archiveOld, lastTimeTrackingFlush: command.flushTimestamp },
    };
  }

  /**
   * Writes tasks to archiveYoung for remote sync operations.
   * Also moves historical time tracking data to archiveYoung to keep
   * the client's archive consistent with the originating client.
   *
   * Used only for legacy moveToArchive operations without a prepared command.
   *
   * Note: This method does NOT check if flush is due. Flushes are triggered
   * only on the originating client and synced via the flushYoungToOld action.
   * This ensures flushes happen exactly once, not on every receiving client.
   */
  writeTasksToArchiveForRemoteSync(tasks: TaskWithSubTasks[]): Promise<void> {
    return this._runTaskArchiveMutation(() =>
      this._writeTasksToArchiveForRemoteSync(tasks),
    );
  }

  private async _writeTasksToArchiveForRemoteSync(
    tasks: TaskWithSubTasks[],
  ): Promise<void> {
    const now = Date.now();
    const sanitizedTasks = sanitizeTasksForArchiving(tasks, 'Remote sync');
    const flatTasks = flattenTasks(sanitizedTasks);

    Log.log('[ArchiveService] writeTasksToArchiveForRemoteSync:', {
      inputTasksCount: tasks.length,
      sanitizedTaskCount: sanitizedTasks.length,
      flatTasksCount: flatTasks.length,
      taskIds: flatTasks.map((t) => t.id),
    });

    if (!flatTasks.length) {
      Log.log('[ArchiveService] No valid tasks to archive for remote sync');
      return;
    }

    const archiveYoung =
      (await this._archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    const taskArchiveState = archiveYoung.task || createEmptyEntity();

    const archiveTasks = mapTasksToArchiveFormat(flatTasks, now, 'Remote sync');
    const newTaskArchive = replaceTasksInArchive(archiveTasks, taskArchiveState);

    // Also move historical time tracking data to archiveYoung
    // This ensures the remote client's archive matches the originating client
    // Get time tracking from the store as it is fresher
    const timeTracking = await firstValueFrom(
      this._store.select(selectTimeTrackingState).pipe(first()),
    );
    const sorted = sortTimeTrackingDataToArchiveYoung({
      timeTracking: timeTracking || DEFAULT_TIME_TRACKING,
      archiveYoung,
      todayStr: getDbDateStr(now),
    });

    // Note: ArchiveDbAdapter uses direct IndexedDB access (same DB as PFAPI)
    // so there's no conflict with PFAPI's lock mechanism
    await this._archiveDbAdapter.saveArchiveYoung({
      ...sorted.archiveYoung,
      task: newTaskArchive,
    });

    // Update active time tracking state (remove historical data that was moved to archive)
    this._store.dispatch(
      TimeTrackingActions.updateWholeState({
        newState: sorted.timeTracking,
      }),
    );

    Log.log(
      '[ArchiveService] Remote sync: saved tasks and time tracking to archiveYoung:',
      {
        archivedTaskCount: Object.keys(newTaskArchive.entities).length,
      },
    );
  }
}
