import { Injectable } from '@angular/core';
import { assertFolderSuperSyncSnapshotCompatible } from './folder-full-state-gate';
import { extractFullStateFromPayload, isFullStateOpType } from '../core/operation.types';
import type { Operation } from '../core/operation.types';
import { SyncServerIncompatibleError } from '../core/errors/sync-errors';
import type { OperationSyncCapable } from '../sync-providers/provider.interface';
import {
  evaluateOperationCompatibility,
  getOperationRequiredCapabilities,
} from './sync-capability.util';

@Injectable({ providedIn: 'root' })
export class SyncCapabilityGateService {
  async assertUploadCompatible(
    provider: OperationSyncCapable,
    operations: readonly Operation[],
    options?: { forceRefresh?: boolean },
  ): Promise<void> {
    if (
      operations.length === 0 ||
      provider.providerMode !== 'superSyncOps' ||
      provider.requiresServerCapabilities !== true
    ) {
      if (
        provider.providerMode === 'superSyncOps' &&
        operations.some((op) => getOperationRequiredCapabilities(op).length)
      )
        throw new SyncServerIncompatibleError('missing');
      if (provider.providerMode === 'superSyncOps')
        for (const op of operations) {
          if (isFullStateOpType(op.opType))
            assertFolderSuperSyncSnapshotCompatible(
              extractFullStateFromPayload(op.payload),
            );
        }
      return;
    }

    if (!provider.getServerSyncCapabilities) {
      throw new SyncServerIncompatibleError('missing');
    }

    const result = await provider.getServerSyncCapabilities(options);
    if (result.kind !== 'available') {
      throw new SyncServerIncompatibleError(result.kind);
    }

    for (const op of operations) {
      if (isFullStateOpType(op.opType))
        assertFolderSuperSyncSnapshotCompatible(
          extractFullStateFromPayload(op.payload),
          result.capabilities.fullStateReaderRequirements === true,
        );
    }
    const compatibility = evaluateOperationCompatibility(operations, result.capabilities);
    if (!compatibility.compatible) {
      throw new SyncServerIncompatibleError('unsupported', compatibility);
    }
  }
}
