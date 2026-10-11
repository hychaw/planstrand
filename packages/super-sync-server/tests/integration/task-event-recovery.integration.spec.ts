import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptBatch } from '@sp/sync-core';
import { prisma } from '../../src/db';

const fixture = JSON.parse(
  readFileSync(resolve('tests/fixtures/task-event-recovery.json'), 'utf8'),
);
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (state: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(state)))
    .digest('hex');

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;
describeWithDb('authoritative encrypted Task/Event operator recovery', () => {
  const directory = mkdtempSync(join(tmpdir(), 'task-event-recovery-'));
  const password = randomBytes(32).toString('base64url');
  const floor = [
    ...new Set<string>(
      fixture.operations.flatMap((op: any) => op.requiredCapabilities ?? []),
    ),
  ];
  let userId: number;
  const seed = async (rows: any[], target = rows.at(-1).serverSeq): Promise<void> => {
    await prisma.operation.deleteMany({ where: { userId } });
    await prisma.userSyncState.upsert({
      where: { userId },
      create: { userId, lastSeq: target, requiredCapabilities: floor },
      update: { lastSeq: target, requiredCapabilities: floor },
    });
    const encrypted = await encryptBatch(
      rows.map((row) => JSON.stringify(row.payload)),
      password,
    );
    for (const [i, row] of rows.entries()) {
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
          repairBaseServerSeq: row.repairBaseServerSeq,
        },
      });
    }
  };
  const run = (target: number, name: string, key = password) => {
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
        env: { ...process.env, RECOVER_ENCRYPT_KEY: key },
        encoding: 'utf8',
        timeout: 90000,
      },
    );
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(result.stdout + result.stderr).not.toContain('Synthetic recovery fixture');
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
    if (dirname(resolve(directory)) !== resolve(tmpdir()))
      throw new Error('Invalid test directory');
    rmSync(directory, { recursive: true, force: true });
  });

  it('matches every complete persisted source checkpoint and retains the capability floor', async () => {
    await seed(fixture.operations);
    for (const check of fixture.checks) {
      const result = run(check.count, check.name);
      expect(result.status, `${check.name}: ${result.stderr}`).toBe(0);
      const recovered = JSON.parse(readFileSync(result.out, 'utf8'));
      // Hash every persisted slice and field, including both archives, ordering,
      // relationships, tombstones, timestamps and the inner capability metadata.
      expect(digest(recovered.appDataComplete), check.name).toBe(check.stateSha256);
      expect(new Set(recovered.requiredCapabilities)).toEqual(
        new Set([...floor, ...check.requiredCapabilities]),
      );
    }
  }, 180000);

  it('rejects unprovable histories and replay failures without writing an export', async () => {
    const base = fixture.operations;
    const mutate = (count: number, change: (rows: any[]) => void): any[] => {
      const rows = structuredClone(base.slice(0, count));
      change(rows);
      return rows;
    };
    const cases: [string, any[], number?][] = [
      [
        'missing-operation',
        base.slice(0, 4).filter((_: unknown, i: number) => i !== 2),
        4,
      ],
      ['missing-target', base.slice(0, 2), 3],
      ['missing-base', base.slice(1, 3), 3],
      [
        'missing-context',
        mutate(3, (rows) => {
          delete rows[2].payload.taskReplayContext;
          rows[2].requiredCapabilities = [];
        }),
      ],
      [
        'legacy-context',
        mutate(3, (rows) => {
          rows[2].schemaVersion = 4;
        }),
      ],
      [
        'ambiguous-scheduled-create',
        mutate(2, (rows) => {
          rows[1].payload.actionPayload.task.dueDay = '2026-10-11';
        }),
      ],
      [
        'unsupported-action',
        mutate(2, (rows) => {
          rows[1].actionType = '[Task] Unknown action';
        }),
      ],
      [
        'future-schema',
        mutate(2, (rows) => {
          rows[1].schemaVersion = 999;
        }),
      ],
      [
        'unknown-capability',
        mutate(2, (rows) => {
          rows[1].requiredCapabilities = ['UNSUPPORTED_V99'];
        }),
      ],
      [
        'markerless-repair',
        mutate(3, (rows) => {
          rows[2] = { ...rows[0], id: randomUUID(), serverSeq: 3, opType: 'REPAIR' };
        }),
      ],
      [
        'unsupported-compensation',
        mutate(3, (rows) => {
          rows[2].entityType = 'WORK_SESSION';
          rows[2].actionType = '[WORK_SESSION] LWW Update';
        }),
      ],
      [
        'invalid-persisted-result',
        mutate(3, (rows) => {
          rows[2].payload.actionPayload.task.changes.parentId = 'nonexistent-parent';
        }),
      ],
      [
        'bad-archive-command',
        mutate(10, (rows) => {
          rows[9].payload.actionPayload.archiveCommand.version = 99;
        }),
      ],
      [
        'invalid-event',
        mutate(4, (rows) => {
          rows[3].payload.actionPayload.event.date = 'impossible';
        }),
      ],
    ];
    const lww = structuredClone(
      base.find((op: any) => op.actionType === '[TASK] LWW Update'),
    );
    lww.id = randomUUID();
    lww.serverSeq = 13;
    lww.entityId = 'archive-one';
    lww.payload.actionPayload.id = 'archive-one';
    // Existing archive winners are unsupported; archive/LWW suppression inside
    // the same replay window is covered by the successful source checkpoints.
    const archivedBase = structuredClone(base[0]);
    const tasks = base[9].payload.actionPayload.archiveCommand.archivedTasks;
    archivedBase.payload.archiveYoung.task = {
      ids: tasks.map((task: any) => task.id),
      entities: Object.fromEntries(tasks.map((task: any) => [task.id, task])),
    };
    cases.push(['archived-compensation', [archivedBase, { ...lww, serverSeq: 2 }]]);
    const unsupportedPrefix = mutate(2, (rows) => {
      rows[1].actionType = '[Task] Unknown action';
    });
    unsupportedPrefix.push({ ...base[0], id: randomUUID(), serverSeq: 3 });
    cases.push(['unsupported-prefix-before-snapshot', unsupportedPrefix]);
    for (const [name, rows, target] of cases) {
      await seed(rows, target ?? rows.at(-1).serverSeq);
      const result = run(target ?? rows.at(-1).serverSeq, name);
      expect(result.status, name).not.toBe(0);
      expect(existsSync(result.out), name).toBe(false);
    }
    await seed(base.slice(0, 2));
    for (const key of ['', randomUUID()]) {
      const result = run(2, `key-${key ? 'incorrect' : 'missing'}`, key);
      expect(result.status).not.toBe(0);
      expect(existsSync(result.out)).toBe(false);
    }
  }, 180000);
});
