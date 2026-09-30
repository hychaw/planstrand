import { SyncServerIncompatibleError } from '../core/errors/sync-errors';
import type { Operation } from '../core/operation.types';
import type { OperationSyncCapable } from '../sync-providers/provider.interface';
import { SyncCapabilityGateService } from './sync-capability-gate.service';

const operation = {
  entityType: 'TASK',
  schemaVersion: 4,
  payload: {},
} as Operation;

const apiProvider = (
  getServerSyncCapabilities?: OperationSyncCapable['getServerSyncCapabilities'],
): OperationSyncCapable =>
  ({
    supportsOperationSync: true,
    providerMode: 'superSyncOps',
    requiresServerCapabilities: true,
    getServerSyncCapabilities,
  }) as OperationSyncCapable;

describe('SyncCapabilityGateService', () => {
  const service = new SyncCapabilityGateService();

  it('treats missing capability metadata as a known incompatibility', async () => {
    await expectAsync(
      service.assertUploadCompatible(
        apiProvider(async () => ({ kind: 'missing' })),
        [operation],
      ),
    ).toBeRejectedWithError(SyncServerIncompatibleError);
  });

  it('treats malformed capability metadata as a known incompatibility', async () => {
    await expectAsync(
      service.assertUploadCompatible(
        apiProvider(async () => ({ kind: 'malformed' })),
        [operation],
      ),
    ).toBeRejectedWithError(SyncServerIncompatibleError);
  });

  it('does not misclassify a transient capability fetch failure', async () => {
    const networkError = new Error('temporarily offline');

    await expectAsync(
      service.assertUploadCompatible(
        apiProvider(async () => Promise.reject(networkError)),
        [operation],
      ),
    ).toBeRejectedWith(networkError);
  });

  it('never asks file-snapshot providers for an HTTP capability response', async () => {
    const capabilityLookup = jasmine.createSpy('getServerSyncCapabilities');
    const fileProvider = {
      supportsOperationSync: true,
      providerMode: 'fileSnapshotOps',
      requiresServerCapabilities: true,
      getServerSyncCapabilities: capabilityLookup,
    } as unknown as OperationSyncCapable;

    await service.assertUploadCompatible(fileProvider, [operation]);

    expect(capabilityLookup).not.toHaveBeenCalled();
  });
});
