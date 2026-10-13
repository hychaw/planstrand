import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { UpgradeCheckpointService } from './upgrade-checkpoint.service';
import { BackupService } from './backup.service';
import { StateSnapshotService } from './state-snapshot.service';
import { OperationWriteFlushService } from '../sync/operation-write-flush.service';
import { LockService } from '../sync/lock.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import {
  createValidAppData,
  createValidTask,
  appDataToRootState,
} from '../validation/state-validity-test-utils';
import {
  AppDataComplete,
  CROSS_MODEL_VERSION,
  withDefaultModelSlices,
} from '../model/model-config';
import { UpgradeCheckpointData } from '../../../../electron/shared-with-frontend/upgrade-checkpoint.model';
import { ROUTINES_V1 } from '@sp/shared-schema';
import { selectTaskFeatureState } from '../../features/tasks/store/task.selectors';
import { occurrenceExceptionId } from '../../features/routines/occurrence-exception.validation';
import {
  bufferDeferredAction,
  clearDeferredActions,
} from '../capture/operation-capture.meta-reducer';
import { PersistentAction } from '../core/persistent-action.interface';

// src/test.ts gives each test its own in-memory IndexedDB factory.
describe('Upgrade checkpoint through real export, flush and disposable persistence', () => {
  let service: UpgradeCheckpointService;
  let store: MockStore;
  let log: OperationLogStoreService;
  let archives: ArchiveDbAdapter;
  let source: AppDataComplete;
  let nativeWrite: jasmine.Spy;
  let capture: jasmine.SpyObj<OperationCaptureService>;
  let hydration: jasmine.SpyObj<HydrationStateService>;
  let taskTime: jasmine.SpyObj<TaskTimeSyncService>;
  let saved: UpgradeCheckpointData;
  let originalEa: typeof window.ea;

  beforeEach(async () => {
    originalEa = window.ea;
    capture = jasmine.createSpyObj('OperationCaptureService', [
      'getPendingCount',
      'hasUnrecoveredPersistFailure',
    ]);
    capture.getPendingCount.and.returnValue(0);
    capture.hasUnrecoveredPersistFailure.and.returnValue(false);
    hydration = jasmine.createSpyObj('HydrationStateService', [
      'isHydrationInProgress',
      'isHydrationFallbackActive',
      'isInSyncWindow',
    ]);
    taskTime = jasmine.createSpyObj('TaskTimeSyncService', ['flush', 'clear']);
    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        UpgradeCheckpointService,
        BackupService,
        StateSnapshotService,
        OperationWriteFlushService,
        LockService,
        OperationLogStoreService,
        ArchiveDbAdapter,
        { provide: OperationCaptureService, useValue: capture },
        { provide: HydrationStateService, useValue: hydration },
        { provide: TaskTimeSyncService, useValue: taskTime },
        {
          provide: ImexViewService,
          useValue: {
            isDataImportInProgress: false,
            setDataImportInProgress: () => {},
          },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    log = TestBed.inject(OperationLogStoreService);
    archives = TestBed.inject(ArchiveDbAdapter);
    await log.init();
    source = withDefaultModelSlices(createValidAppData());
    source.archiveYoung.task = {
      ids: ['young'],
      entities: { young: createValidTask('young') },
    };
    source.archiveOld.task = { ids: ['old'], entities: { old: createValidTask('old') } };
    source.eventSeries = {
      ids: ['series'],
      entities: {
        series: {
          id: 'series',
          title: 'Routine',
          created: 1,
          modified: 1,
          segments: [
            {
              id: 'segment',
              recurrence: { frequency: 'daily', interval: 1, startDate: '2026-10-01' },
              timing: { kind: 'allDay' },
            },
          ],
        },
      },
    };
    source.weeklyTemplate = {
      ids: ['template'],
      entities: {
        template: {
          id: 'template',
          title: 'Inactive template',
          isActive: false,
          startDate: '2026-10-01',
          created: 1,
          modified: 1,
        },
      },
    };
    const exceptionKey = { seriesId: 'series', slot: 1 };
    const exceptionId = occurrenceExceptionId(exceptionKey);
    source.occurrenceException = {
      ids: [exceptionId],
      entities: {
        [exceptionId]: {
          ...exceptionKey,
          id: exceptionId,
          value: { kind: 'cancelled' },
          modified: 1,
        },
      },
    };
    store.setState({ ...source, ...appDataToRootState(source) });
    await archives.saveArchivesAtomic(source.archiveYoung, source.archiveOld);
    nativeWrite = jasmine
      .createSpy('writeUpgradeCheckpoint')
      .and.callFake(async (data: UpgradeCheckpointData) => {
        saved = JSON.parse(JSON.stringify(data));
        return {
          ok: true,
          path: 'disposable/verified.json',
          coverage: 'application-data',
        };
      });
    window.ea = { ...originalEa, writeUpgradeCheckpoint: nativeWrite };
    service = TestBed.inject(UpgradeCheckpointService);
  });

  afterEach(() => {
    window.ea = originalEa;
    clearDeferredActions();
    store.resetSelectors();
  });

  it('captures archives and V1.2 Routines and restores the verified export into disposable IndexedDB', async () => {
    expect(await service.prepare()).toEqual({
      ok: true,
      path: 'disposable/verified.json',
      coverage: 'application-data',
    });
    expect(taskTime.flush).toHaveBeenCalledTimes(1);
    expect(saved.crossModelVersion).toBe(CROSS_MODEL_VERSION);
    expect(saved.requiredCapabilities).toContain(ROUTINES_V1);
    for (const key of [
      'eventSeries',
      'weeklyTemplate',
      'occurrenceException',
      'folder',
      'planning',
      'workSession',
      'event',
      'globalConfig',
      'archiveYoung',
      'archiveOld',
    ] as const) {
      expect(saved.data[key])
        .withContext(key)
        .toEqual(JSON.parse(JSON.stringify(source[key])));
    }
    await TestBed.inject(BackupService).importCompleteBackup(saved, true, true);
    const restored = await log.loadStateCache();
    expect((restored?.state as AppDataComplete).eventSeries).toEqual(
      saved.data.eventSeries,
    );
    expect((restored?.state as AppDataComplete).weeklyTemplate).toEqual(
      saved.data.weeklyTemplate,
    );
    expect(await archives.loadArchiveYoung()).toEqual(saved.data.archiveYoung);
    expect(await archives.loadArchiveOld()).toEqual(saved.data.archiveOld);
  });

  it('waits for pending persistence before reading the store', async () => {
    let pending = 1;
    capture.getPendingCount.and.callFake(() => pending);
    const snapshot = spyOn(
      TestBed.inject(StateSnapshotService),
      'getAllSyncModelDataFromStoreAsync',
    ).and.callThrough();
    const preparation = service.prepare();
    expect(snapshot).not.toHaveBeenCalled();
    pending = 0;
    expect((await preparation).ok).toBeTrue();
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('captures reducer state before archive I/O and keeps later mutations outside the checkpoint', async () => {
    const loadYoung = archives.loadArchiveYoung.bind(archives);
    spyOn(archives, 'loadArchiveYoung').and.callFake(async () => {
      store.overrideSelector(selectTaskFeatureState, {
        ...source.task,
        ids: ['later'],
        entities: { later: createValidTask('later') },
      });
      store.refreshState();
      return loadYoung();
    });
    expect((await service.prepare()).ok).toBeTrue();
    expect(saved.data.task.ids).toEqual([]);
  });

  for (const flag of [
    'isHydrationInProgress',
    'isHydrationFallbackActive',
    'isInSyncWindow',
  ] as const) {
    it(`refuses capture during ${flag}`, async () => {
      hydration[flag].and.returnValue(true);
      expect(await service.prepare()).toEqual({
        ok: false,
        reason: 'PREPARATION_FAILED',
      });
      expect(nativeWrite).not.toHaveBeenCalled();
    });
  }

  it('refuses an unrecovered persistence failure', async () => {
    capture.hasUnrecoveredPersistFailure.and.returnValue(true);
    expect((await service.prepare()).ok).toBeFalse();
    expect(nativeWrite).not.toHaveBeenCalled();
  });

  it('refuses an already active import before flushing task time or writing a checkpoint', async () => {
    const imex = TestBed.inject(ImexViewService);
    imex.isDataImportInProgress = true;
    expect(await service.prepare()).toEqual({ ok: false, reason: 'PREPARATION_FAILED' });
    expect(taskTime.flush).not.toHaveBeenCalled();
    expect(nativeWrite).not.toHaveBeenCalled();
    imex.isDataImportInProgress = false;
    expect((await service.prepare()).ok).toBeTrue();
  });

  it('rechecks import state after the operation drain', async () => {
    taskTime.flush.and.callFake(() => {
      TestBed.inject(ImexViewService).isDataImportInProgress = true;
    });
    expect(await service.prepare()).toEqual({ ok: false, reason: 'PREPARATION_FAILED' });
    expect(nativeWrite).not.toHaveBeenCalled();
  });

  it('refuses a checkpoint if an import starts during archive I/O without clearing stored data', async () => {
    const loadYoung = archives.loadArchiveYoung.bind(archives);
    spyOn(archives, 'loadArchiveYoung').and.callFake(async () => {
      TestBed.inject(ImexViewService).isDataImportInProgress = true;
      return loadYoung();
    });
    const before = await log.loadStateCache();
    expect(await service.prepare()).toEqual({ ok: false, reason: 'PREPARATION_FAILED' });
    expect(nativeWrite).not.toHaveBeenCalled();
    expect(await log.loadStateCache()).toEqual(before);
    expect(await archives.loadArchiveOld()).toEqual(source.archiveOld);
  });

  it('refuses undrained deferred actions', async () => {
    bufferDeferredAction({ type: '[Test] deferred' } as PersistentAction);
    expect(await service.prepare()).toEqual({ ok: false, reason: 'PREPARATION_FAILED' });
    expect(nativeWrite).not.toHaveBeenCalled();
  });

  it('does not repair or persist an invalid model to make a checkpoint', async () => {
    store.setState({
      ...source,
      ...appDataToRootState(source),
      eventSeries: {
        ids: ['invalid'],
        entities: { invalid: { id: 'invalid' } },
      },
    });
    const before = await log.loadStateCache();
    expect(await service.prepare()).toEqual({ ok: false, reason: 'PREPARATION_FAILED' });
    expect(nativeWrite).not.toHaveBeenCalled();
    expect(await log.loadStateCache()).toEqual(before);
    expect(await archives.loadArchiveYoung()).toEqual(source.archiveYoung);
  });

  it('returns failure without replacing live persistence when archive reading fails', async () => {
    const before = await log.loadStateCache();
    spyOn(archives, 'loadArchiveYoung').and.rejectWith(new Error('private fixture'));
    expect(await service.prepare()).toEqual({ ok: false, reason: 'PREPARATION_FAILED' });
    expect(nativeWrite).not.toHaveBeenCalled();
    expect(await log.loadStateCache()).toEqual(before);
  });

  it('returns native write failure without acknowledging success', async () => {
    nativeWrite.and.resolveTo({ ok: false, reason: 'WRITE_FAILED' });
    expect(await service.prepare()).toEqual({ ok: false, reason: 'WRITE_FAILED' });
  });

  it('does not write if the consistency barrier fails', async () => {
    spyOn(
      TestBed.inject(OperationWriteFlushService),
      'flushThenRunExclusive',
    ).and.rejectWith(new Error('timeout'));
    expect((await service.prepare()).ok).toBeFalse();
    expect(nativeWrite).not.toHaveBeenCalled();
  });

  it('reports unavailable outside Electron', async () => {
    window.ea = undefined as unknown as typeof window.ea;
    expect(await service.prepare()).toEqual({ ok: false, reason: 'UNAVAILABLE' });
  });
});
