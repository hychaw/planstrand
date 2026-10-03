import { Prisma } from '@prisma/client';
import { supportsRequiredEntityTypes } from '@sp/shared-schema';
import { prisma } from '../db';

/** HTTP fence also covers old clients that have no local reader gate.
 * Requirements stay visible while ciphertext remains opaque to the server.
 * A missing advertisement supports none of the declared extensions.
 */
export const assertFullStateReader = async (
  userId: number,
  advertised: unknown,
  advertisedCapabilities: unknown = undefined,
): Promise<boolean> => {
  const supported = typeof advertised === 'string' ? advertised.split(',') : [];
  // Look up the causal full-state boundary through the existing cached sequence.
  const frontier = await prisma.userSyncState.findUnique({
    where: { userId },
    select: { latestFullStateSeq: true },
  });
  const boundary = frontier?.latestFullStateSeq
    ? await prisma.operation.findUnique({
        where: { userId_serverSeq: { userId, serverSeq: frontier.latestFullStateSeq } },
        select: { requiredEntityTypes: true },
      })
    : null;
  if (!supportsRequiredEntityTypes(boundary?.requiredEntityTypes, supported))
    return false;
  const supportedCapabilities =
    typeof advertisedCapabilities === 'string' ? advertisedCapabilities.split(',') : [];
  // Semantic requirements survive ordinary operation tails, even before a
  // snapshot exists. Fence every route, including writes by unaware clients.
  const supportedArray = supportedCapabilities.length
    ? Prisma.sql`ARRAY[${Prisma.join(supportedCapabilities)}]::TEXT[]`
    : Prisma.sql`ARRAY[]::TEXT[]`;
  // Required tokens must be a SUBSET of the reader's advertisement. Prisma's
  // hasEvery asks the inverse question, so use PostgreSQL containment directly.
  const unsupported = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM operations
    WHERE user_id = ${userId}
      AND server_seq >= ${frontier?.latestFullStateSeq ?? 0}
      AND NOT (required_capabilities <@ ${supportedArray})
    LIMIT 1
  `);
  return unsupported.length === 0;
};
