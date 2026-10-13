import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';

/** A newer snapshot is not corruption and must never enter recovery/repair. */
export class UnsupportedDataVersionError extends Error {
  constructor(format: 'snapshot' | 'operation' = 'snapshot') {
    super(`Unsupported ${format} schema version; use a compatible Planstrand version`);
    this.name = 'UnsupportedDataVersionError';
  }
}

export const assertReadable = (
  snapshot: { schemaVersion?: number } | null | undefined,
): void => {
  const version = snapshot?.schemaVersion;
  if (
    version !== undefined &&
    (!Number.isInteger(version) || version > CURRENT_SCHEMA_VERSION)
  ) {
    throw new UnsupportedDataVersionError();
  }
};

/** Keep historical malformed-row handling, but never replay a declared future format. */
export const assertOperationsReadable = (
  entries: readonly { op: { schemaVersion?: unknown } }[],
): void => {
  if (
    entries.some(
      ({ op }) =>
        typeof op.schemaVersion === 'number' && op.schemaVersion > CURRENT_SCHEMA_VERSION,
    )
  ) {
    throw new UnsupportedDataVersionError('operation');
  }
};
