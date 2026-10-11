import { isPlanningState } from '@sp/shared-schema';
import { validateFolderRecoveryState } from '../../features/folder/folder-recovery';
import { validateRoutinesRecoveryState } from '../../features/routines/routines-recovery';
import type { AppDataComplete } from '../model/model-config';
import { validateWorkSessionRecoveryState } from '../../features/work-session/work-session-recovery';
import { isValidEventState } from '../../features/event/store/event.reducer';

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

// Required persisted models, excluding plugin values which may be undefined and
// consequently absent in JSON. Current Planstrand replacements must carry the
// Folder, Event and Planning domains too; absent Routines slices remain valid
// for pre-Routines snapshots.
const required = [
  'task',
  'project',
  'tag',
  'globalConfig',
  'note',
  'issueProvider',
  'planner',
  'boards',
  'metric',
  'simpleCounter',
  'taskRepeatCfg',
  'menuTree',
  'timeTracking',
  'reminders',
  'section',
  'workSession',
  'folder',
  'event',
  'planning',
  'archiveYoung',
  'archiveOld',
] as const satisfies readonly (keyof AppDataComplete)[];

const normalized = (v: unknown): boolean => {
  if (!record(v) || !Array.isArray(v['ids']) || !record(v['entities'])) return false;
  const ids = v['ids'],
    entities = v['entities'];
  return (
    new Set(ids).size === ids.length &&
    Object.keys(entities).length === ids.length &&
    ids.every(
      (id) =>
        typeof id === 'string' &&
        !Object.hasOwn(Object.prototype, id) &&
        Object.hasOwn(entities, id) &&
        record(entities[id]) &&
        entities[id]['id'] === id,
    )
  );
};

/** A full replacement must really carry all required models. Never fill missing
 * models from defaults or the pre-boundary state: that invents recovery data.
 * Errors deliberately omit validator values/paths supplied by private content.
 */
export const validateRecoverySnapshot = (state: Record<string, unknown>): void => {
  if (
    ['TASK', 'EVENT', 'WORK_SESSION'].some((key) => Object.hasOwn(state, key)) ||
    required.some((key) => !Object.hasOwn(state, key)) ||
    !Array.isArray(state['reminders']) ||
    required.filter((key) => key !== 'reminders').some((key) => !record(state[key])) ||
    [
      'task',
      'project',
      'tag',
      'note',
      'issueProvider',
      'metric',
      'simpleCounter',
      'taskRepeatCfg',
      'section',
      'workSession',
      'event',
    ].some((key) => Object.hasOwn(state, key) && !normalized(state[key])) ||
    ['archiveYoung', 'archiveOld'].some(
      (key) => !normalized((state[key] as Record<string, unknown>)['task']),
    ) ||
    (Object.hasOwn(state, 'planning') && !isPlanningState(state['planning']))
  )
    throw new Error('RECOVERY_INVALID_FULL_STATE');
  validateFolderRecoveryState(state);
  validateRoutinesRecoveryState(state);
  validateWorkSessionRecoveryState(state);
  if (!isValidEventState(state['event'])) throw new Error('RECOVERY_INVALID_EVENT_STATE');
};
