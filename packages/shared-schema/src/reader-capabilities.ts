/** Semantic requirements are distinct from entity vocabulary and schema versions. */
export const TASK_FOLDER_OWNERSHIP_V1 = 'TASK_FOLDER_OWNERSHIP_V1' as const;
export type SyncReaderCapability = typeof TASK_FOLDER_OWNERSHIP_V1;

/** Phase 4E readers implement canonical Task Folder ownership. */
export const CLIENT_SYNC_READER_CAPABILITIES: readonly SyncReaderCapability[] = [
  TASK_FOLDER_OWNERSHIP_V1,
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
    task?: unknown;
    archiveYoung?: { task?: unknown };
    archiveOld?: { task?: unknown };
  };
  return [data.task, data.archiveYoung?.task, data.archiveOld?.task].some(
    hasTaskFolderOwnership,
  )
    ? [TASK_FOLDER_OWNERSHIP_V1]
    : [];
};

/** The server can enforce these requirements without interpreting encrypted data. */
export const SERVER_SYNC_READER_CAPABILITIES: readonly SyncReaderCapability[] = [
  TASK_FOLDER_OWNERSHIP_V1,
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
