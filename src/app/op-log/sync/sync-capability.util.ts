import { getFullStateRequiredEntityTypes } from '@sp/shared-schema';
import { extractFullStateFromPayload } from '../core/operation.types';
import {
  ENTITY_TYPES,
  SUPER_SYNC_CAPABILITY_CONTRACT_VERSION,
  SUPER_SYNC_BASELINE_OP_TYPES,
} from '@sp/shared-schema';
import { isMultiEntityPayload } from '@sp/sync-core';
import type { OperationSyncServerCapabilities } from '../sync-providers/provider.interface';

export interface OperationCapabilityInput {
  opType: string;
  entityType: string;
  schemaVersion: number;
  payload: unknown;
}

export interface OperationCapabilityRequirement {
  opType: string;
  entityTypes: string[];
  schemaVersion: number;
}

export interface CapabilityCompatibilityResult {
  compatible: boolean;
  unsupportedOpTypes: string[];
  unsupportedEntityTypes: string[];
  unsupportedSchemaVersions: number[];
  contractVersionSupported: boolean;
}

/**
 * Central mapping from an outgoing operation to the server capabilities it needs.
 *
 * Full-state operations (`ALL`) require every entity understood by this client.
 * This is intentionally conservative: uploading a snapshot to a server that
 * cannot represent one of its slices would make the remote state incomplete.
 * Multi-entity payloads additionally require every entity type in their atomic
 * change set, so one logical intent is never split by the compatibility gate.
 */
export const getOperationCapabilityRequirement = (
  operation: OperationCapabilityInput,
): OperationCapabilityRequirement => {
  const entityTypes = new Set<string>();
  if (operation.entityType === 'ALL') {
    for (const entityType of ENTITY_TYPES) {
      if (
        entityType !== 'FOLDER' ||
        getFullStateRequiredEntityTypes(
          extractFullStateFromPayload(operation.payload),
        ).includes('FOLDER')
      )
        entityTypes.add(entityType);
    }
  } else {
    entityTypes.add(operation.entityType);
  }

  if (isMultiEntityPayload(operation.payload)) {
    for (const change of operation.payload.entityChanges) {
      entityTypes.add(change.entityType);
    }
  }

  return {
    opType: operation.opType,
    entityTypes: [...entityTypes],
    schemaVersion: operation.schemaVersion,
  };
};

export const evaluateOperationCompatibility = (
  operations: readonly OperationCapabilityInput[],
  capabilities: OperationSyncServerCapabilities,
): CapabilityCompatibilityResult => {
  // Only the immutable deployed baseline is implicit on pre-extension servers.
  // An explicit advertisement (including []) is authoritative for every type.
  const supportedOpTypes = new Set<string>(
    capabilities.supportedOpTypes ?? SUPER_SYNC_BASELINE_OP_TYPES,
  );
  const unsupportedOpTypes = new Set<string>();
  const supportedEntityTypes = new Set(capabilities.supportedEntityTypes);
  const unsupportedEntityTypes = new Set<string>();
  const unsupportedSchemaVersions = new Set<number>();

  for (const operation of operations) {
    const requirement = getOperationCapabilityRequirement(operation);
    if (!supportedOpTypes.has(requirement.opType)) {
      unsupportedOpTypes.add(requirement.opType);
    }
    for (const entityType of requirement.entityTypes) {
      if (!supportedEntityTypes.has(entityType)) {
        unsupportedEntityTypes.add(entityType);
      }
    }
    if (
      requirement.schemaVersion < capabilities.minSchemaVersion ||
      requirement.schemaVersion > capabilities.maxSchemaVersion
    ) {
      unsupportedSchemaVersions.add(requirement.schemaVersion);
    }
  }

  const contractVersionSupported =
    capabilities.contractVersion === SUPER_SYNC_CAPABILITY_CONTRACT_VERSION;
  return {
    compatible:
      contractVersionSupported &&
      unsupportedOpTypes.size === 0 &&
      unsupportedEntityTypes.size === 0 &&
      unsupportedSchemaVersions.size === 0,
    unsupportedOpTypes: [...unsupportedOpTypes].sort(),
    unsupportedEntityTypes: [...unsupportedEntityTypes].sort(),
    unsupportedSchemaVersions: [...unsupportedSchemaVersions].sort((a, b) => a - b),
    contractVersionSupported,
  };
};
