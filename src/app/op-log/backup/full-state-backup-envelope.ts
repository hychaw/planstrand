import { getFullStateRequiredEntityTypes } from '@sp/shared-schema';
import { extractFullStateFromPayload } from '../core/operation.types';
import { assertFullStateReaderCompatible } from '../sync/folder-full-state-gate';

/** An old importer must see no repairable core roots instead of dropping Folder.
 * This reuses the full-state wrapper, with explicit capability requirements.
 * No format/schema version is advanced, and bootstrap-only exports stay raw.
 */
export const protectFullStateBackup = <T extends object>(
  state: T,
  requiredCapabilities: string[] = [],
):
  | T
  | {
      requiredEntityTypes: string[];
      requiredCapabilities?: string[];
      appDataComplete: T;
    } => {
  const requiredEntityTypes = getFullStateRequiredEntityTypes(state);
  return requiredEntityTypes.length || requiredCapabilities.length
    ? {
        requiredEntityTypes,
        ...(requiredCapabilities.length ? { requiredCapabilities } : {}),
        appDataComplete: state,
      }
    : state;
};
export const readFullStateBackup = (payload: unknown): Record<string, unknown> => {
  const state = extractFullStateFromPayload(payload);
  assertFullStateReaderCompatible(
    state,
    (payload as { requiredEntityTypes?: unknown })?.requiredEntityTypes,
    undefined,
    (payload as { requiredCapabilities?: unknown })?.requiredCapabilities,
  );
  return state;
};
