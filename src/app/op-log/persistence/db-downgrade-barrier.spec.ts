import { TestBed } from '@angular/core/testing';
import { IDBPDatabase, openDB } from 'idb';
import { ClientIdService } from '../../core/util/client-id.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import { ArchiveStoreService } from './archive-store.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { DB_NAME, DB_VERSION, STORE_NAMES } from './db-keys.const';
import { runDbUpgrade } from './db-upgrade';

// src/test.ts supplies a fresh in-memory IDBFactory for every spec. No personal
// databases are opened. Freeze the V1.1 schema here independently of the current
// upgrade callback so a destructive migration cannot also rewrite the fixture.
const openV11Fixture = (): Promise<IDBPDatabase> =>
  openDB(DB_NAME, 11, {
    upgrade: (db) => {
      const ops = db.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true });
      ops.createIndex('byId', 'op.id', { unique: true });
      ops.createIndex('bySyncedAt', 'syncedAt');
      ops.createIndex('bySourceAndStatus', ['source', 'applicationStatus']);
      for (const name of [
        'state_cache',
        'import_backup',
        'archive_young',
        'archive_old',
      ]) {
        db.createObjectStore(name, { keyPath: 'id' });
      }
      for (const name of ['vector_clock', 'client_id', 'meta']) {
        db.createObjectStore(name);
      }
    },
  });

const CLIENT_ID = 'B_disposable_v11_fixture';
const CLOCK = { [CLIENT_ID]: 7, remote: 3 };
const STATE = {
  task: { ids: ['task1'], entities: { task1: { id: 'task1', title: 'Fixture task' } } },
};
const SNAPSHOT = {
  id: 'current',
  state: STATE,
  lastAppliedOpSeq: 7,
  vectorClock: CLOCK,
  compactedAt: 1000,
  schemaVersion: 3,
  compactionCounter: 2,
  snapshotEntityKeys: ['TASK:task1'],
};
const BACKUP = { backupId: 'recovery1', savedAt: 900, state: STATE };
const ARCHIVE = {
  task: { ids: ['archived1'], entities: { archived1: { id: 'archived1' } } },
  timeTracking: { project: {}, tag: {} },
};

const seedV11 = async (): Promise<void> => {
  const db = await openV11Fixture();
  try {
    const tx = db.transaction(Array.from(db.objectStoreNames), 'readwrite');
    // Compact and full-format rows, replay quarantine, pending archive work,
    // and sequence gaps are all existing V1.1 persistence features.
    await tx.objectStore('ops').put({
      seq: 7,
      op: {
        id: 'fixture-op7',
        a: 'HU',
        o: 'UPD',
        e: 'TASK',
        d: 'task1',
        p: { title: 'Fixture task' },
        c: CLIENT_ID,
        v: CLOCK,
        t: 1000,
        s: 3,
      },
      appliedAt: 1000,
      source: 'local',
    });
    await tx.objectStore('ops').put({
      seq: 12,
      op: {
        id: 'fixture-op12',
        actionType: '[Task Shared] updateTask',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 'task1',
        payload: { title: 'Pending archive' },
        clientId: 'remote',
        vectorClock: CLOCK,
        timestamp: 1100,
        schemaVersion: 3,
      },
      appliedAt: 1100,
      syncedAt: 1101,
      source: 'remote',
      applicationStatus: 'archive_pending',
    });
    await tx.objectStore('ops').put({
      seq: 15,
      op: {
        id: 'fixture-op15',
        a: 'HU',
        o: 'UPD',
        e: 'TASK',
        d: 'task1',
        p: { title: 'Quarantined update' },
        c: 'remote',
        v: CLOCK,
        t: 1200,
        s: 3,
      },
      source: 'remote',
      appliedAt: 1200,
      reducerRejectedAt: 1201,
      applicationStatus: 'failed',
      retryCount: 2,
    });
    // Delete the highest row to detect a reset of the auto-increment generator.
    await tx.objectStore('ops').put({ seq: 20, op: { id: 'deleted-op' } });
    await tx.objectStore('ops').delete(20);
    await tx.objectStore('state_cache').put(SNAPSHOT);
    await tx
      .objectStore('state_cache')
      .put({ ...SNAPSHOT, id: 'backup', compactedAt: 900 });
    await tx
      .objectStore('import_backup')
      .put({ id: 'current', backupId: 'recovery1', savedAt: 900 });
    await tx.objectStore('import_backup').put({ id: 'recovery1', ...BACKUP });
    await tx.objectStore('import_backup').put({
      id: 'ring',
      entries: [
        { backupId: 'recovery1', savedAt: 900, reason: 'FORCE_DOWNLOAD', taskCount: 1 },
      ],
    });
    await tx
      .objectStore('vector_clock')
      .put({ clock: CLOCK, lastUpdate: 1200 }, 'current');
    await tx.objectStore('client_id').put(CLIENT_ID, 'current');
    for (const name of ['archive_young', 'archive_old']) {
      await tx.objectStore(name).put({ id: 'current', data: ARCHIVE, lastModified: 900 });
    }
    await tx.objectStore('meta').put({ refs: [], latest: null }, 'full_state_ops');
    await tx
      .objectStore('meta')
      .put(
        { incomplete: true, startedAt: 1200, preservedLocalOps: [] },
        'raw_rebuild_incomplete',
      );
    await tx
      .objectStore('meta')
      .put(
        { backupId: 'recovery1', backupSavedAt: 900, completedAt: 1200 },
        'raw_rebuild_recovery',
      );
    await tx.done;
  } finally {
    db.close();
  }
};

