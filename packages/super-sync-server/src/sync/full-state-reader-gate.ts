import { supportsRequiredEntityTypes } from '@sp/shared-schema';
import { prisma } from '../db';

/** HTTP fence also covers old clients that have no local reader gate.
 * Requirements stay visible while ciphertext remains opaque to the server.
 * A missing advertisement supports none of the declared extensions.
 */
export const assertFullStateReader = async (
  userId: number,
  advertised: unknown,
): Promise<boolean> => {
  const supported = typeof advertised === 'string' ? advertised.split(',') : [];
  // Look up the causal full-state boundary through the existing cached sequence.
  const frontier = await prisma.userSyncState.findUnique({
    where: { userId },
    select: { latestFullStateSeq: true },
  });
  if (!frontier?.latestFullStateSeq) return true;
  const boundary = await prisma.operation.findUnique({
    where: { userId_serverSeq: { userId, serverSeq: frontier.latestFullStateSeq } },
    select: { requiredEntityTypes: true },
  });
  return supportsRequiredEntityTypes(boundary?.requiredEntityTypes, supported);
};
