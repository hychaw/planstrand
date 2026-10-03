import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { TASK_FOLDER_OWNERSHIP_V1 } from '@sp/shared-schema';
const mocks = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(),
    userSyncState: { findUnique: vi.fn() },
    operation: { findUnique: vi.fn() },
  },
  service: {
    getOpsSinceWithSeq: vi.fn(),
    touchDevice: vi.fn(),
    uploadOps: vi.fn(),
    generateSnapshotAtSeq: vi.fn(),
  },
}));
vi.mock('../src/db', () => ({ prisma: mocks.prisma }));
vi.mock('../src/middleware', () => ({
  authenticate: vi.fn(async () => {}),
  getAuthUser: () => ({ userId: 1 }),
}));
vi.mock('../src/sync/sync.service', () => ({ getSyncService: () => mocks.service }));
import { syncRoutes } from '../src/sync/sync.routes';
const encrypted = {
  serverSeq: 8,
  receivedAt: 100,
  op: {
    id: 'snapshot',
    clientId: 'writer',
    actionType: '[All] Load All Data',
    opType: 'SYNC_IMPORT',
    entityType: 'ALL',
    payload: Buffer.alloc(44, 7).toString('base64'),
    isPayloadEncrypted: true,
    requiredEntityTypes: ['FOLDER'],
    vectorClock: { writer: 1 },
    timestamp: 100,
    schemaVersion: 5,
  },
};
describe('Server full-state reader fence through HTTP', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    mocks.prisma.userSyncState.findUnique.mockResolvedValue({ latestFullStateSeq: 8 });
    mocks.prisma.operation.findUnique.mockResolvedValue({
      requiredEntityTypes: ['FOLDER'],
    });
    mocks.service.getOpsSinceWithSeq.mockResolvedValue({
      ops: [encrypted],
      latestSeq: 8,
      gapDetected: false,
    });
    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });
  it('blocks a Folder-only reader before delivery when the tail requires ownership semantics', async () => {
    mocks.prisma.$queryRaw.mockImplementation(async (query) =>
      query.values.includes(TASK_FOLDER_OWNERSHIP_V1) ? [] : [{ id: 'task-op' }],
    );
    for (const advertisement of ['', '&supportedCapabilities=FUTURE']) {
      const blocked = await app.inject(
        `/api/sync/ops?sinceSeq=0&supportedEntityTypes=FOLDER${advertisement}`,
      );
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().ops).toBeUndefined();
      expect(blocked.json().latestSeq).toBeUndefined();
      expect(mocks.service.getOpsSinceWithSeq).not.toHaveBeenCalled();
    }
    const future = await app.inject(
      `/api/sync/ops?sinceSeq=0&supportedEntityTypes=FOLDER&supportedCapabilities=${TASK_FOLDER_OWNERSHIP_V1}`,
    );
    expect(future.statusCode).toBe(200);
  });
  it('fences unaware writes even when no full-state boundary exists', async () => {
    mocks.prisma.userSyncState.findUnique.mockResolvedValue(null);
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: 'task-op' }]);
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/sync/ops?supportedEntityTypes=FOLDER',
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    expect(mocks.service.uploadOps).not.toHaveBeenCalled();
    expect(mocks.prisma.$queryRaw.mock.calls[0][0].values[1]).toBe(0);
  });
  it('blocks an ordinary encrypted Task operation in the response race', async () => {
    mocks.prisma.userSyncState.findUnique.mockResolvedValue(null);
    mocks.service.getOpsSinceWithSeq.mockResolvedValue({
      ops: [
        {
          ...encrypted,
          op: {
            ...encrypted.op,
            entityType: 'TASK',
            opType: 'UPD',
            requiredCapabilities: [TASK_FOLDER_OWNERSHIP_V1],
          },
        },
      ],
      latestSeq: 8,
      gapDetected: false,
    });
    const blocked = await app.inject(
      '/api/sync/ops?sinceSeq=0&supportedEntityTypes=FOLDER',
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().ops).toBeUndefined();
    expect(blocked.json().latestSeq).toBeUndefined();
    const future = await app.inject(
      `/api/sync/ops?sinceSeq=0&supportedEntityTypes=FOLDER&supportedCapabilities=${TASK_FOLDER_OWNERSHIP_V1}`,
    );
    expect(future.statusCode).toBe(200);
    expect(future.json().ops[0].op.requiredCapabilities).toEqual([
      TASK_FOLDER_OWNERSHIP_V1,
    ]);
    expect(
      (
        await app.inject(
          `/api/sync/ops?sinceSeq=0&supportedCapabilities=${TASK_FOLDER_OWNERSHIP_V1}`,
        )
      ).statusCode,
    ).toBe(409);
  });
  it('rejects unknown future semantic requirements even for an ownership-capable reader', async () => {
    mocks.service.getOpsSinceWithSeq.mockResolvedValue({
      ops: [{ ...encrypted, op: { ...encrypted.op, requiredCapabilities: ['FUTURE'] } }],
      latestSeq: 8,
      gapDetected: false,
    });
    const blocked = await app.inject(
      '/api/sync/ops?sinceSeq=0&supportedEntityTypes=FOLDER&supportedCapabilities=' +
        TASK_FOLDER_OWNERSHIP_V1,
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().latestSeq).toBeUndefined();
    expect(blocked.json().ops).toBeUndefined();
  });
  it('serves ciphertext and requirements to an advertising reader', async () => {
    const response = await app.inject(
      '/api/sync/ops?sinceSeq=0&supportedEntityTypes=FOLDER,TASK',
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().ops[0]).toEqual(encrypted);
  });
  for (const advertisement of ['', '&supportedEntityTypes=TASK'])
    it('blocks unsupported readers before download and exposes no cursor', async () => {
      const response = await app.inject(`/api/sync/ops?sinceSeq=0${advertisement}`);
      expect(response.statusCode).toBe(409);
      expect(response.json().latestSeq).toBeUndefined();
      expect(mocks.service.getOpsSinceWithSeq).not.toHaveBeenCalled();
    });
  for (const method of ['POST', 'DELETE'] as const)
    it('blocks Folder-dropping writes/reset by a non-advertising reader', async () => {
      const response = await app.inject({
        method,
        url: method === 'POST' ? '/api/sync/snapshot' : '/api/sync/data',
        ...(method === 'POST' ? { payload: { state: 'reduced' } } : {}),
      });
      expect(response.statusCode).toBe(409);
      expect(mocks.service.uploadOps).not.toHaveBeenCalled();
    });
  it('allows legacy/default state without a Folder requirement', async () => {
    mocks.prisma.operation.findUnique.mockResolvedValue({ requiredEntityTypes: [] });
    mocks.service.getOpsSinceWithSeq.mockResolvedValue({
      ops: [{ ...encrypted, op: { ...encrypted.op, requiredEntityTypes: [] } }],
      latestSeq: 8,
      gapDetected: false,
    });
    expect((await app.inject('/api/sync/ops?sinceSeq=0')).statusCode).toBe(200);
  });
  it('blocks a historical raw Folder snapshot before returning any state or cursor', async () => {
    mocks.prisma.userSyncState.findUnique.mockResolvedValue(null);
    mocks.service.generateSnapshotAtSeq.mockResolvedValue({
      state: {
        folder: { ids: ['user'], entities: { user: { id: 'user', title: 'User' } } },
      },
      serverSeq: 1,
    });
    const blocked = await app.inject('/api/sync/restore/1');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().state).toBeUndefined();
    expect(blocked.json().serverSeq).toBeUndefined();
    const supported = await app.inject('/api/sync/restore/1?supportedEntityTypes=FOLDER');
    expect(supported.statusCode).toBe(200);
    expect(supported.json().state.folder.ids).toEqual(['user']);
  });
  it('blocks a newly committed boundary even if preHandler saw no requirement', async () => {
    mocks.prisma.userSyncState.findUnique.mockResolvedValue(null);
    const response = await app.inject('/api/sync/ops?sinceSeq=0');
    expect(response.statusCode).toBe(409);
    expect(response.json().ops).toBeUndefined();
    expect(response.json().latestSeq).toBeUndefined();
  });
});
