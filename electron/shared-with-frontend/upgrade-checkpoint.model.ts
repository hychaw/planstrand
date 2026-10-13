import type { AllModelConfig } from '../../src/app/op-log/model/model-config';
import type { CompleteBackup } from '../../src/app/op-log/core/types/sync.types';

/** Application-data export only; does not represent a filesystem profile copy. */
export type UpgradeCheckpointData = CompleteBackup<AllModelConfig>;

export type UpgradeCheckpointResult =
  | { ok: true; path: string; coverage: 'application-data' }
  | { ok: false; reason: 'UNAVAILABLE' | 'PREPARATION_FAILED' | 'WRITE_FAILED' };
