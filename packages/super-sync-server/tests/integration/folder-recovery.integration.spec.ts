import '@angular/compiler';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { encryptBatch } from '@sp/sync-core';
import { prisma } from '../../src/db';
import {
  recoveryBase,
  routinesRecoveryFixture,
  recoveryOperation,
  type RecoveryFixtureOperation,
} from '../fixtures/routines-recovery.fixture';
// Match the real operator's source preference, never load ignored emitted JS.
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const { folderReducer, initialFolderState } =
  require('../../../../src/app/features/folder/store/folder.reducer') as typeof import('../../../../src/app/features/folder/store/folder.reducer');
const folderActions =
  require('../../../../src/app/features/folder/store/folder.actions') as typeof import('../../../../src/app/features/folder/store/folder.actions');
const { workSessionReducer } =
  require('../../../../src/app/features/work-session/store/work-session.reducer') as typeof import('../../../../src/app/features/work-session/store/work-session.reducer');
const workActions =
  require('../../../../src/app/features/work-session/store/work-session.actions') as typeof import('../../../../src/app/features/work-session/store/work-session.actions');

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;
describeWithDb(
  'encrypted Folder operator recovery with authoritative client snapshots',
  () => {
    const password = randomBytes(32).toString('base64url');
    const users: number[] = [];
    let directory: string;
    beforeAll(() => {
      directory = mkdtempSync(join(tmpdir(), 'folder-recovery-'));
    });
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith('folder-recovery-')
      )
        throw new Error('Unsafe recovery cleanup path');
      rmSync(directory, { recursive: true, force: true });
    });
    const snapshot = (
      state: Record<string, unknown>,
      opType = 'BACKUP_IMPORT',
      repairBaseServerSeq?: number,
    ): RecoveryFixtureOperation => ({
      actionType: '[SP_ALL] Load(import) all data',
      entityType: 'ALL',
      entityId: 'snapshot',
      opType,
      payload: { appDataComplete: state },
      repairBaseServerSeq,
    });
    const base = () => ({
      ...recoveryBase(),
      folder: structuredClone(initialFolderState),
    });
    const fixture = () => {
      const initial = base();
      let folder = initial.folder;
      const ops: RecoveryFixtureOperation[] = [];
      const apply = (
        action: Omit<ReturnType<typeof folderActions.addFolder>, 'type'> & {
          type: string;
        },
      ) => {
        const { type, meta, ...body } = action;
        expect(meta.isPersistent).toBe(true);
        folder = folderReducer(folder, action);
        ops.push(recoveryOperation(type, 'FOLDER', '*', body));
      };
      apply(
        folderActions.addFolder({
          state: folder,
          folder: { id: 'parent', title: 'Parent' },
        }),
      );
      apply(
        folderActions.addFolder({
          state: folder,
          folder: { id: 'child', title: 'Child' },
        }),
      );
      apply(
        folderActions.updateFolder({
          state: folder,
          id: 'child',
          changes: { title: 'PRIVATE_FOLDER_CONTENT' },
        }),
      );
      apply(
        folderActions.moveFolder({
          state: folder,
          id: 'child',
          parentId: 'parent',
          orderKey: 'W',
        }),
      );
      apply(
        folderActions.addFolder({
          state: folder,
          folder: { id: 'temporary', title: 'Remove me' },
        }),
      );
      apply(folderActions.removeFolder({ state: folder, id: 'temporary' }));
      // Actual singleton compensation carries the complete winning state.
      const compensation = recoveryOperation(
        '[FOLDER] LWW Update',
        'FOLDER',
        '*',
        folder as unknown as Record<string, unknown>,
      );
      compensation.payload['lwwUpdateMode'] = 'replace';
      ops.push(compensation, structuredClone(compensation));
      return { initial, ops, final: { ...initial, folder } };
    };
    const seed = async (ops: RecoveryFixtureOperation[]) => {
      const user = await prisma.user.create({
        data: { email: `folder-${randomUUID()}@test.local`, isVerified: 1 },
      });
      users.push(user.id);
      await prisma.userSyncState.create({
        data: {
          userId: user.id,
          lastSeq: ops.length,
          requiredCapabilities: ['ROUTINES_V1'],
        },
      });
      const encrypted = await encryptBatch(
        ops.map((op) => JSON.stringify(op.payload)),
        password,
      );
      for (const [index, op] of ops.entries())
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
            schemaVersion: 5,
            repairBaseServerSeq: op.repairBaseServerSeq,
            clientTimestamp: BigInt(index + 1),
            receivedAt: BigInt(index + 1),
            isPayloadEncrypted: true,
            requiredCapabilities: [
              'EVENT_SERIES',
              'WEEKLY_TEMPLATE',
              'OCCURRENCE_EXCEPTION',
            ].includes(op.entityType)
              ? ['ROUTINES_V1']
              : [],
          },
        });
      return { userId: user.id, seq: ops.length };
    };
    const run = (userId: number, seq: number) => {
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
          env: { ...process.env, RECOVER_ENCRYPT_KEY: password },
          encoding: 'utf8',
          timeout: 60000,
        },
      );
      expect(result.stdout + result.stderr).not.toContain(password);
      expect(result.stdout + result.stderr).not.toContain('PRIVATE_FOLDER_CONTENT');
      return { ...result, out };
    };
    const recovered = (source: { userId: number; seq: number }, expected: unknown) => {
      const result = run(source.userId, source.seq);
      expect(result.status, result.stderr).toBe(0);
      const backup = JSON.parse(readFileSync(result.out, 'utf8'));
      expect(backup.appDataComplete).toEqual(expected);
      expect(backup.requiredCapabilities).toContain('ROUTINES_V1');
      if ((expected as { folder: { ids: string[] } }).folder.ids.length > 1)
        expect(backup.requiredEntityTypes).toContain('FOLDER');
      return backup;
    };
    it('accepts covered Folder history before a later complete snapshot', async () => {
      const f = fixture();
      recovered(await seed([snapshot(f.initial), ...f.ops, snapshot(f.final)]), f.final);
    });
    it('replays actual create/update/move/delete and complete compensation tails', async () => {
      const f = fixture();
      recovered(await seed([snapshot(f.initial), ...f.ops]), f.final);
      expect(f.final.folder.entities.child).toEqual({
        id: 'child',
        title: 'PRIVATE_FOLDER_CONTENT',
        parentId: 'parent',
        orderKey: 'W',
      });
      expect(f.final.folder.entities.temporary).toBeUndefined();
    });
    it('interleaves Folder, Task, WorkSession, exceptions, templates and terminal Routines tombstones', async () => {
      const f = fixture(),
        routines = routinesRecoveryFixture();
      const task = {
        id: 'new-task',
        title: 'New task',
        subTaskIds: [],
        tagIds: [],
        folderId: 'child',
      };
      const add = workActions.addWorkSession({
        workSession: {
          id: 'new-work',
          taskId: task.id,
          start: 1000,
          end: 2000,
          timeZone: 'UTC',
          created: 10,
          modified: 10,
        },
      });
      const complete = workActions.completeWorkSession({
        id: 'new-work',
        completedAt: 2000,
        modified: 20,
      });
      const work = workSessionReducer(
        workSessionReducer(f.initial.workSession, add),
        complete,
      );
      const capturedWork = [add, complete].map(({ type, meta, ...body }) =>
        recoveryOperation(type, 'WORK_SESSION', meta.entityId, body, meta.opType),
      );
      const interleaved = routines.ops.flatMap((op, index) =>
        index < f.ops.length ? [f.ops[index], op] : [op],
      );
      const expected = {
        ...f.final,
        eventSeries: routines.expected.eventSeries,
        occurrenceException: routines.expected.occurrenceException,
        weeklyTemplate: routines.expected.weeklyTemplate,
        task: {
          ...f.initial.task,
          ids: ['new-task', 'task'],
          entities: { ...f.initial.task.entities, [task.id]: task },
        },
        workSession: work,
      };
      recovered(
        await seed([
          snapshot(f.initial),
          recoveryOperation('[Task Shared] addTask', 'TASK', task.id, { task }, 'CRT'),
          ...interleaved,
          ...capturedWork,
        ]),
        expected,
      );
      expect(task.folderId).toBe('child');
      expect(
        Object.keys(expected).some((key) =>
          ['FOLDER', 'TASK', 'WORK_SESSION', 'EVENT_SERIES'].includes(key),
        ),
      ).toBe(false);
    });
    it('validates multiple replacement boundaries including a causal REPAIR and its Folder tail', async () => {
      const f = fixture();
      const prefix = [snapshot(f.initial), ...f.ops, snapshot(f.final, 'SYNC_IMPORT')];
      const repaired = {
        ...f.final,
        task: { ...f.final.task, ids: [], entities: {} },
        workSession: { ids: [], entities: {} },
      };
      const changed = folderActions.updateFolder({
        state: f.final.folder,
        id: 'parent',
        changes: { title: 'After repair' },
      });
      const { type, meta: _meta, ...body } = changed;
      recovered(
        await seed([
          ...prefix,
          snapshot(repaired, 'REPAIR', prefix.length),
          recoveryOperation(type, 'FOLDER', '*', body),
        ]),
        { ...repaired, folder: changed.folderState },
      );
    });
    it('recovers complete snapshots and activated-empty replacement state without inventing entities', async () => {
      const f = fixture();
      recovered(await seed([snapshot(f.final)]), f.final);
      const empty = base();
      recovered(
        await seed([snapshot(f.initial), ...f.ops, snapshot(empty, 'SYNC_IMPORT')]),
        empty,
      );
    });
    it('retains activation from an authenticated earlier snapshot even without row or account requirements', async () => {
      const f = fixture(),
        routines = routinesRecoveryFixture();
      const active = {
        ...f.initial,
        eventSeries: routines.expected.eventSeries,
        occurrenceException: routines.expected.occurrenceException,
        weeklyTemplate: routines.expected.weeklyTemplate,
      };
      const source = await seed([snapshot(active), snapshot(f.initial, 'SYNC_IMPORT')]);
      await prisma.userSyncState.update({
        where: { userId: source.userId },
        data: { requiredCapabilities: [] },
      });
      recovered(source, f.initial);
    });
    it.each([
      'missing final',
      'internal gap',
      'partial snapshot',
      'missing Folder snapshot',
      'corrupt folder boundary',
      'stale causal boundary',
      'markerless repair',
      'unknown Folder action',
      'batch Folder',
      'wrong identity',
      'partial compensation',
      'nonempty footprint',
      'malformed covered prefix',
      'unknown WorkSession action',
      'malformed WorkSession update',
      'unknown WorkSession changes on absent record',
      'unhandled generic Task format',
    ] as const)('refuses %s with no output', async (mode) => {
      const f = fixture();
      const ops = [snapshot(f.initial), f.ops[0], snapshot(f.final)];
      if (mode === 'partial snapshot')
        delete (ops[2].payload['appDataComplete'] as Record<string, unknown>)[
          'workSession'
        ];
      if (mode === 'missing Folder snapshot')
        delete (ops[2].payload['appDataComplete'] as Record<string, unknown>)['folder'];
      if (
        mode === 'unknown WorkSession action' ||
        mode === 'malformed WorkSession update'
      )
        ops[1] = recoveryOperation(
          mode === 'unknown WorkSession action'
            ? '[WorkSession] Unknown'
            : '[WorkSession] Update WorkSession',
          'WORK_SESSION',
          'absent',
          { id: 'absent', modified: 'bad', changes: {} },
        );
      if (mode === 'unhandled generic Task format')
        ops.push(
          recoveryOperation('[Task] Unknown', 'TASK', 'task', {
            title: 'PRIVATE_FOLDER_CONTENT',
          }),
        );
      if (mode === 'unknown WorkSession changes on absent record')
        ops[1] = recoveryOperation(
          '[WorkSession] Update WorkSession',
          'WORK_SESSION',
          'absent',
          { id: 'absent', modified: 1, changes: { unknown: true } },
        );
      if (mode === 'corrupt folder boundary')
        (ops[2].payload['appDataComplete'] as Record<string, unknown>)['folder'] = {
          ids: ['missing'],
          entities: {},
        };
      if (mode === 'stale causal boundary' || mode === 'markerless repair') {
        ops[2].opType = 'REPAIR';
        ops[2].repairBaseServerSeq = mode === 'stale causal boundary' ? 1 : undefined;
      }
      if (mode === 'unknown Folder action') ops[1].actionType = '[Folder] Unknown';
      if (mode === 'batch Folder') ops[1].opType = 'BATCH';
      if (mode === 'wrong identity') ops[1].entityId = 'not-singleton';
      if (mode === 'partial compensation') {
        ops[1].actionType = '[FOLDER] LWW Update';
        ops[1].payload = {
          actionPayload: { ids: [] },
          entityChanges: [],
          lwwUpdateMode: 'replace',
        };
      }
      if (mode === 'nonempty footprint')
        ops[1].payload['entityChanges'] = [
          { entityType: 'TASK', entityId: 'task', opType: 'DEL' },
        ];
      if (mode === 'malformed covered prefix')
        ops[1].payload = { actionPayload: { folderState: {} }, entityChanges: [] };
      const source = await seed(ops);
      if (mode === 'missing final' || mode === 'internal gap')
        await prisma.operation.deleteMany({
          where: {
            userId: source.userId,
            serverSeq: mode === 'missing final' ? source.seq : 2,
          },
        });
      const result = run(source.userId, source.seq);
      expect(result.status).not.toBe(0);
      expect(existsSync(result.out)).toBe(false);
    });
  },
);
