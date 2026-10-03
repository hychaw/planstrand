import { SUPER_SYNC_OPERATION_CAPABILITIES } from '@sp/shared-schema';
import { initialFolderState } from '../../features/folder/folder-state';
import { addFolder } from '../../features/folder/store/folder.actions';
import { OpType } from '../core/operation.types';
import { SyncServerIncompatibleError } from '../core/errors/sync-errors';
import type { Operation } from '../core/operation.types';
import type { OperationSyncCapable } from '../sync-providers/provider.interface';
import { SyncCapabilityGateService } from './sync-capability-gate.service';

const operation = {
  opType: 'UPD',
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

  it('blocks Folder-bearing API full-state replacement on a server without reader enforcement', async () => {
    const lookup = jasmine.createSpy('capabilities').and.resolveTo({
      kind: 'available',
      capabilities: {
        ...SUPER_SYNC_OPERATION_CAPABILITIES,
        fullStateReaderRequirements: undefined,
      },
    });
    const folder = addFolder({
      state: initialFolderState,
      folder: { id: 'a', title: 'A' },
    }).folderState;
    await expectAsync(
      service.assertUploadCompatible(apiProvider(lookup), [
        {
          ...operation,
          opType: OpType.BackupImport,
          entityType: 'ALL',
          payload: { folder },
        },
      ]),
    ).toBeRejectedWithError(/Folder-bearing SuperSync snapshots/);
    expect(lookup).toHaveBeenCalled();
  });

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
