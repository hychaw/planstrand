import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Real PostgreSQL + HTTP coverage of the reader preflight/write TOCTOU gap.
 * Run with DATABASE_URL pointing at a migrated, disposable test database:
 *   npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/semantic-writer-race.integration.spec.ts
 * No Prisma, gate, upload, or authentication mocks. Barriers hold requests
 * after the actual preflight, or after an insert inside the real transaction.
 */
import Fastify, { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { CURRENT_SCHEMA_VERSION, TASK_FOLDER_OWNERSHIP_V1 } from '@sp/shared-schema';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { uuidv7 } from 'uuidv7';
import { prisma } from '../../src/db';
import { syncRoutes } from '../../src/sync/sync.routes';
import { initSyncService, SyncService } from '../../src/sync/sync.service';
import { FullStateReaderUnsupportedError } from '../../src/sync/full-state-reader-gate';
import { Operation } from '../../src/sync/sync.types';
import { StorageQuotaService } from '../../src/sync/services/storage-quota.service';

vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'semantic-writer-race-test-secret-32-characters';
});

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;
const CAPABILITY = TASK_FOLDER_OWNERSHIP_V1;
const A = 'aware-writer';
const B = 'unaware-writer';
const CIPHERTEXT = Buffer.alloc(44, 7).toString('base64');
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describeWithDb('Semantic writer serialization (PostgreSQL)', () => {
  let app: FastifyInstance;
  let userId: number;
  let authorization: string;
  let afterPreflight: (() => Promise<void>) | undefined;
  let afterInsert: ((clientId: string) => Promise<void>) | undefined;
  let afterRequirementRead: (() => Promise<void>) | undefined;
  let releases: Array<() => void>;
  let requests: Promise<unknown>[];

  const makeOp = (clientId: string, requiredCapabilities: string[] = []): Operation => ({
    id: uuidv7(),
    clientId,
    actionType: '[Task] Add',
    opType: 'CRT',
    entityType: 'TASK',
    entityId: uuidv7(),
    payload: CIPHERTEXT,
    isPayloadEncrypted: true,
    vectorClock: { [clientId]: 1 },
    timestamp: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    requiredCapabilities,
  });

  const upload = (op: Operation, cursor?: number, capabilities?: string) => {
    const request = app
      .inject({
        method: 'POST',
        url:
          '/api/sync/ops?supportedEntityTypes=TASK,FOLDER' +
          (capabilities ? `&supportedCapabilities=${capabilities}` : ''),
        headers: { authorization },
        payload: {
          clientId: op.clientId,
          ops: [op],
          requestId: op.id,
          ...(cursor === undefined ? {} : { lastKnownServerSeq: cursor }),
        },
      })
      .then((response) => response);
    requests.push(request);
    return request;
  };

  const snapshot = (op: Operation, cleanSlate = false, repair = false) => {
    const request = app
      .inject({
        method: 'POST',
        url: '/api/sync/snapshot?supportedEntityTypes=TASK,FOLDER',
        headers: { authorization },
        payload: {
          clientId: op.clientId,
          opId: op.id,
          requestId: op.id,
          state: op.payload,
          isPayloadEncrypted: true,
          reason: 'recovery',
          vectorClock: op.vectorClock,
          schemaVersion: op.schemaVersion,
          snapshotOpType: repair
            ? 'REPAIR'
            : cleanSlate
              ? 'SYNC_IMPORT'
              : 'BACKUP_IMPORT',
          isCleanSlate: cleanSlate || repair,
        },
      })
      .then((response) => response);
    requests.push(request);
    return request;
  };

  const pauseAfterPreflight = () => {
    const entered = deferred();
    const resume = deferred();
    releases.push(resume.resolve);
    afterPreflight = async () => {
      afterPreflight = undefined;
      entered.resolve();
      await resume.promise;
    };
    return { entered: entered.promise, resume: resume.resolve };
  };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `semantic-writer-${uuidv7()}@test.local`, isVerified: 1 },
    });
    userId = user.id;
    authorization = `Bearer ${jwt.sign(
      { userId, email: user.email, tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET!,
    )}`;
    prisma.$use(async (params, next) => {
      const result = await next(params);
      if (
        params.runInTransaction &&
        params.action === 'queryRaw' &&
        afterRequirementRead &&
        params.args[0]?.sql?.includes('required_capabilities <@')
      ) {
        const barrier = afterRequirementRead;
        afterRequirementRead = undefined;
        await barrier();
      }
      if (params.model === 'Operation' && params.action === 'createMany') {
        const op = params.args.data[0];
        if (op.userId === userId) await afterInsert?.(op.clientId);
      }
      return result;
    });
    app = Fastify();
    await app.register(
      async (scope) => {
        await syncRoutes(scope);
        // Registered AFTER syncRoutes' authentication + reader preHandler.
        scope.addHook('preHandler', async (req) => {
          if (
            req.method === 'POST' &&
            (req.body as { clientId?: string })?.clientId === B
          ) {
            await afterPreflight?.();
          }
        });
      },
      { prefix: '/api/sync' },
    );
    await app.ready();
  });

  beforeEach(async () => {
    releases = [];
    requests = [];
    afterPreflight = undefined;
    afterInsert = undefined;
    afterRequirementRead = undefined;
    initSyncService();
    await prisma.operation.deleteMany({ where: { userId } });
    await prisma.syncDevice.deleteMany({ where: { userId } });
    await prisma.userSyncState.deleteMany({ where: { userId } });
    await prisma.userSyncState.create({ data: { userId, lastSeq: 0 } });
    await prisma.user.update({ where: { id: userId }, data: { storageUsedBytes: 0 } });
  });

  afterEach(async () => {
    releases.forEach((release) => release());
    await Promise.allSettled(requests);
    afterPreflight = undefined;
    afterInsert = undefined;
    afterRequirementRead = undefined;
  });

  afterAll(async () => {
    await app?.close();
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('backfills all retained requirements, including pre-boundary recovery history (real PostgreSQL)', async () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../prisma/migrations/20261010050000_durable_semantic_requirements/migration.sql',
      ),
      'utf8',
    );
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE user_sync_state (user_id INTEGER, latest_full_state_seq INTEGER) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE operations (user_id INTEGER, required_capabilities TEXT[]) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe('INSERT INTO user_sync_state VALUES (1, 10), (2, NULL)');
      await tx.$executeRawUnsafe(
        "INSERT INTO operations VALUES (1, ARRAY['TASK_FOLDER_OWNERSHIP_V1']), (1, ARRAY['TASK_FOLDER_OWNERSHIP_V1']), (2, ARRAY[]::TEXT[])",
      );
      for (const statement of migration.split(';').filter((sql) => sql.trim()))
        await tx.$executeRawUnsafe(statement);
      expect(
        await tx.$queryRawUnsafe(
          'SELECT required_capabilities FROM user_sync_state ORDER BY user_id',
        ),
      ).toEqual([{ required_capabilities: [CAPABILITY] }, { required_capabilities: [] }]);
    });
  });

  it('keeps pre-activation replacement and ordinary writes compatible with unaware clients', async () => {
    const replacement = await snapshot(makeOp(B), true);
    expect(replacement.statusCode).toBe(200);
    expect(replacement.json().accepted).toBe(true);
    const ordinary = makeOp(B);
    ordinary.vectorClock = { [B]: 2 };
    expect((await upload(ordinary)).json().results[0].accepted).toBe(true);
    expect(
      (await prisma.userSyncState.findUniqueOrThrow({ where: { userId } }))
        .requiredCapabilities,
    ).toEqual([]);
  });

  it.each([false, true])(
    'retains activation after replacement (clean slate: %s) and pruning',
    async (cleanSlate) => {
      expect(
        (await upload(makeOp(A, [CAPABILITY]), undefined, CAPABILITY)).statusCode,
      ).toBe(200);
      const replacement = makeOp(A);
      const response = await app.inject({
        method: 'POST',
        url: `/api/sync/snapshot?supportedEntityTypes=TASK,FOLDER&supportedCapabilities=${CAPABILITY}`,
        headers: { authorization },
        payload: {
          clientId: A,
          opId: replacement.id,
          requestId: replacement.id,
          state: CIPHERTEXT,
          isPayloadEncrypted: true,
          reason: 'recovery',
          vectorClock: { [A]: 2 },
          schemaVersion: CURRENT_SCHEMA_VERSION,
          snapshotOpType: cleanSlate ? 'SYNC_IMPORT' : 'BACKUP_IMPORT',
          isCleanSlate: cleanSlate,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().accepted, response.body).toBe(true);
      // Snapshot deliberately has no visible feature entities or requirement stamp.
      const blocked = await upload(makeOp(B));
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().errorCode).toBe('FULL_STATE_READER_UNSUPPORTED');
      if (!cleanSlate) {
        expect(
          (await new StorageQuotaService().deleteOldestRestorePointAndOps(userId))
            .deletedCount,
        ).toBe(1);
      }
      expect(
        await prisma.operation.count({
          where: { userId, requiredCapabilities: { has: CAPABILITY } },
        }),
      ).toBe(0);
      expect((await upload(makeOp(B))).statusCode).toBe(409);
      const download = await app.inject({
        method: 'GET',
        url: `/api/sync/ops?sinceSeq=0&supportedEntityTypes=TASK,FOLDER&supportedCapabilities=${CAPABILITY}`,
        headers: { authorization },
      });
      expect(download.statusCode).toBe(200);
      expect(download.json().requiredCapabilities).toEqual([CAPABILITY]);
      const recovered = makeOp(B);
      expect(
        (await upload(recovered, undefined, CAPABILITY)).json().results[0].accepted,
      ).toBe(true);
      expect(
        (await upload(recovered, undefined, CAPABILITY)).json().results[0].accepted,
      ).toBe(true);
    },
  );

  it.each([
    'ordinary',
    'ordinary with cursor',
    'snapshot',
    'clean slate',
    'legacy repair',
  ])(
    'rejects a previously authorized %s upload when activation commits first',
    async (kind) => {
      const feature = makeOp(A, [CAPABILITY]);
      const pending = makeOp(B);
      const barrier = pauseAfterPreflight();
      const oldUpload = kind.startsWith('ordinary')
        ? upload(pending, kind === 'ordinary with cursor' ? 0 : undefined)
        : snapshot(pending, kind === 'clean slate', kind === 'legacy repair');
      await Promise.race([
        barrier.entered,
        oldUpload.then((r) => {
          throw new Error(`B never passed preflight: ${r.body}`);
        }),
      ]);

      const activation = await upload(feature, undefined, CAPABILITY);
      expect(activation.statusCode).toBe(200);
      expect(activation.json().results[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });
      const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      barrier.resume();
      const blocked = await oldUpload;

      // Check durable state first: preSerialization alone can return 409 AFTER
      // persisting B (the ordinary-with-cursor pre-fix failure).
      const stored = await prisma.operation.findMany({ where: { userId } });
      expect(stored.map((op) => op.id)).toEqual([feature.id]);
      expect(stored[0]).toMatchObject({
        payload: feature.payload,
        requiredCapabilities: [CAPABILITY],
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toMatchObject({
        errorCode: 'FULL_STATE_READER_UNSUPPORTED',
      });
      expect(blocked.json().results).toBeUndefined();
      expect(blocked.json().accepted).toBeUndefined();
      expect(blocked.json().latestSeq).toBeUndefined();
      expect(await prisma.userSyncState.findUnique({ where: { userId } })).toMatchObject({
        lastSeq: 1,
      });
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).storageUsedBytes,
      ).toBe(before.storageUsedBytes);

      // Same local operation and requestId are recoverable after upgrading;
      // a compatibility failure must never enter the request-dedup cache.
      const recovered = await upload(pending, undefined, CAPABILITY);
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json().results[0]).toMatchObject({ accepted: true, serverSeq: 2 });
      const retry = await upload(pending, undefined, CAPABILITY);
      expect(retry.json()).toMatchObject({
        deduplicated: true,
        results: recovered.json().results,
      });
    },
    20000,
  );

  it('also rejects a delayed writer after a full-state operation activates the requirement', async () => {
    const feature: Operation = {
      ...makeOp(A, [CAPABILITY]),
      opType: 'SYNC_IMPORT',
      entityType: 'ALL',
      entityId: undefined,
      requiredEntityTypes: ['FOLDER'],
    };
    const pending = makeOp(B);
    const barrier = pauseAfterPreflight();
    const older = upload(pending);
    await Promise.race([
      barrier.entered,
      older.then(() => {
        throw new Error('B did not reach the preflight barrier');
      }),
    ]);
    expect(
      (await upload(feature, undefined, CAPABILITY)).json().results[0],
    ).toMatchObject({ accepted: true, serverSeq: 1 });
    barrier.resume();
    expect((await older).json()).toMatchObject({
      errorCode: 'FULL_STATE_READER_UNSUPPORTED',
    });
    expect(await prisma.operation.count({ where: { id: pending.id } })).toBe(0);
    expect(
      await prisma.operation.findUnique({ where: { id: feature.id } }),
    ).toMatchObject({
      requiredCapabilities: [CAPABILITY],
      requiredEntityTypes: ['FOLDER'],
    });
    expect(await prisma.userSyncState.findUnique({ where: { userId } })).toMatchObject({
      lastSeq: 1,
      latestFullStateSeq: 1,
    });
  }, 20000);

  it('commits the older writer before activation when it owns the sequence row first', async () => {
    const feature = makeOp(A, [CAPABILITY]);
    const pending = makeOp(B);
    const inserted = deferred();
    const resume = deferred();
    releases.push(resume.resolve);
    afterInsert = async (clientId) => {
      if (clientId === B) {
        inserted.resolve();
        await resume.promise;
      }
    };
    const older = upload(pending);
    await inserted.promise;
    // A passes its preflight while B's compatible write is uncommitted.
    // The HTTP storage lock queues A behind B in this server instance.
    const activation = upload(feature, undefined, CAPABILITY);
    resume.resolve();
    expect((await older).json().results[0]).toMatchObject({
      accepted: true,
      serverSeq: 1,
    });
    expect((await activation).json().results[0]).toMatchObject({
      accepted: true,
      serverSeq: 2,
    });
    const stored = await prisma.operation.findMany({
      where: { userId },
      orderBy: { serverSeq: 'asc' },
    });
    expect(stored.map((op) => op.id)).toEqual([pending.id, feature.id]);
    expect(stored[1].requiredCapabilities).toEqual([CAPABILITY]);
    expect((await upload(makeOp(B))).statusCode).toBe(409);
  }, 20000);

  // Separate service instances bypass the process-local HTTP storage lock.
  // These tests exercise the PostgreSQL boundary used across server instances.
  const directUpload = (op: Operation, supportedCapabilities?: string) =>
    new SyncService().uploadOps(
      userId,
      op.clientId,
      [op],
      false,
      undefined,
      undefined,
      false,
      undefined,
      { supportedEntityTypes: 'TASK,FOLDER', supportedCapabilities },
    );

  const waitForDatabaseLock = async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const blocked = await prisma.$queryRaw<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database()
          AND cardinality(pg_blocking_pids(pid)) > 0
      `;
      if (blocked.length) return;
    }
    throw new Error('The second upload never waited on the PostgreSQL row lock');
  };

  it('rolls back B when activation commits after B reads a compatible transaction snapshot', async () => {
    const read = deferred();
    const resume = deferred();
    releases.push(resume.resolve);
    afterRequirementRead = async () => {
      read.resolve();
      await resume.promise;
    };
    const pending = makeOp(B);
    const feature = makeOp(A, [CAPABILITY]);
    const older = directUpload(pending).catch((error) => error);
    requests.push(older);
    await Promise.race([
      read.promise,
      older.then(() => {
        throw new Error('Missing transaction barrier');
      }),
    ]);
    expect((await directUpload(feature, CAPABILITY))[0]).toMatchObject({
      accepted: true,
      serverSeq: 1,
    });
    resume.resolve();
    expect(await older).toBeInstanceOf(FullStateReaderUnsupportedError);
    expect(await prisma.operation.count({ where: { id: pending.id } })).toBe(0);
    expect(
      await prisma.operation.findUnique({ where: { id: feature.id } }),
    ).toMatchObject({ requiredCapabilities: [CAPABILITY] });
    expect((await directUpload(pending, CAPABILITY))[0]).toMatchObject({
      accepted: true,
      serverSeq: 2,
    });
  }, 20000);

  it.each([A, B])(
    'orders overlapping database writers when %s owns the sequence lock',
    async (firstClient) => {
      const feature = makeOp(A, [CAPABILITY]);
      const pending = makeOp(B);
      const inserted = deferred();
      const resume = deferred();
      releases.push(resume.resolve);
      afterInsert = async (clientId) => {
        if (clientId === firstClient) {
          inserted.resolve();
          await resume.promise;
        }
      };
      const first = directUpload(
        firstClient === A ? feature : pending,
        firstClient === A ? CAPABILITY : undefined,
      );
      requests.push(first);
      await inserted.promise;
      const second = directUpload(
        firstClient === A ? pending : feature,
        firstClient === A ? undefined : CAPABILITY,
      ).catch((error) => error);
      requests.push(second);
      await waitForDatabaseLock();
      resume.resolve();
      expect((await first)[0]).toMatchObject({ accepted: true, serverSeq: 1 });
      const result = await second;
      if (firstClient === A) {
        expect(result).toBeInstanceOf(FullStateReaderUnsupportedError);
        expect(await prisma.operation.count({ where: { id: pending.id } })).toBe(0);
      } else {
        // RepeatableRead keeps A's pre-B snapshot. Preserve the established
        // transient rejection contract; its retry must safely activate next.
        expect(result[0]).toMatchObject({ accepted: false, errorCode: 'INTERNAL_ERROR' });
        expect((await directUpload(feature, CAPABILITY))[0]).toMatchObject({
          accepted: true,
          serverSeq: 2,
        });
        const stored = await prisma.operation.findMany({
          where: { userId },
          orderBy: { serverSeq: 'asc' },
        });
        expect(stored.map((op) => op.id)).toEqual([pending.id, feature.id]);
      }
      expect(
        await prisma.operation.findUnique({ where: { id: feature.id } }),
      ).toMatchObject({ requiredCapabilities: [CAPABILITY] });
    },
    20000,
  );
});
