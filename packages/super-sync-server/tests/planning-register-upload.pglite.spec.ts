import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compareVectorClocks } from '@sp/sync-core';
import { OperationUploadService } from '../src/sync/services/operation-upload.service';
import { ValidationService } from '../src/sync/services/validation.service';
import { DEFAULT_SYNC_CONFIG, type Operation } from '../src/sync/sync.types';

/** Actual upload/validation/conflict SQL and writes against in-process PostgreSQL.
 * The adapter translates Prisma model calls only; it does not emulate conflict decisions.
 * PGlite has one connection, so this does not claim to reproduce two-session races.
 */
describe('Planning register admission (PGlite)', () => {
  let db: PGlite;
  const uploader = new OperationUploadService(new ValidationService(DEFAULT_SYNC_CONFIG));
  const operation = (
    id: string,
    clientId: string,
    vectorClock: Operation['vectorClock'],
  ): Operation => ({
    id,
    clientId,
    vectorClock,
    timestamp: 1000,
    schemaVersion: 5,
    actionType: '[Planning] Set Placement',
    opType: 'PLANNING_V1',
    entityType: 'PLANNING',
    entityId: 'X',
    payload: {
      actionPayload: {
        record: {
          id: 'X',
          placement: {
            target: { type: 'DAY', key: '2026-10-08' },
            orderKey: clientId === 'A' ? 'F' : 'T',
          },
          revision: { counter: 1, clientId, opId: id },
        },
      },
      entityChanges: [],
    },
  });
  const adapter = (sql: Pick<PGlite, 'query'>): Prisma.TransactionClient =>
    ({
      $queryRaw: async (
        strings: TemplateStringsArray | Prisma.Sql,
        ...values: Prisma.Sql['values']
      ) => {
        const query = Array.isArray(strings)
          ? Prisma.sql(strings as TemplateStringsArray, ...values)
          : (strings as Prisma.Sql);
        return (await sql.query(query.text, query.values)).rows;
      },
      operation: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          (await sql.query('SELECT * FROM operations WHERE id=$1', [where.id])).rows[0] ??
          null,
        findFirst: async ({
          where,
        }: {
          where: { userId: number; entityType: string; entityId: string };
        }) =>
          (
            await sql.query(
              `SELECT action_type AS "actionType", client_id AS "clientId",
          vector_clock AS "vectorClock", server_seq AS "serverSeq" FROM operations
          WHERE user_id=$1 AND entity_type=$2 AND entity_id=$3 ORDER BY server_seq DESC LIMIT 1`,
              [where.userId, where.entityType, where.entityId],
            )
          ).rows[0] ?? null,
        createMany: async ({
          data,
        }: {
          data: Array<{
            id: string;
            userId: number;
            clientId: string;
            serverSeq: number;
            actionType: string;
            opType: string;
            entityType: string;
            entityId: string;
            entityIds: string[];
            vectorClock: unknown;
            payload: unknown;
            clientTimestamp: bigint;
            schemaVersion: number;
          }>;
        }) => {
          let count = 0;
          for (const row of data) {
            const result = await sql.query(
              `INSERT INTO operations
            (id,user_id,client_id,server_seq,action_type,op_type,entity_type,entity_id,entity_ids,
             vector_clock,payload,client_timestamp,schema_version)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING id`,
              [
                row.id,
                row.userId,
                row.clientId,
                row.serverSeq,
                row.actionType,
                row.opType,
                row.entityType,
                row.entityId,
                row.entityIds,
                JSON.stringify(row.vectorClock),
                JSON.stringify(row.payload),
                row.clientTimestamp.toString(),
                row.schemaVersion,
              ],
            );
            count += result.rows.length;
          }
          return { count };
        },
      },
      userSyncState: {
        update: async ({
          where,
          data,
        }: {
          where: { userId: number };
          data: { lastSeq: { increment: number } };
        }) =>
          (
            await sql.query(
              'UPDATE user_sync_state SET last_seq=last_seq+$1 WHERE user_id=$2 RETURNING last_seq AS "lastSeq"',
              [data.lastSeq.increment, where.userId],
            )
          ).rows[0],
      },
    }) as unknown as Prisma.TransactionClient;
  const request = (ops: Operation[], clientId = ops[0].clientId) =>
    db.transaction(async (sql) => {
      await sql.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const tx = adapter(sql);
      const results = [];
      // Production SyncService awaits processOperation for each row on the same tx;
      // each createMany is complete before the next conflict lookup.
      for (const op of ops)
        results.push((await uploader.processOperation(1, clientId, op, 2000, tx)).result);
      return results;
    });
  const rows = () =>
    db.query<{ id: string; server_seq: number; vector_clock: Operation['vectorClock'] }>(
      'SELECT id,server_seq,vector_clock FROM operations ORDER BY server_seq',
    );
  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`CREATE TABLE operations (
      id text PRIMARY KEY, user_id integer NOT NULL, client_id text NOT NULL,
      server_seq integer NOT NULL, action_type text NOT NULL, op_type text NOT NULL,
      entity_type text NOT NULL, entity_id text, entity_ids text[] NOT NULL DEFAULT '{}',
      vector_clock jsonb NOT NULL, payload jsonb NOT NULL, client_timestamp bigint NOT NULL,
      schema_version integer NOT NULL, repair_base_server_seq integer,
      UNIQUE(user_id,server_seq));
      CREATE TABLE user_sync_state(user_id integer PRIMARY KEY,last_seq integer NOT NULL);`);
  });
  beforeEach(async () => {
    await db.exec(
      'TRUNCATE operations,user_sync_state; INSERT INTO user_sync_state VALUES(1,0)',
    );
  });
  afterAll(async () => {
    await db.close();
  });

  for (const order of [
    ['A', 'B'],
    ['B', 'A'],
  ]) {
    it('accepts concurrent Planning originals in order ' + order.join(','), async () => {
      const first = operation('register-' + order[0], order[0], { [order[0]]: 1 });
      const second = operation('register-' + order[1], order[1], { [order[1]]: 1 });
      expect((await request([first]))[0]).toMatchObject({ accepted: true, serverSeq: 1 });
      expect((await request([second]))[0]).toMatchObject({
        accepted: true,
        serverSeq: 2,
      });
      expect((await rows()).rows).toHaveLength(2);
    });
  }
  it('accepts superseded Planning clocks while the record merge governs semantics', async () => {
    await request([operation('newer', 'A', { A: 2 })]);
    expect((await request([operation('older', 'A', { A: 1 })]))[0]).toMatchObject({
      accepted: true,
    });
  });
  it('keeps the equivalent ordinary TASK conflict behavior unchanged', async () => {
    const task = (id: string, clientId: string) =>
      ({
        ...operation(id, clientId, { [clientId]: 1 }),
        entityType: 'TASK',
        opType: 'UPD',
        actionType: '[Task] Update',
        payload: {
          actionPayload: { task: { id: 'X', changes: { isDone: true } } },
          entityChanges: [],
        },
      }) as Operation;
    expect((await request([task('task-a', 'A')]))[0]).toMatchObject({ accepted: true });
    expect((await request([task('task-b', 'B')]))[0]).toMatchObject({
      accepted: false,
      errorCode: 'CONFLICT_CONCURRENT',
    });
    expect((await rows()).rows).toHaveLength(1);
  });
  it('rejects malformed Planning revisions and mismatched envelope IDs', async () => {
    for (const counter of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const op = operation('malformed-' + counter, 'A', { A: 1 });
      (
        op.payload as { actionPayload: { record: { revision: { counter: number } } } }
      ).actionPayload.record.revision.counter = counter;
      expect((await request([op]))[0]).toMatchObject({
        accepted: false,
        errorCode: 'INVALID_PAYLOAD',
      });
    }
    const op = operation('mismatch', 'A', { A: 1 });
    (
      op.payload as { actionPayload: { record: { revision: { opId: string } } } }
    ).actionPayload.record.revision.opId = 'other';
    expect((await request([op]))[0]).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_PAYLOAD',
    });
    expect((await rows()).rows).toHaveLength(0);
  });
});
