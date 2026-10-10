import { Prisma } from '@prisma/client';
import {
  supportsRequiredCapabilities,
  supportsRequiredEntityTypes,
} from '@sp/shared-schema';
import { prisma } from '../db';

export interface FullStateReaderAdvertisement {
  supportedEntityTypes?: unknown;
  supportedCapabilities?: unknown;
}

export class FullStateReaderUnsupportedError extends Error {
  readonly errorCode = 'FULL_STATE_READER_UNSUPPORTED';

  constructor() {
    super('Full state requires unsupported entity capabilities');
  }
}

/** HTTP fence also covers old clients that have no local reader gate.
 * Requirements stay visible while ciphertext remains opaque to the server.
 * A missing advertisement supports none of the declared extensions.
 */
export const assertFullStateReader = async (
  userId: number,
  advertised: unknown,
  advertisedCapabilities: unknown = undefined,
  db: Prisma.TransactionClient = prisma,
): Promise<boolean> => {
  const supported = typeof advertised === 'string' ? advertised.split(',') : [];
  // Look up the causal full-state boundary through the existing cached sequence.
  const frontier = await db.userSyncState.findUnique({
    where: { userId },
    select: { latestFullStateSeq: true, requiredCapabilities: true },
  });
  const boundary = frontier?.latestFullStateSeq
    ? await db.operation.findUnique({
        where: { userId_serverSeq: { userId, serverSeq: frontier.latestFullStateSeq } },
        select: { requiredEntityTypes: true },
      })
    : null;
  if (!supportsRequiredEntityTypes(boundary?.requiredEntityTypes, supported))
    return false;
  const supportedCapabilities =
    typeof advertisedCapabilities === 'string' ? advertisedCapabilities.split(',') : [];
  if (
    !supportsRequiredCapabilities(frontier?.requiredCapabilities, supportedCapabilities)
  )
    return false;
  // Retained recovery operations also contribute, including pre-boundary history.
  // Semantic requirements survive ordinary operation tails, even before a
  // snapshot exists. Fence every route, including writes by unaware clients.
  const supportedArray = supportedCapabilities.length
    ? Prisma.sql`ARRAY[${Prisma.join(supportedCapabilities)}]::TEXT[]`
    : Prisma.sql`ARRAY[]::TEXT[]`;
  // Required tokens must be a SUBSET of the reader's advertisement. Prisma's
  // hasEvery asks the inverse question, so use PostgreSQL containment directly.
  const unsupported = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM operations
    WHERE user_id = ${userId}
      AND NOT (required_capabilities <@ ${supportedArray})
    LIMIT 1
  `);
  return unsupported.length === 0;
};
