import { ENTITY_TYPES } from '@sp/shared-schema';
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
): OperationCapabilityInput => ({ opType: 'UPD', entityType, schemaVersion, payload });

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
  it('requires FOLDER support for operations and full-state snapshots', () => {
    const old = capabilities(ENTITY_TYPES.filter((type) => type !== 'FOLDER'));
    expect(
      evaluateOperationCompatibility([op('FOLDER')], old).unsupportedEntityTypes,
    ).toEqual(['FOLDER']);
    expect(
      evaluateOperationCompatibility(
        [op('ALL', 4, { folder: { ids: ['user'], entities: {} } })],
        old,
      ).unsupportedEntityTypes,
    ).toEqual(['FOLDER']);
    expect(
      evaluateOperationCompatibility([op('FOLDER')], capabilities([...ENTITY_TYPES]))
        .compatible,
    ).toBeTrue();
  });

  it('checks the live upload schema floor independently of legacy read transport', () => {
    const release = capabilities([...ENTITY_TYPES], {
      minSchemaVersion: 5,
      maxSchemaVersion: 5,
    });
    expect(evaluateOperationCompatibility([op('TASK', 4)], release).compatible).toBe(
      false,
    );
    expect(evaluateOperationCompatibility([op('TASK', 5)], release).compatible).toBe(
      true,
    );
    expect(
      evaluateOperationCompatibility(
        [{ opType: 'SYNC_IMPORT', entityType: 'ALL', schemaVersion: 5, payload: {} }],
        release,
      ).compatible,
    ).toBe(true);
  });
  it('maps a legacy operation to its entity and schema requirement', () => {
    expect(getOperationCapabilityRequirement(op('TASK'))).toEqual({
      opType: 'UPD',
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
        unsupportedOpTypes: [],
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
      unsupportedOpTypes: [],
      unsupportedEntityTypes: [],
      unsupportedSchemaVersions: [5],
      contractVersionSupported: false,
    });
  });
});

describe('operation type capability fence', () => {
  const future = { ...op('TASK'), opType: 'FUTURE_FENCED_V1' };
  it('accepts the immutable baseline when op metadata is absent', () => {
    expect(
      evaluateOperationCompatibility([op('TASK')], capabilities(['TASK'])).compatible,
    ).toBeTrue();
  });
  it('requires explicit future support despite compatible entity and schema', () => {
    const result = evaluateOperationCompatibility(
      [op('TASK'), future],
      capabilities(['TASK']),
    );
    expect(result.compatible).toBeFalse();
    expect(result.unsupportedOpTypes).toEqual(['FUTURE_FENCED_V1']);
    expect(result.unsupportedEntityTypes).toEqual([]);
    expect(result.unsupportedSchemaVersions).toEqual([]);
  });
  it('honors an explicit empty advertisement even for baseline types', () => {
    expect(
      evaluateOperationCompatibility([op('TASK')], {
        ...capabilities(['TASK']),
        supportedOpTypes: [],
      }).compatible,
    ).toBeFalse();
  });
  it('allows the same operation after explicit server support', () => {
    expect(
      evaluateOperationCompatibility([future], {
        ...capabilities(['TASK']),
        supportedOpTypes: ['FUTURE_FENCED_V1'],
      }).compatible,
    ).toBeTrue();
  });
});
