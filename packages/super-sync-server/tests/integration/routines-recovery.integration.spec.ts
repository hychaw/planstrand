import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { encryptBatch } from '@sp/sync-core';
import { prisma } from '../../src/db';
import {
  routinesRecoveryFixture,
  recoveryOperation,
  recoverySeries,
  recoveryTemplate,
  recoveryBase,
  type RecoveryFixtureOperation,
} from '../fixtures/routines-recovery.fixture';

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;
describeWithDb('encrypted Routines snapshot-plus-tail operator recovery', () => {
  const password = randomBytes(32).toString('base64url');
  const users: number[] = [];
  let directory: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'routines-recovery-'));
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('routines-recovery-')
    )
      throw new Error('Unsafe recovery cleanup path');
    rmSync(directory, { recursive: true, force: true });
  });
  const seed = async (
    ops: RecoveryFixtureOperation[],
    base: Record<string, unknown> = recoveryBase(),
  ) => {
    const user = await prisma.user.create({
      data: { email: `routines-recovery-${randomUUID()}@test.local`, isVerified: 1 },
    });
    users.push(user.id);
    const all = [
      {
        actionType: '[SP_ALL] Load(import) all data',
        entityType: 'ALL',
        entityId: 'snapshot',
        opType: 'BACKUP_IMPORT',
        payload: base,
      },
      ...ops,
    ];
    const encrypted = await encryptBatch(
      all.map((op) => JSON.stringify(op.payload)),
      password,
    );
    await prisma.userSyncState.create({
      data: {
        userId: user.id,
        lastSeq: all.length,
        requiredCapabilities: ['ROUTINES_V1'],
      },
    });
    for (const [index, op] of all.entries())
      await prisma.operation.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          clientId: 'source',
          serverSeq: index + 1,
          actionType: op.actionType,
          entityType: op.entityType,
          entityId: op.entityId,
          entityIds: op.entityType === 'ALL' ? [] : [op.entityId],
          opType: op.opType,
          payload: encrypted[index],
          vectorClock: { source: index + 1 },
          repairBaseServerSeq: (op as RecoveryFixtureOperation).repairBaseServerSeq,
          schemaVersion: 5,
          clientTimestamp: BigInt(index + 1),
          receivedAt: BigInt(index + 1),
          isPayloadEncrypted: true,
          requiredCapabilities: op.entityType === 'ALL' ? [] : ['ROUTINES_V1'],
        },
      });
    return { userId: user.id, seq: all.length };
  };
  const run = (userId: number, seq: number, key = password) => {
    const out = join(directory, `${randomUUID()}.json`);
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
        timeout: 60000,
      },
    );
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(result.stdout + result.stderr).not.toContain('PRIVATE_RECOVERY_CONTENT');
    return { ...result, out };
  };
  const recovered = (userId: number, seq: number) => {
    const result = run(userId, seq);
    expect(result.status, result.stderr).toBe(0);
    const backup = JSON.parse(readFileSync(result.out, 'utf8'));
    expect(backup.requiredCapabilities).toContain('ROUTINES_V1');
    return backup;
  };
  const refuses = (userId: number, seq: number, message?: string, key = password) => {
    const result = run(userId, seq, key);
    expect(result.status).not.toBe(0);
    expect(existsSync(result.out)).toBe(false);
    if (message) expect(result.stderr).toContain(message);
  };

  it('reconstructs all supported actions, multi-segment identities, exceptions, compensation and terminal tombstones', async () => {
    const fixture = routinesRecoveryFixture();
    fixture.base.task.entities.task.title = 'PRIVATE_RECOVERY_CONTENT';
    fixture.expected.task.entities.task.title = 'PRIVATE_RECOVERY_CONTENT';
    const source = await seed(fixture.ops, fixture.base);
    const backup = recovered(source.userId, source.seq);
    expect(backup.appDataComplete).toEqual(fixture.expected);
    expect(backup.requiredEntityTypes).toEqual(
      expect.arrayContaining(['EVENT_SERIES', 'OCCURRENCE_EXCEPTION', 'WEEKLY_TEMPLATE']),
    );
    expect(backup.appDataComplete.EVENT_SERIES).toBeUndefined();
  });
  it('preserves a causal REPAIR boundary and replays subsequent encrypted changes', async () => {
    const fixture = routinesRecoveryFixture();
    const repair = {
      actionType: '[Repair] Auto Repair',
      entityType: 'ALL',
      entityId: 'repair',
      opType: 'REPAIR',
      repairBaseServerSeq: fixture.ops.length + 1,
      payload: { appDataComplete: fixture.expected },
    };
    const changes = { title: 'After repair', isActive: false, startDate: '2026-03-01' };
    const tail = recoveryOperation(
      '[WeeklyTemplate] Update Weekly Template',
      'WEEKLY_TEMPLATE',
      'active',
      { id: 'active', changes, modified: 50 },
    );
    const source = await seed([...fixture.ops, repair, tail]);
    const backup = recovered(source.userId, source.seq);
    expect(backup.appDataComplete).toEqual({
      ...fixture.expected,
      weeklyTemplate: {
        ...fixture.expected.weeklyTemplate,
        entities: {
          ...fixture.expected.weeklyTemplate.entities,
          active: { id: 'active', created: 1, ...changes, modified: 50 },
        },
      },
    });
  });
  it('retains activation after a full-state replacement removes all Routines entities and history metadata', async () => {
    const series = recoverySeries('deleted');
    const ops = [
      recoveryOperation(
        '[EventSeries] Add Event Series',
        'EVENT_SERIES',
        series.id,
        { eventSeries: series },
        'CRT',
      ),
      recoveryOperation('[EventSeries] Delete Entire Series', 'EVENT_SERIES', series.id, {
        eventSeries: { ...series, modified: 2, deletedAt: 2 },
      }),
      {
        actionType: '[SP_ALL] Load(import) all data',
        entityType: 'ALL',
        entityId: 'empty',
        opType: 'SYNC_IMPORT',
        payload: recoveryBase(),
      },
    ];
    const source = await seed(ops);
    // Preserve the semantic requirement even if incidental row metadata was absent.
    await prisma.operation.updateMany({
      where: { userId: source.userId },
      data: { requiredCapabilities: [] },
    });
    await prisma.userSyncState.update({
      where: { userId: source.userId },
      data: { requiredCapabilities: [] },
    });
    expect(recovered(source.userId, source.seq).appDataComplete).toEqual(recoveryBase());
    await prisma.userSyncState.update({
      where: { userId: source.userId },
      data: { requiredCapabilities: ['ROUTINES_V1'] },
    });
    await prisma.operation.deleteMany({
      where: { userId: source.userId, serverSeq: { lt: source.seq } },
    });
    expect(recovered(source.userId, source.seq).appDataComplete).toEqual(recoveryBase());
  });
  it('recovers a retained leading snapshot with a later encrypted tail', async () => {
    const source = await seed(routinesRecoveryFixture().ops.slice(0, 1));
    await prisma.operation.updateMany({
      where: { userId: source.userId, serverSeq: 1 },
      data: { serverSeq: 10 },
    });
    await prisma.operation.updateMany({
      where: { userId: source.userId, serverSeq: 2 },
      data: { serverSeq: 11 },
    });
    await prisma.userSyncState.update({
      where: { userId: source.userId },
      data: { lastSeq: 11 },
    });
    expect(
      recovered(source.userId, 11).appDataComplete.eventSeries.entities.daily,
    ).toEqual(recoverySeries('daily'));
  });
  it('retains an older plaintext snapshot before an encrypted Routines tail', async () => {
    const source = await seed(routinesRecoveryFixture().ops.slice(0, 1));
    await prisma.operation.updateMany({
      where: { userId: source.userId, serverSeq: 1 },
      data: { payload: recoveryBase(), isPayloadEncrypted: false },
    });
    expect(
      recovered(source.userId, source.seq).appDataComplete.eventSeries.entities.daily,
    ).toEqual(recoverySeries('daily'));
  });
  it('does not activate Routines when recovering an unactivated legacy snapshot', async () => {
    const source = await seed([]);
    await prisma.userSyncState.update({
      where: { userId: source.userId },
      data: { requiredCapabilities: [] },
    });
    const result = run(source.userId, source.seq);
    expect(result.status, result.stderr).toBe(0);
    const backup = JSON.parse(readFileSync(result.out, 'utf8'));
    expect(backup.appDataComplete).toEqual(recoveryBase());
    expect(backup.requiredCapabilities ?? []).not.toContain('ROUTINES_V1');
  });
  it.each(['missing', 'incorrect', 'tampered'] as const)(
    'fails safely with %s encryption credentials/payload',
    async (mode) => {
      const source = await seed(routinesRecoveryFixture().ops.slice(0, 1));
      if (mode === 'tampered') {
        const row = await prisma.operation.findFirstOrThrow({
          where: { userId: source.userId, serverSeq: 2 },
        });
        const ciphertext = Buffer.from(row.payload as string, 'base64');
        ciphertext[ciphertext.length - 1] ^= 1;
        await prisma.operation.update({
          where: { id: row.id },
          data: { payload: ciphertext.toString('base64') },
        });
      }
      refuses(
        source.userId,
        source.seq,
        mode === 'missing' ? 'no encryption key' : 'Decryption failed',
        mode === 'missing' ? '' : mode === 'incorrect' ? randomUUID() : password,
      );
    },
  );
  it.each([
    [
      'unknown action',
      recoveryOperation('[EventSeries] Unknown', 'EVENT_SERIES', 'series', {
        title: 'PRIVATE_RECOVERY_CONTENT',
      }),
    ],
    [
      'unknown batch',
      recoveryOperation(
        '[EventSeries] Add Event Series',
        'EVENT_SERIES',
        'series',
        { eventSeries: recoverySeries('series') },
        'BATCH',
      ),
    ],
    [
      'noncanonical identity',
      recoveryOperation(
        '[OccurrenceException] Set Occurrence Exception',
        'OCCURRENCE_EXCEPTION',
        'wrong',
        {
          occurrenceException: {
            id: 'wrong',
            seriesId: 'series',
            slot: 1,
            value: { kind: 'cancelled' },
            modified: 1,
          },
        },
      ),
    ],
    [
      'wrong entity routing',
      recoveryOperation(
        '[EventSeries] Add Event Series',
        'TASK',
        'series',
        { eventSeries: recoverySeries('series') },
        'CRT',
      ),
    ],
    [
      'malformed schedule',
      recoveryOperation('[EventSeries] Replace Schedule Plan', 'EVENT_SERIES', 'series', {
        id: 'series',
        plan: { title: 'bad', segments: [] },
        modified: 1,
      }),
    ],
  ])('refuses %s without partial success', async (_name, operation) => {
    const source = await seed([operation as RecoveryFixtureOperation]);
    refuses(source.userId, source.seq, 'RECOVERY_INVALID_ROUTINES_OPERATION');
  });
  it('refuses immutable template ownership changes in compensation', async () => {
    const series = recoverySeries('owned', 'weekly', 'owner');
    const lww = recoveryOperation(
      '[EVENT_SERIES] LWW Update',
      'EVENT_SERIES',
      series.id,
      { ...series, templateId: 'other', modified: 2 },
    );
    lww.payload['lwwUpdateMode'] = 'replace';
    const source = await seed([
      recoveryOperation(
        '[EventSeries] Add Event Series',
        'EVENT_SERIES',
        series.id,
        { eventSeries: series },
        'CRT',
      ),
      lww,
    ]);
    refuses(source.userId, source.seq, 'RECOVERY_INVALID_ROUTINES_OPERATION');
  });
  it.each([
    'future schema',
    'invalid causal base',
    'markerless repair',
    'invalid snapshot',
    'unsupported batch footprint',
    'invalid JSON',
    'array snapshot',
    'uppercase Routines snapshot',
    'misrouted full state',
    'unknown envelope fields',
    'nonempty entity changes',
    'Routines old schema',
    'unknown operation vocabulary',
  ] as const)('refuses %s', async (mode) => {
    const operation = recoveryOperation(
      '[WeeklyTemplate] Add Weekly Template',
      'WEEKLY_TEMPLATE',
      'parent',
      { weeklyTemplate: recoveryTemplate('parent') },
      'CRT',
    );
    const source = await seed([operation]);
    if (mode === 'future schema')
      await prisma.operation.updateMany({
        where: { userId: source.userId, serverSeq: 2 },
        data: { schemaVersion: 6 },
      });
    if (mode === 'Routines old schema')
      await prisma.operation.updateMany({
        where: { userId: source.userId, serverSeq: 2 },
        data: { schemaVersion: 4 },
      });
    if (mode === 'unknown operation vocabulary')
      await prisma.operation.updateMany({
        where: { userId: source.userId, serverSeq: 2 },
        data: { opType: 'UNKNOWN' },
      });
    if (mode === 'misrouted full state')
      await prisma.operation.updateMany({
        where: { userId: source.userId, serverSeq: 2 },
        data: { opType: 'SYNC_IMPORT' },
      });
    if (mode === 'unknown envelope fields' || mode === 'nonempty entity changes') {
      const payload = {
        ...operation.payload,
        ...(mode === 'unknown envelope fields'
          ? { unknown: 'PRIVATE_RECOVERY_CONTENT' }
          : {
              entityChanges: [{ entityType: 'TASK', entityId: 'other', opType: 'DEL' }],
            }),
      };
      const [cipher] = await encryptBatch([JSON.stringify(payload)], password);
      await prisma.operation.updateMany({
        where: { userId: source.userId, serverSeq: 2 },
        data: { payload: cipher },
      });
    }
    if (mode === 'unsupported batch footprint')
      await prisma.operation.updateMany({
        where: { userId: source.userId, serverSeq: 2 },
        data: { entityIds: ['parent', 'other'] },
      });
    if (mode === 'invalid causal base' || mode === 'markerless repair')
      await prisma.operation.updateMany({
        where: { userId: source.userId, serverSeq: 2 },
        data: {
          opType: 'REPAIR',
          entityType: 'ALL',
          repairBaseServerSeq: mode === 'invalid causal base' ? 2 : null,
        },
      });
    if (
      mode === 'invalid snapshot' ||
      mode === 'invalid JSON' ||
      mode === 'array snapshot' ||
      mode === 'uppercase Routines snapshot'
    ) {
      const [cipher] = await encryptBatch(
        [
          mode === 'invalid JSON'
            ? 'PRIVATE_RECOVERY_CONTENT invalid JSON'
            : mode === 'array snapshot'
              ? '[]'
              : mode === 'uppercase Routines snapshot'
                ? JSON.stringify({
                    ...recoveryBase(),
                    EVENT_SERIES: { series: recoverySeries('series') },
                  })
                : JSON.stringify({
                    ...recoveryBase(),
                    eventSeries: { ids: ['missing'], entities: {} },
                  }),
        ],
        password,
      );
      await prisma.operation.updateMany({
        where: { userId: source.userId, serverSeq: 1 },
        data: { payload: cipher },
      });
    }
    refuses(source.userId, source.seq);
  });
  it.each(['leading', 'internal', 'trailing'] as const)(
    'refuses a %s operation gap',
    async (mode) => {
      const source = await seed(routinesRecoveryFixture().ops.slice(0, 3));
      await prisma.operation.deleteMany({
        where: {
          userId: source.userId,
          serverSeq: mode === 'leading' ? 1 : mode === 'internal' ? 3 : source.seq,
        },
      });
      refuses(source.userId, source.seq);
    },
  );
  it('keeps Folder tails explicitly unsupported', async () => {
    const source = await seed([
      recoveryOperation(
        '[Folder] Add Folder',
        'FOLDER',
        'new',
        { folder: { id: 'new', title: 'New', parentId: null } },
        'CRT',
      ),
    ]);
    refuses(source.userId, source.seq, 'FOLDER_REPLAY_UNSUPPORTED');
  });
});
