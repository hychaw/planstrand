import { getFullStateRequiredEntityTypes } from '@sp/shared-schema';
import { extractFullStateFromPayload } from '../core/operation.types';
import { assertFullStateReaderCompatible } from '../sync/folder-full-state-gate';

/** An old importer must see no repairable core roots instead of dropping Folder.
 * This reuses the full-state wrapper, with explicit capability requirements.
 * No format/schema version is advanced, and bootstrap-only exports stay raw.
 */
export const protectFullStateBackup = <T extends object>(
  state: T,
): T | { requiredEntityTypes: string[]; appDataComplete: T } => {
  const requiredEntityTypes = getFullStateRequiredEntityTypes(state);
  return requiredEntityTypes.length
    ? { requiredEntityTypes, appDataComplete: state }
    : state;
};
export const readFullStateBackup = (payload: unknown): Record<string, unknown> => {
  const state = extractFullStateFromPayload(payload);
  assertFullStateReaderCompatible(
    state,
    (payload as { requiredEntityTypes?: unknown })?.requiredEntityTypes,
  );
  return state;
};
