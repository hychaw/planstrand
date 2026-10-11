import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { encrypt } from '@sp/sync-core';
import { prisma } from '../../src/db';

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;
describeWithDb('operator recovery CLI with real encrypted PostgreSQL data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-recovery-'));
  const password = randomBytes(32).toString('base64url');
  let userId: number;
  const state = {
    task: {
      ids: ['one', 'two'],
      entities: {
        one: { id: 'one', subTaskIds: [] },
        two: { id: 'two', subTaskIds: [] },
      },
    },
    eventSeries: {
      ids: ['series'],
      entities: {
        series: {
          id: 'series',
          title: 'Series',
          created: 1,
          modified: 10,
          deletedAt: 10,
          segments: [
            {
              id: 'first',
              recurrence: { frequency: 'daily', interval: 1, startDate: '2026-01-01' },
              timing: { kind: 'allDay' },
            },
          ],
        },
      },
    },
    occurrenceException: {
      ids: ['occurrenceException:["series",1]'],
      entities: {
        'occurrenceException:["series",1]': {
          id: 'occurrenceException:["series",1]',
          seriesId: 'series',
          slot: 1,
          value: { kind: 'cancelled' },
          modified: 10,
        },
      },
    },
    weeklyTemplate: {
      ids: ['template'],
      entities: {
        template: {
          id: 'template',
          title: 'Template',
          isActive: false,
          startDate: '2026-01-01',
          created: 1,
          modified: 10,
          deletedAt: 10,
        },
      },
    },
  };
  const run = (seq: number, name: string, key = password) => {
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
        String(seq),
        '--out',
        out,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, RECOVER_ENCRYPT_KEY: key },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    return { ...result, out };
  };
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `operator-${randomUUID()}@test.local`, isVerified: 1 },
    });
    userId = user.id;
    await prisma.userSyncState.create({
      data: { userId, lastSeq: 1, requiredCapabilities: ['ROUTINES_V1'] },
    });
    await prisma.operation.create({
      data: {
        id: randomUUID(),
        userId,
        clientId: 'recovery',
        serverSeq: 1,
        actionType: '[SP_ALL] Load(import) all data',
        opType: 'BACKUP_IMPORT',
        entityType: 'ALL',
        payload: await encrypt(JSON.stringify(state), password),
        vectorClock: { recovery: 1 },
        schemaVersion: 5,
        clientTimestamp: 1n,
        receivedAt: 1n,
        isPayloadEncrypted: true,
      },
    });
  });
  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('operator-recovery-')
    )
      throw new Error('Refusing cleanup outside the disposable recovery directory');
    rmSync(directory, { recursive: true, force: true });
  });
  it('retains normalized full-state records and the account capability floor', () => {
    const result = run(1, 'full');
    expect(result.status, result.stderr).toBe(0);
    const recovered = JSON.parse(readFileSync(result.out, 'utf8'));
    expect(recovered.appDataComplete).toEqual(state);
    expect(recovered.requiredCapabilities).toContain('ROUTINES_V1');
  });
  it('refuses missing and incorrect keys without creating an output', () => {
    for (const key of ['', randomUUID()]) {
      const result = run(1, `key-${key ? 'incorrect' : 'missing'}`, key);
      expect(result.status).not.toBe(0);
      expect(existsSync(result.out)).toBe(false);
    }
  });
  it('refuses a missing final target operation', async () => {
    await prisma.userSyncState.update({ where: { userId }, data: { lastSeq: 2 } });
    const result = run(2, 'missing-target');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('before target 2');
    expect(existsSync(result.out)).toBe(false);
  });
  it('refuses a malformed Routines tail instead of returning a successful incomplete state', async () => {
    await prisma.operation.create({
      data: {
        id: randomUUID(),
        userId,
        clientId: 'recovery',
        serverSeq: 2,
        actionType: '[EventSeries] Add Event Series',
        opType: 'CRT',
        entityType: 'EVENT_SERIES',
        entityId: 'new-series',
        payload: await encrypt(
          JSON.stringify({ actionPayload: { eventSeries: { id: 'new-series' } } }),
          password,
        ),
        vectorClock: { recovery: 2 },
        schemaVersion: 5,
        clientTimestamp: 2n,
        receivedAt: 2n,
        isPayloadEncrypted: true,
        requiredCapabilities: ['ROUTINES_V1'],
      },
    });
    const result = run(2, 'routines-tail');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('RECOVERY_INVALID_ROUTINES_OPERATION');
    expect(existsSync(result.out)).toBe(false);
  });
  it('preserves batch entity IDs and causal REPAIR metadata during decryption', async () => {
    await prisma.operation.deleteMany({ where: { userId, serverSeq: 2 } });
    const common = {
      userId,
      clientId: 'recovery',
      schemaVersion: 5,
      clientTimestamp: 2n,
      receivedAt: 2n,
      isPayloadEncrypted: true,
    };
    await prisma.operation.create({
      data: {
        ...common,
        id: randomUUID(),
        serverSeq: 2,
        actionType: '[Task] Delete multiple',
        opType: 'DEL',
        entityType: 'TASK',
        entityId: 'one',
        entityIds: ['one', 'two'],
        payload: await encrypt('{}', password),
        vectorClock: { recovery: 2 },
      },
    });
    const deleted = run(2, 'batch-delete');
    expect(deleted.status, deleted.stderr).toBe(0);
    expect(JSON.parse(readFileSync(deleted.out, 'utf8')).appDataComplete.task).toEqual({
      ids: [],
      entities: {},
    });
    await prisma.operation.create({
      data: {
        ...common,
        id: randomUUID(),
        serverSeq: 3,
        actionType: '[SP_ALL] Load(import) all data',
        opType: 'REPAIR',
        entityType: 'ALL',
        payload: await encrypt(JSON.stringify(state), password),
        vectorClock: { recovery: 3 },
        repairBaseServerSeq: 2,
      },
    });
    await prisma.userSyncState.update({ where: { userId }, data: { lastSeq: 3 } });
    const repaired = run(3, 'causal-repair');
    expect(repaired.status, repaired.stderr).toBe(0);
    expect(JSON.parse(readFileSync(repaired.out, 'utf8')).appDataComplete).toEqual(state);
  });
  it('refuses a gap inside the encrypted log without producing an output', async () => {
    await prisma.operation.deleteMany({ where: { userId, serverSeq: 2 } });
    const result = run(3, 'midstream-gap');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Gap in operation log');
    expect(existsSync(result.out)).toBe(false);
  });
});
