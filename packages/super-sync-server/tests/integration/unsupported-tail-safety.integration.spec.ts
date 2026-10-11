import '@angular/compiler';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptBatch } from '@sp/sync-core';
import { prisma } from '../../src/db';
import {
  recoveryBase,
  type RecoveryFixtureOperation as BaseRecoveryOperation,
} from '../fixtures/routines-recovery.fixture';
import { WorkContextType } from '../../../../src/app/features/work-context/work-context.model';

type RecoveryFixtureOperation = BaseRecoveryOperation & { entityIds?: string[] };

require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const { TaskSharedActions } =
  require('../../../../src/app/root-store/meta/task-shared.actions') as typeof import('../../../../src/app/root-store/meta/task-shared.actions');
const { DEFAULT_TASK } =
  require('../../../../src/app/features/tasks/task.model') as typeof import('../../../../src/app/features/tasks/task.model');
const eventActions =
  require('../../../../src/app/features/event/store/event.actions') as typeof import('../../../../src/app/features/event/store/event.actions');
const { setPlacement } =
  require('../../../../src/app/features/planning/store/planning.actions') as typeof import('../../../../src/app/features/planning/store/planning.actions');
const { planningReducer } =
  require('../../../../src/app/features/planning/store/planning.reducer') as typeof import('../../../../src/app/features/planning/store/planning.reducer');

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;
describeWithDb(
  'encrypted operator recovery refuses unauthoritative generic tails',
  () => {
    const password = randomBytes(32).toString('base64url');
    const users: number[] = [];
    let directory: string;
    beforeAll(() => {
      directory = mkdtempSync(join(tmpdir(), 'unsupported-tail-'));
    });
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith('unsupported-tail-')
      )
        throw new Error('Unsafe diagnostic cleanup path');
      rmSync(directory, { recursive: true, force: true });
    });
    const task = {
      ...DEFAULT_TASK,
      id: 'task',
      title: 'PRIVATE_TAIL_CONTENT',
      created: 1,
      modified: 1,
      projectId: 'project',
      folderId: 'folder',
    };
    const state = () => ({
      ...recoveryBase(),
      task: { ids: [task.id], entities: { [task.id]: task } },
      project: {
        ids: ['project'],
        entities: { project: { id: 'project', taskIds: [task.id], backlogTaskIds: [] } },
      },
      workSession: { ids: [], entities: {} },
    });
    const placement = {
      id: task.id,
      placement: { target: { type: 'DAY' as const, key: '2026-10-11' }, orderKey: 'V' },
      revision: { counter: 1, clientId: 'source', opId: 'planning-op' },
    };
    const snapshot = (value = state()): RecoveryFixtureOperation => ({
      actionType: '[SP_ALL] Load(import) all data',
      entityType: 'ALL',
      entityId: 'snapshot',
      opType: 'BACKUP_IMPORT',
      payload: { appDataComplete: value },
    });
    const captured = <
      A extends {
        type: string;
        meta: {
          entityType: string;
          opType: string;
          entityId?: string;
          entityIds?: string[];
        };
      },
    >(
      action: A,
    ): RecoveryFixtureOperation => {
      const { type, meta, ...body } = action;
      return {
        actionType: type,
        entityType: meta.entityType,
        entityId: meta.entityId ?? meta.entityIds?.[0] ?? '',
        entityIds: meta.entityIds,
        opType: meta.opType,
        payload: { actionPayload: body, entityChanges: [] },
      };
    };
    const run = async (ops: RecoveryFixtureOperation[], corrupt = false) => {
      const user = await prisma.user.create({
        data: { email: `tail-${randomUUID()}@test.local`, isVerified: 1 },
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
      for (const [i, op] of ops.entries())
        await prisma.operation.create({
          data: {
            id:
              op.actionType === setPlacement.type
                ? placement.revision.opId
                : randomUUID(),
            userId: user.id,
            clientId: 'source',
            serverSeq: i + 1,
            actionType: op.actionType,
            entityType: op.entityType,
            entityId: op.entityId ?? null,
            entityIds: op.entityIds ?? [],
            opType: op.opType,
            payload:
              corrupt && i === ops.length - 1
                ? encrypted[i].slice(0, -8) + 'AAAAAAAA'
                : encrypted[i],
            vectorClock: { source: i + 1 },
            schemaVersion: 5,
            clientTimestamp: BigInt(i + 1),
            receivedAt: BigInt(i + 1),
            isPayloadEncrypted: true,
          },
        });
      const out = join(directory, `${user.id}.json`);
      const result = spawnSync(
        process.execPath,
        [
          resolve('../../node_modules/ts-node/dist/bin.js'),
          '--transpile-only',
          'scripts/recover-user.ts',
          '--user',
          String(user.id),
          '--target-seq',
          String(ops.length),
          '--out',
          out,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, RECOVER_ENCRYPT_KEY: password },
          encoding: 'utf8',
          timeout: 30000,
        },
      );
      expect(result.stdout + result.stderr).not.toContain(password);
      expect(result.stdout + result.stderr).not.toContain('PRIVATE_TAIL_CONTENT');
      return { ...result, out };
    };
    const add = TaskSharedActions.addTask({
      task: { ...task, id: 'new-task' },
      initialPlanning: { ...placement, id: 'new-task' },
      workContextId: 'project',
      workContextType: WorkContextType.PROJECT,
      isAddToBacklog: false,
      isAddToBottom: false,
    });
    const event = {
      id: 'new-event',
      title: 'PRIVATE_TAIL_CONTENT',
      isAllDay: true as const,
      date: '2026-10-11',
      created: 1,
      modified: 1,
    };
    it.each([
      ['Task create with initial Planning', captured(add)],
      [
        'Task delete with project references',
        captured(TaskSharedActions.deleteTasks({ taskIds: [task.id], tasks: [task] })),
      ],
      [
        'Task edit',
        captured(
          TaskSharedActions.updateTask({
            task: {
              id: task.id,
              changes: { title: 'PRIVATE_TAIL_CONTENT', modified: 2 },
            },
          }),
        ),
      ],
      ['one-off Event create', captured(eventActions.addEvent({ event }))],
      [
        'one-off Event edit',
        captured(
          eventActions.updateEvent({
            id: 'event',
            changes: {
              title: 'PRIVATE_TAIL_CONTENT',
              isAllDay: true,
              date: '2026-10-12',
            },
            modified: 2,
          }),
        ),
      ],
      ['one-off Event delete', captured(eventActions.removeEvent({ id: 'event' }))],
      [
        'Task patch compensation',
        {
          actionType: '[TASK] LWW Update',
          entityType: 'TASK',
          entityId: task.id,
          opType: 'UPD',
          payload: {
            actionPayload: { id: task.id, title: 'PRIVATE_TAIL_CONTENT' },
            entityChanges: [],
            lwwUpdateMode: 'patch',
            clearedFields: ['notes'],
          },
        },
      ],
      [
        'unknown action in a known generic family',
        {
          actionType: '[Note] Unknown',
          entityType: 'NOTE',
          entityId: 'note',
          opType: 'UPD',
          payload: { actionPayload: { id: 'note' }, entityChanges: [] },
        },
      ],
      [
        'unknown action using the Planning vocabulary',
        {
          actionType: '[Planning] Unknown',
          entityType: 'PLANNING',
          entityId: task.id,
          opType: 'PLANNING_V1',
          payload: { actionPayload: { record: placement }, entityChanges: [] },
        },
      ],
    ] satisfies Array<[string, RecoveryFixtureOperation]>)(
      'refuses %s instead of writing an incomplete backup',
      async (_name, tail) => {
        const result = await run([snapshot(), tail]);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('RECOVERY_UNSUPPORTED_OPERATION at sequence 2');
        expect(existsSync(result.out)).toBe(false);
      },
    );
    it('does not skip an unsupported covered prefix just because a later snapshot exists', async () => {
      const result = await run([snapshot(), captured(add), snapshot()]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('RECOVERY_UNSUPPORTED_OPERATION at sequence 2');
      expect(existsSync(result.out)).toBe(false);
    });
    it('preserves the existing shared Planning replay and durable capability floor', async () => {
      const before = state(),
        action = setPlacement({ record: placement });
      const expected = planningReducer(before.planning, action);
      const result = await run([snapshot(before), captured(action)]);
      expect(result.status, result.stderr).toBe(0);
      const backup = JSON.parse(readFileSync(result.out, 'utf8'));
      expect(backup.appDataComplete).toEqual({ ...before, planning: expected });
      expect(backup.requiredCapabilities).toContain('ROUTINES_V1');
    });
    it('still rejects authenticated-ciphertext tampering without output', async () => {
      const result = await run([snapshot(), captured(add)], true);
      expect(result.status).not.toBe(0);
      expect(existsSync(result.out)).toBe(false);
    });
  },
);
