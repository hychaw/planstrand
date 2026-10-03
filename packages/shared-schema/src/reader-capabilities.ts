/** Semantic requirements are distinct from entity vocabulary and schema versions. */
export const TASK_FOLDER_OWNERSHIP_V1 = 'TASK_FOLDER_OWNERSHIP_V1' as const;
export type SyncReaderCapability = typeof TASK_FOLDER_OWNERSHIP_V1;

/** Infrastructure only: enable ownership support atomically with Phase 4E. */
export const CLIENT_SYNC_READER_CAPABILITIES: readonly SyncReaderCapability[] = [];

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
