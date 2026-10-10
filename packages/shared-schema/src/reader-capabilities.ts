import {
  hasEventSeriesState,
  hasWeeklyTemplateState,
  hasOccurrenceExceptionState,
} from './full-state-capabilities';

/** Semantic requirements are distinct from entity vocabulary and schema versions. */
export const TASK_FOLDER_OWNERSHIP_V1 = 'TASK_FOLDER_OWNERSHIP_V1' as const;
export const ROUTINES_V1 = 'ROUTINES_V1' as const;
export type SyncReaderCapability = typeof TASK_FOLDER_OWNERSHIP_V1 | typeof ROUTINES_V1;

/** Current readers implement canonical Task Folder ownership and recurring series. */
export const CLIENT_SYNC_READER_CAPABILITIES: readonly SyncReaderCapability[] = [
  TASK_FOLDER_OWNERSHIP_V1,
  ROUTINES_V1,
];

/** Payloads/snapshots carrying ownership need the same semantic wire fence. */
export const hasTaskFolderOwnership = (value: unknown): boolean => {
  const pending: unknown[] = [value];
  while (pending.length) {
    const entry = pending.pop();
    if (!entry || typeof entry !== 'object') continue;
    if (typeof (entry as { folderId?: unknown }).folderId === 'string') return true;
    for (const child of Object.values(entry)) pending.push(child);
  }
  return false;
};

export const getFullStateRequiredCapabilities = (state: unknown): string[] => {
  if (!state || typeof state !== 'object') return [];
  const data = state as {
    requiredCapabilities?: string[];
    task?: unknown;
    archiveYoung?: { task?: unknown };
    archiveOld?: { task?: unknown };
  };
  if (
    data.requiredCapabilities !== undefined &&
    (!Array.isArray(data.requiredCapabilities) ||
      data.requiredCapabilities.some((token) => typeof token !== 'string'))
  ) {
    throw new Error('Invalid full-state semantic requirements');
  }
  return [
    ...new Set([
      ...(data.requiredCapabilities ?? []),
      ...(hasEventSeriesState(state) ||
      hasOccurrenceExceptionState(state) ||
      hasWeeklyTemplateState(state)
        ? [ROUTINES_V1]
        : []),
      ...([data.task, data.archiveYoung?.task, data.archiveOld?.task].some(
        hasTaskFolderOwnership,
      )
        ? [TASK_FOLDER_OWNERSHIP_V1]
        : []),
    ]),
  ];
};

/** The server can enforce these requirements without interpreting encrypted data. */
export const SERVER_SYNC_READER_CAPABILITIES: readonly SyncReaderCapability[] = [
  TASK_FOLDER_OWNERSHIP_V1,
  ROUTINES_V1,
];

export const supportsRequiredCapabilities = (
  required: unknown,
  supported: readonly string[] = [],
): boolean =>
  required === undefined ||
  (Array.isArray(required) &&
    required.every(
      (capability) => typeof capability === 'string' && supported.includes(capability),
    ));
