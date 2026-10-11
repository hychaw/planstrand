import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptBatch } from '@sp/sync-core';
import { prisma } from '../../src/db';

const fixture = JSON.parse(
  readFileSync(resolve('tests/fixtures/production-workflow-recovery.json'), 'utf8'),
);
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const digest = (v: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
const withDatabase = process.env.DATABASE_URL ? describe : describe.skip;

withDatabase('production scheduling, conversion and Project recovery', () => {
  const directory = mkdtempSync(join(tmpdir(), 'production-workflow-recovery-'));
  const password = randomBytes(32).toString('base64url');
  const floor = [
    ...new Set<string>(
      fixture.operations.flatMap((op: any) => op.requiredCapabilities ?? []),
    ),
  ];
  let userId: number;
  const seed = async (rows: any[]): Promise<void> => {
    await prisma.operation.deleteMany({ where: { userId } });
    await prisma.userSyncState.upsert({
      where: { userId },
      create: { userId, lastSeq: rows.length, requiredCapabilities: floor },
      update: { lastSeq: rows.length, requiredCapabilities: floor },
    });
    const encrypted = await encryptBatch(
      rows.map((row) => JSON.stringify(row.payload)),
      password,
    );
    for (const [i, row] of rows.entries())
      await prisma.operation.create({
        data: {
          id: row.id,
          userId,
          serverSeq: row.serverSeq,
          clientId: row.clientId,
          actionType: row.actionType,
          opType: row.opType,
          entityType: row.entityType,
          entityId: row.entityId ?? null,
          entityIds: row.entityIds ?? [],
          payload: encrypted[i],
          isPayloadEncrypted: true,
          schemaVersion: row.schemaVersion,
          vectorClock: row.vectorClock,
          clientTimestamp: BigInt(row.timestamp),
          receivedAt: BigInt(row.timestamp),
          requiredCapabilities: row.requiredCapabilities ?? [],
        },
      });
  };
  const run = (target: number, name: string) => {
    const out = join(directory, `${name}.json`);
    const result = spawnSync(
      process.execPath,
      [
        resolve('../../node_modules/ts-node/dist/bin.js'),
        '--transpile-only',
        'scripts/recover-user.ts',
        '--user',
        String(userId),
        '--target-seq',
        String(target),
        '--out',
        out,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, RECOVER_ENCRYPT_KEY: password },
        encoding: 'utf8',
        timeout: 90000,
      },
    );
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(result.stdout + result.stderr).not.toContain('Recovery workflow project');
    return { ...result, out };
  };
  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { email: `${randomUUID()}@test.local`, isVerified: 1 },
      })
    ).id;
  });
  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });
  it('matches every complete production checkpoint, including the mixed snapshot tail', async () => {
    await seed(fixture.operations);
    for (const check of fixture.checks) {
      const result = run(check.count, check.name);
      expect(result.status, `${check.name}: ${result.stderr}`).toBe(0);
      const recovered = JSON.parse(readFileSync(result.out, 'utf8'));
      expect(digest(recovered.appDataComplete), check.name).toBe(check.stateSha256);
      expect(new Set(recovered.requiredCapabilities)).toEqual(
        new Set([...floor, ...check.requiredCapabilities]),
      );
    }
  }, 180000);
  it('refuses missing source context, malformed IDs and unknown Project actions without output', async () => {
    const actions = [
      'scheduleTaskWithTime',
      'reScheduleTaskWithTime',
      'unscheduleTask',
      'convertToSubTask',
      'convertToMainTask',
    ];
    const cases: [string, any[]][] = [];
    for (const action of actions) {
      const index = fixture.operations.findIndex(
        (op: any) => op.actionType === `[Task Shared] ${action}`,
      );
      const rows = structuredClone(fixture.operations.slice(0, index + 1));
      delete rows[index].payload.taskReplayContext;
      rows[index].requiredCapabilities = (rows[index].requiredCapabilities ?? []).filter(
        (c: string) => c !== 'TASK_REPLAY_CONTEXT_V1',
      );
      cases.push([`legacy-${action}`, rows]);
    }
    for (const [name, change] of [
      [
        'project-id',
        (row: any) => {
          row.payload.actionPayload.project.id = 'different-id';
        },
      ],
      [
        'project-action',
        (row: any) => {
          row.actionType = '[Project] Unknown action';
        },
      ],
    ] as const) {
      const rows = structuredClone(fixture.operations.slice(0, 2));
      change(rows[1]);
      cases.push([name, rows]);
    }
    for (const [name, rows] of cases) {
      await seed(rows);
      const result = run(rows.length, name);
      expect(result.status, name).not.toBe(0);
      expect(existsSync(result.out), name).toBe(false);
    }
  }, 180000);
});
