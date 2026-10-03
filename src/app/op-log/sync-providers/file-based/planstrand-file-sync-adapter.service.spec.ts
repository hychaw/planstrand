import { initialFolderState } from '../../../features/folder/folder-state';
import { addFolder } from '../../../features/folder/store/folder.actions';
import { TestBed } from '@angular/core/testing';
import {
  CURRENT_SCHEMA_VERSION,
  SUPER_SYNC_BASELINE_OP_TYPES,
  TASK_FOLDER_OWNERSHIP_V1,
} from '@sp/shared-schema';
import { PlanstrandFileSyncAdapterService } from './planstrand-file-sync-adapter.service';
import {
  discoverPlanstrandNamespace,
  PlanstrandFileTransport,
} from './planstrand-file-transport';
import {
  LEGACY_SP_FILE_NAMESPACE as L,
  PLANSTRAND_FILE_NAMESPACE as P,
  PLANSTRAND_REQUIRED_FILE_OP_TYPES,
  KNOWN_FILE_SEMANTICS,
  PlanstrandFileIncompatibleError,
  LegacyFileImportRequiredError,
  planstrandPath,
} from './planstrand-file-protocol';
import { MockFileProvider } from '../../testing/integration/helpers/mock-file-provider.helper';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { EncryptAndCompressHandlerService } from '../../encryption/encrypt-and-compress-handler.service';
import { OpType } from '../../core/operation.types';
import { ActionType } from '../../core/action-types.enum';
import { SnackService } from '../../../core/snack/snack.service';
import { KNOWN_OP_TYPES, getRemoteOpBlockReason } from '../../sync/remote-op-block.util';
import { SyncProviderId } from '../provider.const';
import {
  FileSyncTargetChangedError,
  InvalidDataSPError,
  UploadRevToMatchMismatchAPIError,
} from '../../core/errors/sync-errors';
import { SyncOperation } from '../provider.interface';
import { FileBasedSyncData } from './file-based-sync.types';
import { PlanstrandFileEnvelope } from './planstrand-file-protocol';
import { stripLocalOnlySyncSettingsFromAppData } from '../../../features/config/local-only-sync-settings.util';

