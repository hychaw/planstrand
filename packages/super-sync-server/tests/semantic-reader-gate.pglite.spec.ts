import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import { TASK_FOLDER_OWNERSHIP_V1 } from '@sp/shared-schema';

const mocks = vi.hoisted(() => ({
  userSyncState: { findUnique: vi.fn() },
  operation: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock('../src/db', () => ({ prisma: mocks }));
import { assertFullStateReader } from '../src/sync/full-state-reader-gate';

describe('semantic reader gate using PostgreSQL array semantics', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE TABLE operations (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, server_seq BIGINT NOT NULL
    );
    INSERT INTO operations VALUES ('legacy-before-migration', 1, 1);`);
    await db.exec(
      readFileSync(
        resolve(
          __dirname,
          '../prisma/migrations/20261003010000_semantic_reader_requirements/migration.sql',
        ),
        'utf8',
      ),
    );
    const legacy = await db.query<{ required_capabilities: string[] }>(
      'SELECT required_capabilities FROM operations',
    );
    expect(legacy.rows[0].required_capabilities).toEqual([]);
  });
  beforeEach(async () => {
    await db.exec('TRUNCATE operations');
    mocks.userSyncState.findUnique.mockResolvedValue({ latestFullStateSeq: 1 });
    mocks.operation.findUnique.mockResolvedValue({ requiredEntityTypes: [] });
    mocks.$queryRaw.mockImplementation(
      async (query: Prisma.Sql) =>
        (await db.query<{ id: string }>(query.text, query.values)).rows,
    );
  });
  afterAll(async () => db.close());
  const insert = async (requirements: string[], seq = 2, userId = 1): Promise<void> => {
    const tokens = requirements.map((_, i) => `$${i + 4}`).join(',');
    await db.query(
      `INSERT INTO operations (id, user_id, server_seq, required_capabilities)
      VALUES ($1, $2, $3, ARRAY[${tokens}]::TEXT[])`,
      [`${userId}-${seq}`, userId, seq, ...requirements],
    );
  };
  it('blocks a Folder-only reader and a missing semantic advertisement', async () => {
    await insert([TASK_FOLDER_OWNERSHIP_V1]);
    expect(await assertFullStateReader(1, 'FOLDER')).toBe(false);
    expect(await assertFullStateReader(1, 'FOLDER', '')).toBe(false);
  });
  it('accepts a simulated future reader with the required capability', async () => {
    await insert([TASK_FOLDER_OWNERSHIP_V1]);
    expect(await assertFullStateReader(1, 'FOLDER', TASK_FOLDER_OWNERSHIP_V1)).toBe(true);
  });
  it('rejects an unknown token even when another requirement is supported', async () => {
    await insert([TASK_FOLDER_OWNERSHIP_V1, 'FUTURE']);
    expect(await assertFullStateReader(1, 'FOLDER', TASK_FOLDER_OWNERSHIP_V1)).toBe(
      false,
    );
  });
  it('keeps legacy operations without semantic requirements compatible', async () => {
    await insert([]);
    expect(await assertFullStateReader(1, undefined)).toBe(true);
  });
  it('retains the independent Folder entity fence', async () => {
    await insert([TASK_FOLDER_OWNERSHIP_V1]);
    mocks.operation.findUnique.mockResolvedValue({ requiredEntityTypes: ['FOLDER'] });
    expect(await assertFullStateReader(1, 'TASK', TASK_FOLDER_OWNERSHIP_V1)).toBe(false);
  });
  it('checks a semantic operation even before any full-state boundary exists', async () => {
    await insert([TASK_FOLDER_OWNERSHIP_V1]);
    mocks.userSyncState.findUnique.mockResolvedValue(null);
    expect(await assertFullStateReader(1, 'FOLDER')).toBe(false);
  });
  it('uses the current causal boundary and isolates users', async () => {
    await insert([TASK_FOLDER_OWNERSHIP_V1], 1);
    await insert(['FUTURE'], 4, 2);
    mocks.userSyncState.findUnique.mockResolvedValue({ latestFullStateSeq: 2 });
    expect(await assertFullStateReader(1, 'FOLDER')).toBe(true);
  });
});
