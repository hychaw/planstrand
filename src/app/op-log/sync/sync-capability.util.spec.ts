import {
  evaluateOperationCompatibility,
  getOperationCapabilityRequirement,
  type OperationCapabilityInput,
} from './sync-capability.util';
import type { OperationSyncServerCapabilities } from '../sync-providers/provider.interface';

const op = (
  entityType: string,
  schemaVersion = 4,
  payload: unknown = {},
): OperationCapabilityInput => ({ entityType, schemaVersion, payload });

const capabilities = (
  supportedEntityTypes: string[],
  overrides: Partial<{
    contractVersion: number;
    minSchemaVersion: number;
    maxSchemaVersion: number;
  }> = {},
): OperationSyncServerCapabilities => ({
  contractVersion: overrides.contractVersion ?? 1,
  supportedEntityTypes,
  minSchemaVersion: overrides.minSchemaVersion ?? 1,
  maxSchemaVersion: overrides.maxSchemaVersion ?? 4,
});

describe('sync capability requirements', () => {
  it('maps a legacy operation to its entity and schema requirement', () => {
    expect(getOperationCapabilityRequirement(op('TASK'))).toEqual({
      entityTypes: ['TASK'],
      schemaVersion: 4,
    });
  });

  it('includes every entity touched by one multi-entity intent', () => {
    const requirement = getOperationCapabilityRequirement(
      op('TASK', 4, {
        actionPayload: {},
        entityChanges: [
          { entityType: 'TASK', entityId: 't1', opType: 'UPD', changes: {} },
          {
            entityType: 'FUTURE_ENTITY',
            entityId: 'f1',
            opType: 'CRT',
            changes: {},
          },
        ],
      }),
    );

    expect(requirement.entityTypes).toEqual(['TASK', 'FUTURE_ENTITY']);
  });

  it('requires all client entities for a full-state operation', () => {
    const requirement = getOperationCapabilityRequirement(op('ALL'));

    expect(requirement.entityTypes).toContain('TASK');
    expect(requirement.entityTypes).toContain('REMINDER');
    expect(requirement.entityTypes).toContain('ALL');
  });

  it('accepts a supported encrypted operation without inspecting personal content', () => {
    const encryptedPayload = {
      ciphertext: 'opaque',
      iv: 'opaque',
      salt: 'opaque',
    };

    expect(
      evaluateOperationCompatibility(
        [op('TASK', 4, encryptedPayload)],
        capabilities(['TASK']),
      ).compatible,
    ).toBeTrue();
  });

  it('gates WorkSession uploads from the authoritative entity requirement', () => {
    const workSession = op('WORK_SESSION', 4, {
      ciphertext: 'opaque',
      iv: 'opaque',
      salt: 'opaque',
    });

    expect(
      evaluateOperationCompatibility(
        [workSession],
        capabilities(['TASK', 'WORK_SESSION']),
      ).compatible,
    ).toBeTrue();

    expect(evaluateOperationCompatibility([workSession], capabilities(['TASK']))).toEqual(
      {
        compatible: false,
        unsupportedEntityTypes: ['WORK_SESSION'],
        unsupportedSchemaVersions: [],
        contractVersionSupported: true,
      },
    );
  });

  it('rejects a synthetic future entity without registering a production entity', () => {
    const result = evaluateOperationCompatibility(
      [op('FUTURE_ENTITY')],
      capabilities(['TASK']),
    );

    expect(result.compatible).toBeFalse();
    expect(result.unsupportedEntityTypes).toEqual(['FUTURE_ENTITY']);
  });

  it('rejects partial entity support for a mixed pending cycle', () => {
    const result = evaluateOperationCompatibility(
      [op('TASK'), op('FUTURE_ENTITY')],
      capabilities(['TASK']),
    );

    expect(result.compatible).toBeFalse();
  });

  it('checks contract and schema versions independently from entity support', () => {
    expect(
      evaluateOperationCompatibility(
        [op('TASK', 5)],
        capabilities(['TASK'], { contractVersion: 2, maxSchemaVersion: 4 }),
      ),
    ).toEqual({
      compatible: false,
      unsupportedEntityTypes: [],
      unsupportedSchemaVersions: [5],
      contractVersionSupported: false,
    });
  });
});