describe('Planstrand namespace and durable snapshot manifest', () => {
  const cfg = { isCompress: false, isEncrypt: false };
  const codec = new EncryptAndCompressHandlerService();
  const future = 'SYNTHETIC_FUTURE_V1';
  const state = { task: { ids: [], entities: {} }, sentinel: 'planstrand' };
  let provider: MockFileProvider;
  let service: PlanstrandFileSyncAdapterService;
  let split: boolean;
  const seed = async <T extends object & { version: number }>(
    path: string,
    data: T,
  ): Promise<void> => {
    provider.setFileContent(
      path,
      await codec.compressAndEncryptData(cfg, undefined, data, data.version),
    );
  };
  const legacy = (): FileBasedSyncData => ({
    version: 2,
    syncVersion: 1,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    vectorClock: { old: 1 },
    lastModified: 1,
    clientId: 'old',
    state: { sentinel: 'legacy' },
    recentOps: [],
  });
  const v4 = (
    requirements: string[] = [],
  ): Omit<FileBasedSyncData, 'version'> & PlanstrandFileEnvelope => ({
    ...legacy(),
    version: 4,
    product: 'planstrand',
    compatibility: { requiredOpTypes: requirements },
    state,
  });
  type PhysicalSnapshot = Omit<FileBasedSyncData, 'version'> &
    PlanstrandFileEnvelope & { snapshotRef?: { file?: string } };
  const read = async (path = P.syncFile): Promise<PhysicalSnapshot> =>
    codec.decompressAndDecryptData<PhysicalSnapshot>(
      cfg,
      undefined,
      (await provider.downloadFile(path)).dataStr,
    );
  const op = (opType: string = 'UPD'): SyncOperation => ({
    id: 'test-op',
    clientId: 'new',
    actionType: ActionType.TASK_UPDATE_UI,
    opType,
    entityType: 'TASK',
    entityId: 'test',
    payload: {},
    vectorClock: { new: 1 },
    timestamp: 1,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });

  beforeEach(() => {
    localStorage.clear();
    split = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: SnackService, useValue: { open: () => undefined } },
        {
          provide: ArchiveDbAdapter,
          useValue: {
            loadArchiveYoung: async () => null,
            loadArchiveOld: async () => null,
          },
        },
        {
          provide: StateSnapshotService,
          useValue: { getStateSnapshotForOperationLog: () => state },
        },
        {
          provide: GlobalConfigService,
          useValue: { sync: () => ({ isUseSplitSyncFiles: split }) },
        },
      ],
    });
    provider = new MockFileProvider();
    service = TestBed.inject(PlanstrandFileSyncAdapterService);
  });
  it('fences pre-4E file readers with semantic requirements on ordinary encrypted Task operations', async () => {
    const encryptedCfg = { isEncrypt: true, isCompress: true };
    const futureSemantics = new Set([...KNOWN_FILE_SEMANTICS, TASK_FOLDER_OWNERSHIP_V1]);
    const writer = service.createAdapter(provider, encryptedCfg, 'password', {
      supportedOpTypes: futureSemantics,
    });
    const task = {
      ...op(),
      requiredEntityTypes: ['FOLDER'],
      requiredCapabilities: [TASK_FOLDER_OWNERSHIP_V1],
    };
    await writer.uploadOps([task], 'new');
    const futureReader = service.createAdapter(provider, encryptedCfg, 'password', {
      supportedOpTypes: futureSemantics,
    });
    const response = await futureReader.downloadOps(0);
    expect(response.ops[0].op.requiredCapabilities).toEqual([TASK_FOLDER_OWNERSHIP_V1]);
    expect(response.ops[0].op.requiredEntityTypes).toEqual(['FOLDER']);
    const old = service.createAdapter(provider, encryptedCfg, 'password', {
      supportedOpTypes: new Set(
        [...KNOWN_FILE_SEMANTICS].filter((token) => token !== TASK_FOLDER_OWNERSHIP_V1),
      ),
    });
    await expectAsync(old.downloadOps(0)).toBeRejectedWithError(
      PlanstrandFileIncompatibleError,
    );
    const before = await provider.downloadFile(P.syncFile);
    await expectAsync(old.uploadOps([op()], 'old')).toBeRejected();
    expect(await provider.downloadFile(P.syncFile)).toEqual(before);
  });
  it('keeps snapshot semantic requirements through restart and rejects Folder-only readers', async () => {
    const futureSemantics = new Set([...KNOWN_FILE_SEMANTICS, TASK_FOLDER_OWNERSHIP_V1]);
    const writer = service.createAdapter(provider, cfg, undefined, {
      supportedOpTypes: futureSemantics,
    });
    await writer.uploadSnapshot(
      state,
      'new',
      'initial',
      {},
      CURRENT_SCHEMA_VERSION,
      false,
      'snapshot',
      false,
      'SYNC_IMPORT',
      undefined,
      undefined,
      undefined,
      ['FOLDER'],
      [TASK_FOLDER_OWNERSHIP_V1],
    );
    expect((await read()).compatibility.requiredOpTypes).toContain(
      TASK_FOLDER_OWNERSHIP_V1,
    );
    const old = service.createAdapter(provider, cfg, undefined, {
      supportedOpTypes: new Set(
        [...KNOWN_FILE_SEMANTICS].filter((token) => token !== TASK_FOLDER_OWNERSHIP_V1),
      ),
    });
    await expectAsync(old.downloadOps(0)).toBeRejectedWithError(
      PlanstrandFileIncompatibleError,
    );
  });

  it('has disjoint explicit paths, rejects traversal and freezes the production activation hook', () => {
    for (const path of Object.values(L)) expect(Object.values(P)).not.toContain(path);
    expect(planstrandPath('sync-state__2__abcdef0123456789.json')).toBe(
      'planstrand-sync-state__2__abcdef0123456789.json',
    );
    expect(() => planstrandPath('../sync-data.json')).toThrow();
    expect(Object.isFrozen(PLANSTRAND_REQUIRED_FILE_OP_TYPES)).toBeTrue();
    const baseline: readonly string[] = SUPER_SYNC_BASELINE_OP_TYPES;
    for (const type of Object.values(OpType).filter(
      (candidate) => !baseline.includes(candidate),
    )) {
      expect(PLANSTRAND_REQUIRED_FILE_OP_TYPES).toContain(type);
    }
  });

  for (const id of [
    SyncProviderId.LocalFile,
    SyncProviderId.WebDAV,
    SyncProviderId.Dropbox,
    SyncProviderId.OneDrive,
  ]) {
    it(`creates only Planstrand v4 from the first ${id} write`, async () => {
      provider = new MockFileProvider(id);
      const adapter = service.createAdapter(provider, cfg, undefined);
      await adapter.uploadOps([op()], 'new', 0, state);
      expect(await read()).toEqual(
        jasmine.objectContaining({
          version: 4,
          product: 'planstrand',
          compatibility: {
            requiredOpTypes: [...PLANSTRAND_REQUIRED_FILE_OP_TYPES].sort(),
          },
        }),
      );
      const writes = provider
        .getCallHistory()
        .filter((call) => call.method === 'uploadFile');
      expect(
        writes.every((call) => String(call.args[0]).startsWith('planstrand-')),
      ).toBeTrue();
    });
  }

  it('requires explicit import on legacy-only targets, including force upload', async () => {
    await seed(L.syncFile, legacy());
    const before = await provider.downloadFile(L.syncFile);
    const adapter = service.createAdapter(provider, cfg, undefined);
    await expectAsync(adapter.downloadOps(0)).toBeRejectedWithError(
      LegacyFileImportRequiredError,
    );
    await expectAsync(
      adapter.uploadSnapshot(
        state,
        'new',
        'initial',
        {},
        CURRENT_SCHEMA_VERSION,
        false,
        'id',
      ),
    ).toBeRejectedWithError(LegacyFileImportRequiredError);
    expect(await provider.downloadFile(L.syncFile)).toEqual(before);
  });

  for (const artifact of [
    P.backupFile,
    P.opsBackupFile,
    P.stateFile,
    P.stateBackupFile,
    P.migrationLockFile,
    P.legacyMetaFile,
  ]) {
    it(`keeps orphan ${artifact} out of legacy discovery`, async () => {
      await seed(L.syncFile, legacy());
      provider.setFileContent(artifact, 'damaged artifact');
      expect(await discoverPlanstrandNamespace(provider)).toBe('planstrand');
      await expectAsync(
        service.createAdapter(provider, cfg, undefined).downloadOps(0),
      ).toBeRejectedWithError(PlanstrandFileIncompatibleError);
    });
  }

  it('requires an explicit choice when only legacy recovery data remains', async () => {
    await seed(L.backupFile, legacy());
    expect(await discoverPlanstrandNamespace(provider)).toBe('legacy');
    await expectAsync(
      service.createAdapter(provider, cfg, undefined).downloadOps(0),
    ).toBeRejectedWithError(LegacyFileImportRequiredError);
  });

  it('keeps an existing empty Planstrand primary out of legacy discovery', async () => {
    await seed(L.syncFile, legacy());
    const download = provider.downloadFile.bind(provider);
    spyOn(provider, 'downloadFile').and.callFake(async (path) => {
      if (path === P.syncFile) throw new InvalidDataSPError('Empty remote file');
      return download(path);
    });
    expect(await discoverPlanstrandNamespace(provider)).toBe('planstrand');
    await expectAsync(
      service.createAdapter(provider, cfg, undefined).downloadOps(0),
    ).toBeRejected();
  });

  it('does not report an interrupted reservation as a successful import', async () => {
    await seed(L.syncFile, legacy());
    await seed(P.backupFile, { ...v4(), recoveryStatus: 'uncommitted' });
    const captureRecoveryPoint = jasmine.createSpy('captureRecoveryPoint');
    await expectAsync(
      service.importLegacy(provider, cfg, undefined, 'new', {
        captureRecoveryPoint,
        materialize: async () => state,
      }),
    ).toBeRejectedWithError(PlanstrandFileIncompatibleError);
    expect(captureRecoveryPoint).not.toHaveBeenCalled();
    await expectAsync(
      service.createAdapter(provider, cfg, undefined).downloadOps(0),
    ).toBeRejectedWithError(PlanstrandFileIncompatibleError);
  });

  for (const importing of [false, true]) {
    it(`strips device-local settings at direct creation (import=${importing})`, async () => {
      const hostState = {
        ...state,
        globalConfig: {
          sync: {
            syncProvider: SyncProviderId.WebDAV,
            syncInterval: 300000,
            isManualSyncOnly: true,
            isEnabled: true,
            isEncryptionEnabled: false,
            isCompressionEnabled: true,
          },
        },
      };
      const before = structuredClone(hostState);
      if (importing) {
        await seed(L.syncFile, legacy());
        await service.importLegacy(provider, cfg, undefined, 'new', {
          captureRecoveryPoint: async () => undefined,
          materialize: async () => hostState,
        });
      } else {
        await service.startFresh(provider, cfg, undefined, hostState, 'new', {});
      }
      const physical = await read();
      expect(physical.state).toEqual(stripLocalOnlySyncSettingsFromAppData(hostState));
      const remoteSync = (physical.state as typeof hostState).globalConfig.sync;
      expect(remoteSync.syncProvider).toBeNull();
      expect(remoteSync.syncInterval).toBeUndefined();
      expect(remoteSync.isManualSyncOnly).toBeUndefined();
      expect(remoteSync.isCompressionEnabled).toBeTrue();
      expect((await read(P.backupFile)).state).toEqual(physical.state);
      await service
        .createAdapter(provider, cfg, undefined)
        .uploadSnapshot(
          hostState,
          'new',
          'initial',
          {},
          CURRENT_SCHEMA_VERSION,
          false,
          'normal-snapshot',
        );
      expect((await read()).state).toEqual(physical.state);
      expect(hostState).toEqual(before);
    });

    it(`stores canonical archives through creation, download and ordinary sync (import=${importing})`, async () => {
      const archiveYoung = {
        task: { ids: [], entities: {} },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: 12,
      };
      const archiveOld = { ...archiveYoung, lastTimeTrackingFlush: 34 };
      const hostState = { ...state, archiveYoung, archiveOld };
      const before = structuredClone(hostState);
      if (importing) {
        await seed(L.syncFile, { ...legacy(), archiveYoung, archiveOld });
        await service.importLegacy(provider, cfg, undefined, 'new', {
          captureRecoveryPoint: async () => undefined,
          materialize: async () => hostState,
        });
      } else {
        await service.startFresh(provider, cfg, undefined, hostState, 'new', {});
      }
      const assertPhysical = async (): Promise<void> => {
        const physical = await read();
        expect(physical.state).toEqual(state);
        expect(physical.archiveYoung).toEqual(archiveYoung);
        expect(physical.archiveOld).toEqual(archiveOld);
      };
      await assertPhysical();
      const adapter = service.createAdapter(provider, cfg, undefined);
      expect((await adapter.downloadOps(0)).snapshotState).toEqual(hostState);
      // The host materializer installs archives in the existing archive DB;
      // subsequent ordinary uploads read those canonical partitions.
      spyOn(TestBed.inject(ArchiveDbAdapter), 'loadArchiveYoung').and.resolveTo(
        archiveYoung,
      );
      spyOn(TestBed.inject(ArchiveDbAdapter), 'loadArchiveOld').and.resolveTo(archiveOld);
      await adapter.uploadOps([op()], 'new');
      await assertPhysical();
      expect((await adapter.downloadOps(0)).snapshotState).toEqual(hostState);
      expect(hostState).toEqual(before);
    });
  }

  it('stamps current schema after materializing an older supported legacy schema', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThan(1);
    const oldSchema = CURRENT_SCHEMA_VERSION - 1;
    await seed(L.syncFile, { ...legacy(), schemaVersion: oldSchema });
    const before = await provider.downloadFile(L.syncFile);
    const materialize = jasmine.createSpy('materialize').and.callFake(async () => state);
    await service.importLegacy(provider, cfg, undefined, 'new', {
      captureRecoveryPoint: async () => undefined,
      materialize,
    });
    expect(materialize).toHaveBeenCalledTimes(1);
    expect((await read()).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect((await read()).state).toEqual(state);
    expect(await provider.downloadFile(L.syncFile)).toEqual(before);
  });

  it('creates current-schema snapshots without inventing archive partitions', async () => {
    await service.startFresh(provider, cfg, undefined, state, 'new', {});
    const physical = await read();
    expect(physical.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(Object.hasOwn(physical, 'archiveYoung')).toBeFalse();
    expect(Object.hasOwn(physical, 'archiveOld')).toBeFalse();
  });

  it('imports one-way with recovery before materialization and never imports again', async () => {
    await seed(L.syncFile, {
      ...legacy(),
      archiveYoung: { sentinel: 'archive' },
      archiveOld: { sentinel: 'old archive' },
    });
    const before = await provider.downloadFile(L.syncFile);
    const order: string[] = [];
    const hooks = {
      captureRecoveryPoint: async () => {
        order.push('backup');
      },
      materialize: async (response: { snapshotState?: unknown }) => {
        order.push('materialize');
        return response.snapshotState;
      },
    };
    await service.importLegacy(provider, cfg, undefined, 'new', hooks);
    expect(order).toEqual(['backup', 'materialize']);
    expect(
      (await service.createAdapter(provider, cfg, undefined).downloadOps(0))
        .snapshotState,
    ).toEqual({
      sentinel: 'legacy',
      archiveYoung: { sentinel: 'archive' },
      archiveOld: { sentinel: 'old archive' },
    });
    expect(await provider.downloadFile(L.syncFile)).toEqual(before);
    await service.importLegacy(provider, cfg, undefined, 'new', hooks);
    expect(order.length).toBe(2);
    expect(await discoverPlanstrandNamespace(provider)).toBe('planstrand');
  });

  it('aborts when the legacy revision changes during materialization', async () => {
    await seed(L.syncFile, legacy());
    await expectAsync(
      service.importLegacy(provider, cfg, undefined, 'new', {
        captureRecoveryPoint: async () => undefined,
        materialize: async (response) => {
          await seed(L.syncFile, { ...legacy(), syncVersion: 2 });
          return response.snapshotState;
        },
      }),
    ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);
    expect(await discoverPlanstrandNamespace(provider)).toBe('legacy');
  });

  it('rejects unknown manifests before hydration, cursor staging or backup fallback', async () => {
    await seed(P.syncFile, v4([future]));
    await seed(P.backupFile, v4());
    const adapter = service.createAdapter(provider, cfg, undefined);
    await expectAsync(adapter.downloadOps(0)).toBeRejectedWithError(
      PlanstrandFileIncompatibleError,
    );
    expect(await adapter.getLastServerSeq()).toBe(0);
    await expectAsync(adapter.uploadOps([op()], 'new')).toBeRejectedWithError(
      PlanstrandFileIncompatibleError,
    );
    expect((await read()).compatibility.requiredOpTypes).toEqual([future]);
  });

  for (const invalid of [
    { product: 'other' },
    { compatibility: undefined },
    { version: 5 },
  ]) {
    it(`fails closed on invalid protocol metadata ${JSON.stringify(invalid)}`, async () => {
      await seed(P.syncFile, { ...v4(), ...invalid });
      await expectAsync(
        service.createAdapter(provider, cfg, undefined).downloadOps(0),
      ).toBeRejectedWithError(PlanstrandFileIncompatibleError);
    });
  }

  it('keeps an automatic future requirement after trim, force/repair/backup import and cold restart', async () => {
    const known = KNOWN_FILE_SEMANTICS as Set<string>;
    known.add(future);
    (KNOWN_OP_TYPES as Set<string>).add(future);
    try {
      const adapter = service.createAdapter(provider, cfg, undefined);
      await adapter.uploadOps([op(future)], 'new', 0, state);
      expect((await read()).compatibility.requiredOpTypes).toEqual(
        [...PLANSTRAND_REQUIRED_FILE_OP_TYPES, future].sort(),
      );
      for (const type of ['SYNC_IMPORT', 'REPAIR', 'BACKUP_IMPORT'] as const) {
        await adapter.uploadSnapshot(
          state,
          'new',
          'recovery',
          { new: 1 },
          CURRENT_SCHEMA_VERSION,
          false,
          'snapshot',
          false,
          type,
        );
        expect((await read()).recentOps).toEqual([]);
        expect((await read()).compatibility.requiredOpTypes).toEqual(
          [...PLANSTRAND_REQUIRED_FILE_OP_TYPES, future].sort(),
        );
      }
      localStorage.clear();
      service.invalidateAllTargets();
      const cold = TestBed.runInInjectionContext(
        () => new PlanstrandFileSyncAdapterService(),
      ).createAdapter(provider, cfg, undefined);
      expect((await cold.downloadOps(0)).snapshotState).toEqual(state);
    } finally {
      known.delete(future);
      (KNOWN_OP_TYPES as Set<string>).delete(future);
    }
    await expectAsync(
      service.createAdapter(provider, cfg, undefined).downloadOps(0),
    ).toBeRejectedWithError(PlanstrandFileIncompatibleError);
  });

  it('keeps default Folder full-state compatible with a reader lacking Folder support', async () => {
    const adapter = service.createAdapter(provider, cfg, undefined);
    await adapter.uploadSnapshot(
      { ...state, folder: initialFolderState },
      'new',
      'recovery',
      {},
      CURRENT_SCHEMA_VERSION,
      false,
      'default-folder',
    );
    service.invalidateAllTargets();
    localStorage.clear();
    const supported = new Set(KNOWN_FILE_SEMANTICS);
    supported.delete('ENTITY:FOLDER');
    const old = service.createAdapter(provider, cfg, undefined, {
      supportedOpTypes: supported,
      requiredOpTypes: PLANSTRAND_REQUIRED_FILE_OP_TYPES,
    });
    expect((await old.downloadOps(0)).snapshotState).toEqual({
      ...state,
      folder: initialFolderState,
    });
  });

  it('retains Folder state and its entity requirement after an encrypted full-state commit and cold reload', async () => {
    const folder = addFolder({
      state: initialFolderState,
      folder: { id: 'folder-file', title: 'Folder' },
    }).folderState;
    const encryptedCfg = { isCompress: true, isEncrypt: true };
    const adapter = service.createAdapter(provider, encryptedCfg, 'folder-file-password');
    await adapter.uploadSnapshot(
      { ...state, folder },
      'new',
      'recovery',
      {},
      CURRENT_SCHEMA_VERSION,
      false,
      'folder-snapshot',
      false,
      'BACKUP_IMPORT',
    );
    service.invalidateAllTargets();
    localStorage.clear();
    const cold = service.createAdapter(provider, encryptedCfg, 'folder-file-password');
    expect((await cold.downloadOps(0)).snapshotState).toEqual({ ...state, folder });
    const decoded = await codec.decompressAndDecryptData<PlanstrandFileEnvelope>(
      encryptedCfg,
      'folder-file-password',
      (await provider.downloadFile(P.syncFile)).dataStr,
    );
    expect(decoded.compatibility.requiredOpTypes).toContain('ENTITY:FOLDER');
    const older = new Set(KNOWN_FILE_SEMANTICS);
    older.delete('ENTITY:FOLDER');
    await expectAsync(
      service
        .createAdapter(provider, encryptedCfg, 'folder-file-password', {
          supportedOpTypes: older,
        })
        .downloadOps(0),
    ).toBeRejectedWithError(PlanstrandFileIncompatibleError);
    await expectAsync(
      service
        .createAdapter(provider, encryptedCfg, 'folder-file-password', {
          supportedOpTypes: older,
        })
        .uploadSnapshot(
          state,
          'old',
          'recovery',
          {},
          CURRENT_SCHEMA_VERSION,
          false,
          'old-snapshot',
        ),
    ).toBeRejectedWithError(PlanstrandFileIncompatibleError);
    expect((await cold.downloadOps(0)).snapshotState).toEqual({ ...state, folder });
  });

  it('cannot opt out of PLANNING_V1 and preserves it after all full-state writers and cold reload', async () => {
    for (const type of ['SYNC_IMPORT', 'REPAIR', 'BACKUP_IMPORT'] as const) {
      const adapter = service.createAdapter(provider, cfg, undefined, {
        requiredOpTypes: [],
      });
      await adapter.uploadSnapshot(
        state,
        'new',
        'recovery',
        {},
        CURRENT_SCHEMA_VERSION,
        true,
        'id',
        false,
        type,
      );
      const envelope = await read();
      expect(envelope.compatibility.requiredOpTypes).toContain('PLANNING_V1');
      expect(envelope.recentOps).toEqual([]);
      localStorage.clear();
      service.invalidateAllTargets();
      const cold = TestBed.runInInjectionContext(
        () => new PlanstrandFileSyncAdapterService(),
      ).createAdapter(provider, cfg, undefined);
      expect((await cold.downloadOps(0)).snapshotState).toEqual(state);
    }
    const known = KNOWN_FILE_SEMANTICS as Set<string>;
    known.delete('PLANNING_V1');
    try {
      await expectAsync(
        service.createAdapter(provider, cfg, undefined).downloadOps(0),
      ).toBeRejectedWithError(PlanstrandFileIncompatibleError);
    } finally {
      known.add('PLANNING_V1');
    }
  });
  it('persists a build requirement without a retained future operation', async () => {
    const adapter = service.createAdapter(provider, cfg, undefined, {
      requiredOpTypes: [future],
      supportedOpTypes: new Set([...KNOWN_FILE_SEMANTICS, future]),
    });
    await adapter.uploadSnapshot(
      state,
      'new',
      'initial',
      {},
      CURRENT_SCHEMA_VERSION,
      false,
      'id',
    );
    expect((await read()).compatibility.requiredOpTypes).toEqual(
      [...PLANSTRAND_REQUIRED_FILE_OP_TYPES, future].sort(),
    );
  });

  for (const useSplit of [false, true]) {
    it(`retains the requirement when compaction removes the originating op (split=${useSplit})`, async () => {
      split = useSplit;
      const known = KNOWN_FILE_SEMANTICS as Set<string>;
      known.add(future);
      (KNOWN_OP_TYPES as Set<string>).add(future);
      try {
        const adapter = service.createAdapter(provider, cfg, undefined);
        await adapter.uploadOps([op(future)], 'new', 0, state);
        const response = await adapter.downloadOps(0);
        await adapter.setLastServerSeq(response.latestSeq);
        const batch = Array.from({ length: 2001 }, (_, i) => ({
          ...op(),
          id: `baseline-${i}`,
        }));
        await adapter.uploadOps(batch, 'new', response.latestSeq, state);
        const commit = await read(useSplit ? P.opsFile : P.syncFile);
        expect(commit.compatibility.requiredOpTypes).toEqual(
          [...PLANSTRAND_REQUIRED_FILE_OP_TYPES, future].sort(),
        );
        expect(
          commit.recentOps.some((value) => (value as { id: string }).id === 'test-op'),
        ).toBeFalse();
        localStorage.clear();
        service.invalidateAllTargets();
        const cold = TestBed.runInInjectionContext(
          () => new PlanstrandFileSyncAdapterService(),
        ).createAdapter(provider, cfg, undefined);
        expect((await cold.downloadOps(0)).snapshotState).toEqual(state);
      } finally {
        known.delete(future);
        (KNOWN_OP_TYPES as Set<string>).delete(future);
      }
      await expectAsync(
        service.createAdapter(provider, cfg, undefined).downloadOps(0),
      ).toBeRejectedWithError(PlanstrandFileIncompatibleError);
    });
  }

  it('imports committed v3 split snapshots and their unapplied tail without changing a tombstone', async () => {
    const base = legacy();
    await seed(L.syncFile, { version: 3, format: 'split' });
    await seed(L.stateFile, { ...base, version: 3 });
    await seed(L.opsFile, {
      ...base,
      version: 3,
      snapshotRef: { syncVersion: 1, vectorClock: base.vectorClock },
    });
    const before = await provider.downloadFile(L.syncFile);
    await service.importLegacy(provider, cfg, undefined, 'new', {
      captureRecoveryPoint: async () => undefined,
      materialize: async (response) => response.snapshotState,
    });
    expect(await provider.downloadFile(L.syncFile)).toEqual(before);
    expect(await discoverPlanstrandNamespace(provider)).toBe('planstrand');
  });

  it('imports recoverable legacy backup input and leaves the corrupt primary unchanged', async () => {
    provider.setFileContent(L.syncFile, 'pf_2__corrupt');
    await seed(L.backupFile, legacy());
    await service.importLegacy(provider, cfg, undefined, 'new', {
      captureRecoveryPoint: async () => undefined,
      materialize: async (response) => response.snapshotState,
    });
    expect((await provider.downloadFile(L.syncFile)).dataStr).toBe('pf_2__corrupt');
  });

  it('imports encrypted compressed legacy input without changing it', async () => {
    const encrypted = { isEncrypt: true, isCompress: true };
    const encoded = await codec.compressAndEncryptData(
      encrypted,
      'password',
      legacy(),
      2,
    );
    provider.setFileContent(L.syncFile, encoded);
    await service.importLegacy(provider, encrypted, 'password', 'new', {
      captureRecoveryPoint: async () => undefined,
      materialize: async (response) => response.snapshotState,
    });
    expect((await provider.downloadFile(L.syncFile)).dataStr).toBe(encoded);
    expect(
      (await service.createAdapter(provider, encrypted, 'password').downloadOps(0))
        .snapshotState,
    ).toEqual({ sentinel: 'legacy' });
  });

  it('cannot overwrite a concurrent remote fence with an ordinary stale primary CAS', async () => {
    await seed(P.syncFile, v4());
    const adapter = service.createAdapter(provider, cfg, undefined);
    const response = await adapter.downloadOps(0);
    await adapter.setLastServerSeq(response.latestSeq);
    const upload = provider.uploadFile.bind(provider);
    let raced = false;
    spyOn(provider, 'uploadFile').and.callFake(async (path, body, rev, force) => {
      if (path === P.syncFile && !raced) {
        raced = true;
        await seed(P.syncFile, v4([future]));
      }
      return upload(path, body, rev, force);
    });
    await expectAsync(
      adapter.uploadOps([op()], 'new', response.latestSeq, state),
    ).toBeRejected();
    expect((await read()).compatibility.requiredOpTypes).toEqual([future]);
    expect(
      provider
        .getCallHistory()
        .filter((call) => call.method === 'uploadFile' && call.args[0] === P.syncFile)
        .every((call) => call.args[3] === false),
    ).toBeTrue();
  });

  it('preserves the manifest across password rotation using the old read key', async () => {
    const encrypted = { isEncrypt: true, isCompress: false };
    const supported = new Set([...KNOWN_FILE_SEMANTICS, future]);
    const original = service.createAdapter(provider, encrypted, 'old-password', {
      requiredOpTypes: [future],
      supportedOpTypes: supported,
    });
    await original.uploadSnapshot(
      state,
      'new',
      'initial',
      {},
      CURRENT_SCHEMA_VERSION,
      true,
      'id',
    );
    const rotated = service.createAdapter(provider, encrypted, 'new-password', {
      supportedOpTypes: supported,
      readCfg: encrypted,
      readKey: 'old-password',
    });
    await rotated.uploadSnapshot(
      state,
      'new',
      'recovery',
      {},
      CURRENT_SCHEMA_VERSION,
      true,
      'id',
    );
    const raw = await codec.decompressAndDecryptData<PlanstrandFileEnvelope>(
      encrypted,
      'new-password',
      (await provider.downloadFile(P.syncFile)).dataStr,
    );
    expect(raw.compatibility.requiredOpTypes).toEqual(
      [...PLANSTRAND_REQUIRED_FILE_OP_TYPES, future].sort(),
    );
  });

  it('recovers compatible Planstrand backup but rejects an incompatible backup', async () => {
    provider.setFileContent(P.syncFile, 'pf_4__corrupt');
    await seed(P.backupFile, v4());
    expect(
      (await service.createAdapter(provider, cfg, undefined).downloadOps(0))
        .snapshotState,
    ).toEqual(state);
    service.invalidateAllTargets();
    await seed(P.backupFile, v4([future]));
    await expectAsync(
      service.createAdapter(provider, cfg, undefined).downloadOps(0),
    ).toBeRejected();
  });

  it('uses Planstrand split/immutable paths and includes requirements in both snapshot and commit', async () => {
    split = true;
    const adapter = service.createAdapter(provider, cfg, undefined, {
      requiredOpTypes: [future],
      supportedOpTypes: new Set([...KNOWN_FILE_SEMANTICS, future]),
    });
    await adapter.uploadOps([op()], 'new', 0, state);
    const commit = await read(P.opsFile);
    expect(commit.compatibility.requiredOpTypes).toEqual(
      [...PLANSTRAND_REQUIRED_FILE_OP_TYPES, future].sort(),
    );
    expect(commit.snapshotRef?.file).toMatch(/^planstrand-sync-state__/);
    expect((await read(commit.snapshotRef!.file!)).compatibility.requiredOpTypes).toEqual(
      [...PLANSTRAND_REQUIRED_FILE_OP_TYPES, future].sort(),
    );
  });

  it('ignores later legacy backup writes and deletes only Planstrand files', async () => {
    await seed(L.syncFile, legacy());
    await service.startFresh(provider, cfg, undefined, state, 'new', {});
    const primary = await provider.downloadFile(P.syncFile),
      backup = await provider.downloadFile(P.backupFile);
    await seed(L.backupFile, legacy());
    await seed(L.syncFile, { ...legacy(), syncVersion: 9 });
    expect(await provider.downloadFile(P.syncFile)).toEqual(primary);
    expect(await provider.downloadFile(P.backupFile)).toEqual(backup);
    const adapter = service.createAdapter(provider, cfg, undefined);
    expect((await adapter.downloadOps(0)).snapshotState).toEqual(state);
    expect((await adapter.deleteAllData()).success).toBeTrue();
    expect((await provider.downloadFile(L.syncFile)).dataStr).toContain('legacy');
    expect((await provider.downloadFile(L.backupFile)).dataStr).toContain('legacy');
  });

  it('reserves the recovery floor before a first stronger commit defeats a delayed weaker backup create', async () => {
    const upload = provider.uploadFile.bind(provider);
    let resume: () => void = () => undefined;
    let arrived: () => void = () => undefined;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const started = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    spyOn(provider, 'uploadFile').and.callFake(async (path, body, rev, force) => {
      const data = await codec.decompressAndDecryptData<PlanstrandFileEnvelope>(
        cfg,
        undefined,
        body,
      );
      if (path === P.backupFile && data.compatibility.requiredOpTypes.length === 0) {
        arrived();
        await paused;
      }
      return upload(path, body, rev, force);
    });
    const makeTransport = (required: readonly string[]): PlanstrandFileTransport =>
      new PlanstrandFileTransport(provider, cfg, undefined, {
        supportedOpTypes: new Set([...KNOWN_FILE_SEMANTICS, future]),
        requiredOpTypes: required,
        assertTargetCurrent: () => undefined,
      });
    const body = await codec.compressAndEncryptData(cfg, undefined, legacy(), 2);
    const delayed = makeTransport([]).provider.uploadFile(L.backupFile, body, null, true);
    const rejected = expectAsync(delayed).toBeRejectedWithError(
      UploadRevToMatchMismatchAPIError,
    );
    await started;
    await makeTransport([future]).provider.uploadFile(L.syncFile, body, null, false);
    resume();
    await rejected;
    expect((await read(P.syncFile)).compatibility.requiredOpTypes).toEqual([future]);
    expect((await read(P.backupFile)).compatibility.requiredOpTypes).toEqual([future]);
  });

  it('guards writes after target invalidation', async () => {
    const adapter = service.createAdapter(provider, cfg, undefined);
    service.invalidateAllTargets();
    await expectAsync(adapter.uploadOps([op()], 'new')).toBeRejectedWithError(
      FileSyncTargetChangedError,
    );
  });

  it('round-trips Planning revisions and tombstones through a persisted file snapshot', async () => {
    for (const placement of [
      null,
      { target: { type: 'DAY' as const, key: '2026-10-05' }, orderKey: 'V' },
    ]) {
      const record = {
        id: 'X',
        placement,
        revision: { counter: 10, clientId: 'new', opId: 'planning-op' },
      };
      const snapshot = { ...state, planning: { ids: ['X'], entities: { X: record } } };
      const adapter = service.createAdapter(provider, cfg, undefined);
      await adapter.uploadSnapshot(
        snapshot,
        'new',
        'initial',
        {},
        CURRENT_SCHEMA_VERSION,
        true,
        'snapshot-op',
      );
      const restarted = service.createAdapter(provider, cfg, undefined);
      expect((await restarted.downloadOps(0)).snapshotState).toEqual(snapshot);
    }
  });
  it('round-trips encrypted compressed v4 files and refuses plaintext recovery', async () => {
    const encrypted = { isEncrypt: true, isCompress: true };
    const adapter = service.createAdapter(provider, encrypted, 'password');
    await adapter.uploadSnapshot(
      state,
      'new',
      'initial',
      {},
      CURRENT_SCHEMA_VERSION,
      true,
      'id',
    );
    expect((await adapter.downloadOps(0)).snapshotState).toEqual(state);
    await seed(P.backupFile, v4());
    provider.setFileContent(P.syncFile, 'pf_CE4__corrupt');
    await expectAsync(adapter.downloadOps(0)).toBeRejected();
  });

  it('does not weaken Phase 2A retained-op checks in Planstrand files', async () => {
    await seed(P.syncFile, {
      ...v4(),
      recentOps: [
        {
          id: 'unknown',
          a: 'unknown',
          o: future,
          e: 'TASK',
          p: {},
          c: 'old',
          v: {},
          t: 1,
          s: CURRENT_SCHEMA_VERSION,
        },
      ],
    });
    const result = await service.createAdapter(provider, cfg, undefined).downloadOps(0);
    expect(result.ops.length).toBe(1);
    expect(getRemoteOpBlockReason(result.ops[0].op, CURRENT_SCHEMA_VERSION)).toBe(
      'UNKNOWN_OP_VOCABULARY',
    );
  });
});
