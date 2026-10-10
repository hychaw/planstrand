/** Real HTTP + PostgreSQL, two independent reader advertisements. Run only with
 * DATABASE_URL pointing at a migrated disposable database. No provider, route,
 * database, encryption or compatibility mocks; this is API-client coverage,
 * not a pair of released browser application builds.
 */
import Fastify, { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import {
  encrypt,
  decrypt,
  setArgon2ParamsForTesting,
  clearSessionKeyCache,
} from '@sp/sync-core';
import {
  CURRENT_SCHEMA_VERSION,
  ENTITY_TYPES,
  CLIENT_SYNC_READER_CAPABILITIES,
  ROUTINES_V1,
} from '@sp/shared-schema';
import { prisma } from '../../src/db';
import { syncRoutes } from '../../src/sync/sync.routes';
import { initSyncService } from '../../src/sync/sync.service';

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'routines-test-secret-32-characters-long';
});
describeWithDb('Routines conditional compatibility (real HTTP and PostgreSQL)', () => {
  let app: FastifyInstance;
  let base: string;
  let userId: number;
  let authorization: string;
  const password = 'disposable-routines-test-password';
  const oldEntities = ENTITY_TYPES.filter((t) => t !== 'EVENT_SERIES');
  const oldCapabilities = CLIENT_SYNC_READER_CAPABILITIES.filter(
    (t) => t !== ROUTINES_V1,
  );
  const query = (aware: boolean) =>
    `supportedEntityTypes=${(aware ? ENTITY_TYPES : oldEntities).join(',')}&supportedCapabilities=${(aware ? CLIENT_SYNC_READER_CAPABILITIES : oldCapabilities).join(',')}`;
  const request = (path: string, aware: boolean, body?: unknown) =>
    fetch(`${base}${path}${path.includes('?') ? '&' : '?'}${query(aware)}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const makeOp = async (
    clientId: string,
    entityType: 'TASK' | 'EVENT_SERIES',
    payload: unknown,
    count: number,
  ) => ({
    id: uuidv7(),
    clientId,
    actionType: entityType === 'TASK' ? '[Task] Add' : '[EventSeries] Add Event Series',
    opType: 'CRT',
    entityType,
    entityId: entityType === 'TASK' ? uuidv7() : 'series-1',
    payload: await encrypt(JSON.stringify(payload), password),
    isPayloadEncrypted: true,
    vectorClock: { [clientId]: count },
    timestamp: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...(entityType === 'EVENT_SERIES'
      ? { requiredCapabilities: [ROUTINES_V1], requiredEntityTypes: ['EVENT_SERIES'] }
      : {}),
  });
  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'routines-test-secret-32-characters-long';
    // The migration is a prerequisite, never an automatic production migration.
    const migrations = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL',
    );
    expect(migrations.map((m) => m.migration_name)).toContain(
      '20261010050000_durable_semantic_requirements',
    );
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
    clearSessionKeyCache();
    const user = await prisma.user.create({
      data: { email: `routines-${uuidv7()}@test.local`, isVerified: 1 },
    });
    userId = user.id;
    authorization = `Bearer ${jwt.sign({ userId, email: user.email, tokenVersion: user.tokenVersion }, process.env.JWT_SECRET!)}`;
    initSyncService();
    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    base = await app.listen({ port: 0, host: '127.0.0.1' });
    base += '/api/sync';
  });
  afterAll(async () => {
    await app?.close();
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    setArgon2ParamsForTesting();
    clearSessionKeyCache();
  });
  it('syncs plain data before activation, then blocks an older reader without consuming pending operations or advancing its cursor', async () => {
    const ordinary = await makeOp('old-client', 'TASK', { id: 'ordinary' }, 1);
    let response = await request('/ops', false, {
      clientId: ordinary.clientId,
      ops: [ordinary],
      requestId: ordinary.id,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].accepted).toBe(true);
    response = await request('/ops?sinceSeq=0', false);
    expect(response.status).toBe(200);
    const before = await response.json();
    let oldCursor = before.latestSeq;
    expect(before.ops).toHaveLength(1);
    expect(
      (await prisma.userSyncState.findUniqueOrThrow({ where: { userId } }))
        .requiredCapabilities,
    ).toEqual([]);
    const eventSeries = {
      id: 'series-1',
      title: 'Routine',
      created: 50,
      modified: 50,
      segments: [
        {
          id: 'segment-1',
          recurrence: { frequency: 'daily', interval: 1, startDate: '2026-10-10' },
          timing: { kind: 'allDay' },
        },
      ],
    };
    const routine = await makeOp(
      'new-client',
      'EVENT_SERIES',
      { actionPayload: { eventSeries }, entityChanges: [] },
      1,
    );
    const upload = { clientId: routine.clientId, ops: [routine], requestId: routine.id };
    expect((await request('/ops', true, upload)).status).toBe(200);
    expect((await request('/ops', true, { ...upload, requestId: uuidv7() })).status).toBe(
      200,
    );
    expect(await prisma.operation.count({ where: { userId, id: routine.id } })).toBe(1);
    response = await request('/ops?sinceSeq=0', true);
    const aware = await response.json();
    const delivered = aware.ops.find(
      (entry: { op: { entityType: string } }) => entry.op.entityType === 'EVENT_SERIES',
    ).op;
    expect(
      JSON.parse(await decrypt(delivered.payload, password)).actionPayload.eventSeries,
    ).toEqual(eventSeries);
    expect(aware.requiredCapabilities).toContain(ROUTINES_V1);
    const pending = [await makeOp('old-client', 'TASK', { id: 'pending' }, 2)];
    const pendingBefore = JSON.stringify(pending);
    response = await request(`/ops?sinceSeq=${oldCursor}`, false);
    expect(response.status).toBe(409);
    expect((await response.json()).errorCode).toBe('FULL_STATE_READER_UNSUPPORTED');
    if (response.ok) oldCursor = (await response.json()).latestSeq;
    expect(oldCursor).toBe(before.latestSeq);
    response = await request('/ops', false, {
      clientId: 'old-client',
      ops: pending,
      requestId: uuidv7(),
      lastKnownServerSeq: oldCursor,
    });
    expect(response.status).toBe(409);
    expect(JSON.stringify(pending)).toBe(pendingBefore);
    expect(await prisma.operation.count({ where: { userId, id: pending[0].id } })).toBe(
      0,
    );
    // Empty replacement intentionally omits requirements and all series. The
    // durable account floor must survive deletion of the activating operation.
    response = await request('/snapshot', true, {
      clientId: 'new-client',
      opId: uuidv7(),
      requestId: uuidv7(),
      state: await encrypt(
        JSON.stringify({ eventSeries: { ids: [], entities: {} } }),
        password,
      ),
      isPayloadEncrypted: true,
      reason: 'recovery',
      vectorClock: { 'old-client': 1, 'new-client': 2 },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      snapshotOpType: 'SYNC_IMPORT',
      isCleanSlate: true,
    });
    expect(response.status, await response.text()).toBe(200);
    expect(await prisma.operation.count({ where: { userId, id: routine.id } })).toBe(0);
    expect(
      (await prisma.userSyncState.findUniqueOrThrow({ where: { userId } }))
        .requiredCapabilities,
    ).toContain(ROUTINES_V1);
    expect((await request(`/ops?sinceSeq=${oldCursor}`, false)).status).toBe(409);
    expect(
      (
        await request('/ops', false, {
          clientId: 'old-client',
          ops: pending,
          requestId: uuidv7(),
        })
      ).status,
    ).toBe(409);
    expect((await request('/ops?sinceSeq=0', true)).status).toBe(200);
  });
});
