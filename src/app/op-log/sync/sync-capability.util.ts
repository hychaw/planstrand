import { ENTITY_TYPES, SUPER_SYNC_CAPABILITY_CONTRACT_VERSION } from '@sp/shared-schema';
import { isMultiEntityPayload } from '@sp/sync-core';
import type { OperationSyncServerCapabilities } from '../sync-providers/provider.interface';

export interface OperationCapabilityInput {
  entityType: string;
  schemaVersion: number;
  payload: unknown;
}

export interface OperationCapabilityRequirement {
  entityTypes: string[];
  schemaVersion: number;
}

export interface CapabilityCompatibilityResult {
  compatible: boolean;
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
    entityTypes: [...entityTypes],
    schemaVersion: operation.schemaVersion,
  };
};

export const evaluateOperationCompatibility = (
  operations: readonly OperationCapabilityInput[],
  capabilities: OperationSyncServerCapabilities,
): CapabilityCompatibilityResult => {
  const supportedEntityTypes = new Set(capabilities.supportedEntityTypes);
  const unsupportedEntityTypes = new Set<string>();
  const unsupportedSchemaVersions = new Set<number>();

  for (const operation of operations) {
    const requirement = getOperationCapabilityRequirement(operation);
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
      unsupportedEntityTypes.size === 0 &&
      unsupportedSchemaVersions.size === 0,
    unsupportedEntityTypes: [...unsupportedEntityTypes].sort(),
    unsupportedSchemaVersions: [...unsupportedSchemaVersions].sort((a, b) => a - b),
    contractVersionSupported,
  };
};
