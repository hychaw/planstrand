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
