import {
  ENTITY_TYPES,
  getFullStateRequiredEntityTypes,
  supportsRequiredEntityTypes,
  supportsRequiredCapabilities,
  CLIENT_SYNC_READER_CAPABILITIES,
  getFullStateRequiredCapabilities,
} from '@sp/shared-schema';
export {
  hasMeaningfulFolderState,
  getFullStateRequiredEntityTypes,
} from '@sp/shared-schema';

/** Evaluate raw state BEFORE conversion/defaulting/repair can discard an entity. */
export const assertFullStateReaderCompatible = (
  state: unknown,
  declared: unknown = undefined,
  supported: readonly string[] = ENTITY_TYPES,
  requiredCapabilities: unknown = undefined,
  supportedCapabilities: readonly string[] = CLIENT_SYNC_READER_CAPABILITIES,
): void => {
  if (
    !supportsRequiredEntityTypes(declared, supported) ||
    !supportsRequiredCapabilities(requiredCapabilities, supportedCapabilities) ||
    !supportsRequiredCapabilities(
      getFullStateRequiredCapabilities(state),
      supportedCapabilities,
    ) ||
    !supportsRequiredCapabilities(
      (state as { requiredCapabilities?: unknown } | null)?.requiredCapabilities,
      supportedCapabilities,
    ) ||
    !supportsRequiredEntityTypes(getFullStateRequiredEntityTypes(state), supported)
  ) {
    throw new Error('Full state requires unsupported entity capabilities');
  }
};
export const assertFolderSuperSyncSnapshotCompatible = (
  state: unknown,
  serverEnforcesReaderRequirements = false,
): void => {
  if (
    getFullStateRequiredEntityTypes(state).length &&
    !serverEnforcesReaderRequirements
  ) {
    throw new Error(
      'Folder-bearing SuperSync snapshots require server-enforced full-state reader capabilities',
    );
  }
};
