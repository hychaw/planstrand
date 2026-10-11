import type { Task, TaskWithSubTasks } from '../tasks/task.model';
import type { TimeTrackingState } from '../time-tracking/time-tracking.model';
import { isValidDBDateStr } from '../../util/get-db-date-str';
import { isValidEntityId } from '../../op-log/validation/is-valid-entity-id';

/** Authenticated domain changes prepared by the archive producer, not replay clocks. */
export interface ArchiveCommandV1 {
  version: 1;
  archivedTasks: Task[];
  transferredTimeTracking: TimeTrackingState;
  lastFlush: number;
  /** Existing flush timestamp; the flush belongs AFTER this command's insertion. */
  flushTimestamp?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const assertArchiveCommand: (
  value: unknown,
  tasks: readonly TaskWithSubTasks[],
) => asserts value is ArchiveCommandV1 = (value, tasks) => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isTimestamp(value.lastFlush) ||
    (value.flushTimestamp !== undefined && value.flushTimestamp !== value.lastFlush) ||
    !Array.isArray(value.archivedTasks) ||
    !isRecord(value.transferredTimeTracking) ||
    Object.keys(value).some(
      (key) =>
        ![
          'version',
          'archivedTasks',
          'transferredTimeTracking',
          'lastFlush',
          'flushTimestamp',
        ].includes(key),
    )
  )
    throw new Error('Invalid or unsupported archive command');

  const expectedIds = new Set(
    tasks.flatMap((task) => [task.id, ...task.subTasks.map((child) => child.id)]),
  );
  const archivedIds = new Set<string>();
  for (const task of value.archivedTasks) {
    if (
      !isRecord(task) ||
      !isValidEntityId(task.id) ||
      !expectedIds.has(task.id) ||
      archivedIds.has(task.id) ||
      task.isDone !== true ||
      !isTimestamp(task.doneOn) ||
      task.dueDay !== undefined ||
      task.dueWithTime !== undefined ||
      task.reminderId !== undefined ||
      typeof task.title !== 'string' ||
      !Array.isArray(task.tagIds) ||
      !Array.isArray(task.subTaskIds) ||
      !isRecord(task.timeSpentOnDay)
    )
      throw new Error('Invalid archive command Task footprint');
    archivedIds.add(task.id);
  }
  if (archivedIds.size !== expectedIds.size || !archivedIds.size)
    throw new Error('Incomplete archive command Task footprint');

  const tracking = value.transferredTimeTracking;
  if (Object.keys(tracking).some((key) => key !== 'project' && key !== 'tag'))
    throw new Error('Invalid archive command time tracking');
  for (const category of ['project', 'tag'] as const) {
    const contexts = tracking[category];
    if (!isRecord(contexts)) throw new Error('Invalid archive command time tracking');
    for (const [id, dates] of Object.entries(contexts)) {
      if (!isValidEntityId(id) || !isRecord(dates))
        throw new Error('Invalid archive command time tracking');
      for (const [date, data] of Object.entries(dates)) {
        if (
          !isValidDBDateStr(date) ||
          !isRecord(data) ||
          Object.entries(data).some(
            ([key, entry]) =>
              !['s', 'e', 'b', 'bt'].includes(key) ||
              typeof entry !== 'number' ||
              !Number.isFinite(entry),
          )
        )
          throw new Error('Invalid archive command time tracking');
      }
    }
  }
};

/** Remove only the transferred values, preserving edits made during async writes. */
export const removeTransferredTimeTracking = (
  state: TimeTrackingState,
  transferred: TimeTrackingState,
): TimeTrackingState => {
  const next: TimeTrackingState = {
    project: { ...state.project },
    tag: { ...state.tag },
  };
  for (const category of ['project', 'tag'] as const) {
    for (const [id, dates] of Object.entries(transferred[category])) {
      const current = state[category][id];
      if (!current) continue;
      const retained = { ...current };
      for (const [date, data] of Object.entries(dates)) {
        const existing = current[date];
        if (
          existing &&
          ['s', 'e', 'b', 'bt'].every(
            (key) =>
              existing[key as keyof typeof existing] === data[key as keyof typeof data],
          )
        )
          delete retained[date];
      }
      next[category][id] = retained;
    }
  }
  return next;
};
