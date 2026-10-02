import { TaskState } from '../tasks/task.model';
import { WorkSession, WorkSessionState } from './work-session.model';
import { resolveIanaTimeZone } from '../../util/iana-time-zone';
import { isValidEntityId } from '../../op-log/validation/is-valid-entity-id';

// Length-prefix the Task ID: collision-free without hashing or a dependency.
// The ID records original scheduling provenance even if the session is edited.
const PREFIX = 'legacy-task-schedule:';
export const isLegacyTaskWorkSessionId = (id: string): boolean => id.startsWith(PREFIX);
export const legacyTaskWorkSessionId = (taskId: string, start: number): string =>
  `${PREFIX}${taskId.length}:${taskId}:${start}`;

/** Decode only canonical IDs, including Task IDs containing colons. */
export const parseLegacyTaskWorkSessionId = (
  id: string,
): { taskId: string; originalTimestamp: number } | null => {
  const match = /^legacy-task-schedule:(\d+):/.exec(id);
  if (!match) return null;
  const length = Number(match[1]);
  if (!Number.isSafeInteger(length) || length <= 0) return null;
  const taskId = id.slice(match[0].length, match[0].length + length);
  const start = Number(id.slice(match[0].length + length + 1));
  return isValidEntityId(taskId) &&
    Number.isFinite(start) &&
    start >= 0 &&
    legacyTaskWorkSessionId(taskId, start) === id
    ? { taskId, originalTimestamp: start }
    : null;
};

/** Replay materialization is restricted to the canonical deterministic identity. */
export const isDeterministicLegacyTaskWorkSessionId = (id: string): boolean =>
  parseLegacyTaskWorkSessionId(id) !== null;

/** Startup-only compatibility transformation. Never call from scheduling writes. */
export const backfillLegacyTaskWorkSessions = (
  tasks: TaskState,
  sessions: WorkSessionState,
  configuredTimeZone: string | null | undefined,
): WorkSessionState => {
  const additions: WorkSession[] = [];
  let timeZone: string | null | undefined;
  for (const taskId of [...tasks.ids].sort()) {
    const task = tasks.entities[taskId];
    const start = task?.dueWithTime;
    if (
      !task ||
      task.id !== taskId ||
      !isValidEntityId(taskId) ||
      typeof start !== 'number' ||
      !Number.isFinite(start) ||
      start < 0
    )
      continue;
    const id = legacyTaskWorkSessionId(taskId, start);
    if (sessions.entities[id] || sessions.dismissedLegacySessionIds?.includes(id))
      continue;
    const duration = task.timeEstimate;
    const end = start + duration;
    if (
      typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(end) ||
      end <= start
    )
      continue;
    // Task scheduling has no trustworthy provider timezone metadata.
    // Existing IDs retain their original persisted zone.
    timeZone ??= resolveIanaTimeZone(configuredTimeZone);
    if (!timeZone) continue;
    additions.push({ id, taskId, start, end, timeZone, created: start, modified: start });
  }
  if (!additions.length) return sessions;
  return {
    ...sessions,
    ids: [...sessions.ids, ...additions.map((session) => session.id)],
    entities: {
      ...sessions.entities,
      ...Object.fromEntries(additions.map((s) => [s.id, s])),
    },
  };
};