// Compare every key, value, store property and index property, including data
// outside the active snapshot. The database version is asserted separately.
const readContents = async (db: IDBPDatabase): Promise<unknown[]> => {
  const tx = db.transaction(Array.from(db.objectStoreNames), 'readonly');
  const contents = await Promise.all(
    Array.from(db.objectStoreNames).map(async (name) => {
      const store = tx.objectStore(name);
      return {
        name,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes: Array.from(store.indexNames).map((indexName) => {
          const index = store.index(indexName);
          return {
            name: indexName,
            keyPath: index.keyPath,
            unique: index.unique,
            multiEntry: index.multiEntry,
          };
        }),
        keys: await store.getAllKeys(),
        values: await store.getAll(),
      };
    }),
  );
  await tx.done;
  return contents;
};

describe('V1.2 local downgrade barrier', () => {
  const configureServices = (): void => {
    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        ArchiveStoreService,
        ClientIdService,
        { provide: CLIENT_ID_PROVIDER, useExisting: ClientIdService },
      ],
    });
  };

  const closeServices = (): void => {
    for (const service of [
      TestBed.inject(OperationLogStoreService),
      TestBed.inject(ArchiveStoreService),
    ]) {
      (service as unknown as { _db?: IDBPDatabase })._db?.close();
    }
    (
      TestBed.inject(ClientIdService) as unknown as { _supOpsDb?: IDBPDatabase }
    )._supOpsDb?.close();
  };

  beforeEach(configureServices);
  afterEach(() => {
    closeServices();
  });

  const openers = [
    {
      name: 'operation log',
      open: () => TestBed.inject(OperationLogStoreService).init(),
    },
    {
      name: 'archives',
      open: () => TestBed.inject(ArchiveStoreService).loadArchiveYoung(),
    },
    {
      name: 'client identity',
      open: () => TestBed.inject(ClientIdService).getOrGenerateClientId(),
    },
  ];

  for (const opener of openers) {
    it(`preserves V1.1 data through upgrade, rejected downgrade and reopen when ${opener.name} opens first`, async () => {
      expect(DB_VERSION).toBe(12);
      await seedV11();
      const before = await openV11Fixture();
      const original = await readContents(before);
      before.close();

      await opener.open();
      const upgraded = await openDB(DB_NAME, 12);
      expect(upgraded.version).toBe(12);
      expect(await readContents(upgraded)).toEqual(original);
      upgraded.close();
      // Simulate a full application exit. Reopening below must resolve from
      // durable data through new service instances, without in-memory caches.
      closeServices();
      TestBed.resetTestingModule();
      configureServices();

      const upgradeSpy = jasmine.createSpy('older client upgrade');
      const deleteSpy = spyOn(indexedDB, 'deleteDatabase').and.callThrough();
      const rejection = await openDB(DB_NAME, 11, { upgrade: upgradeSpy }).then(
        (db) => {
          db.close();
          return null;
        },
        (error: unknown) => error,
      );
      expect(rejection).toEqual(jasmine.objectContaining({ name: 'VersionError' }));
      expect(upgradeSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();

      const reopened = await openDB(DB_NAME, DB_VERSION);
      try {
        expect(await readContents(reopened)).toEqual(original);
        const ops = TestBed.inject(OperationLogStoreService);
        expect(await ops.loadStateCache()).toEqual(SNAPSHOT);
        expect(await ops.loadImportBackup()).toEqual(BACKUP);
        expect(await ops.getVectorClock()).toEqual(CLOCK);
        expect(await TestBed.inject(ClientIdService).getOrGenerateClientId()).toBe(
          CLIENT_ID,
        );
        const young: unknown =
          await TestBed.inject(ArchiveStoreService).loadArchiveYoung();
        const old: unknown = await TestBed.inject(ArchiveStoreService).loadArchiveOld();
        expect(young).toEqual(ARCHIVE);
        expect(old).toEqual(ARCHIVE);
        expect(await readContents(reopened)).toEqual(original);
        const nextSeq = Number(await reopened.add('ops', { op: { id: 'next-op' } }));
        expect(nextSeq).toBe(21);
      } finally {
        reopened.close();
      }
    });

    it(`initializes all version-12 stores when ${opener.name} opens a fresh database first`, async () => {
      await opener.open();
      const db = await openDB(DB_NAME, 12);
      try {
        expect(db.version).toBe(12);
        expect(Array.from(db.objectStoreNames).sort()).toEqual(
          Object.values(STORE_NAMES).sort(),
        );
        expect(Array.from(db.transaction('ops').store.indexNames).sort()).toEqual([
          'byId',
          'bySourceAndStatus',
          'bySyncedAt',
        ]);
        expect(
          await TestBed.inject(OperationLogStoreService).loadStateCache(),
        ).toBeNull();
        expect(
          await TestBed.inject(ArchiveStoreService).loadArchiveYoung(),
        ).toBeUndefined();
        expect(
          await TestBed.inject(ClientIdService).getOrGenerateClientId(),
        ).toBeTruthy();
      } finally {
        db.close();
      }
    });

    it(`fails closed without destructive repair when ${opener.name} encounters a newer database`, async () => {
      await seedV11();
      const newer = await openDB(DB_NAME, DB_VERSION + 1, {
        upgrade: (db, oldVersion, _newVersion, tx) => runDbUpgrade(db, oldVersion, tx),
      });
      const original = await readContents(newer);
      newer.close();
      const deleteSpy = spyOn(indexedDB, 'deleteDatabase').and.callThrough();
      const rejection = await opener.open().then(
        () => null,
        (error: unknown) => error,
      );
      if (opener.name === 'client identity') {
        expect(rejection).toEqual(jasmine.objectContaining({ name: 'VersionError' }));
        expect(await TestBed.inject(ClientIdService).loadClientId()).toBeNull();
        await expectAsync(
          TestBed.inject(ClientIdService).persistClientId('B_replacement_fixture'),
        ).toBeRejected();
      } else {
        expect(rejection instanceof IndexedDBOpenError).toBe(true);
        expect((rejection as IndexedDBOpenError).isVersionError).toBe(true);
      }
      expect(deleteSpy).not.toHaveBeenCalled();
      const reopened = await openDB(DB_NAME, DB_VERSION + 1);
      try {
        expect(await readContents(reopened)).toEqual(original);
      } finally {
        reopened.close();
      }
    });
  }
});
