import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { ROUTINES_V1 } from '@sp/shared-schema';
import { ConflictResolutionService } from '../../op-log/sync/conflict-resolution.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationApplierService } from '../../op-log/apply/operation-applier.service';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { OperationLogEffects } from '../../op-log/capture/operation-log.effects';
import { ValidateStateService } from '../../op-log/validation/validate-state.service';
import { SnackService } from '../../core/snack/snack.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { ENTITY_REGISTRY, buildEntityRegistry } from '../../op-log/core/entity-registry';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { Operation } from '../../op-log/core/operation.types';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';
import { RootState } from '../../root-store/root-state';
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { eventSeriesIntegrityMetaReducer } from '../../root-store/meta/event-series-integrity.meta-reducer';
import { eventSeriesReducer } from './store/event-series.reducer';
import {
  addEventSeries,
  deleteEventSeries,
  replaceEventSeriesPlan,
} from './store/event-series.actions';
import { EventSeries } from './event-series.model';
import { validateOperationPayload } from '../../op-log/validation/validate-operation-payload';
import { buildReplacementOperation } from '../../op-log/sync/build-replacement-operation';
import { projectEventOccurrences } from '../schedule/project-event-occurrences';

describe('EventSeries complete-plan synchronization and terminal deletion', () => {
  let log: OperationLogStoreService;
  let localState: RootState;
  let initial: RootState;
  let reduce: ActionReducer<RootState, Action>;
  const series: EventSeries = {
    id: 'series',
    title: 'Original',
    created: 1,
    modified: 1,
    segments: [
      {
        id: 'first',
        recurrence: { frequency: 'daily', startDate: '2026-01-01', interval: 1 },
        timing: { kind: 'allDay' },
      },
    ],
  };
  const op = (
    clientId: string,
    timestamp: number,
    mode: 'weekly' | 'monthly' | 'delete' | 'compensated-delete',
  ): Operation => {
    const next: EventSeries = {
      ...series,
      title: mode,
      modified: timestamp,
      segments: [
        series.segments[0],
        {
          id: mode,
          logicalSlotOffset: mode === 'weekly' ? 3 : 5,
          recurrence: {
            frequency: mode === 'weekly' ? 'weekly' : 'monthly',
            startDate: '2026-02-02',
            interval: 2,
            ...(mode === 'weekly' ? { weekdays: [1, 5] } : {}),
          } as EventSeries['segments'][number]['recurrence'],
          timing: { kind: 'allDay' },
        },
      ],
    };
    if (mode === 'compensated-delete')
      return buildReplacementOperation(
        'EVENT_SERIES',
        series.id,
        { ...next, deletedAt: timestamp },
        clientId,
        { [clientId]: 1 },
        timestamp,
      );
    const a =
      mode === 'delete'
        ? deleteEventSeries({ eventSeries: { ...next, deletedAt: timestamp } })
        : replaceEventSeriesPlan({
            id: series.id,
            plan: { title: next.title, segments: next.segments },
            modified: timestamp,
          });
    const { type, meta, ...actionPayload } = a;
    return {
      ...new TestClient(clientId).createOperation({
        actionType: type,
        entityType: meta.entityType,
        entityId: meta.entityId,
        opType: meta.opType,
        payload: { actionPayload, entityChanges: [] },
      }),
      timestamp,
    };
  };
  beforeEach(async () => {
    const data = createValidAppData();
    initial = {
      ...data,
      tasks: data.task,
      eventSeries: eventSeriesReducer(undefined, addEventSeries({ eventSeries: series })),
    } as unknown as RootState;
    localState = initial;
    reduce = eventSeriesIntegrityMetaReducer(
      lwwUpdateMetaReducer((s = initial, a) => ({
        ...s,
        eventSeries: eventSeriesReducer(s.eventSeries, a),
      })),
    );
    const store = jasmine.createSpyObj<Store>('Store', ['select']);
    store.select.and.callFake(
      (selector: unknown, props?: unknown) =>
        of(
          typeof selector === 'function' ? selector(localState, props) : undefined,
        ) as ReturnType<Store['select']>,
    );
    const applier = jasmine.createSpyObj<OperationApplierService>(
      'OperationApplierService',
      ['applyOperations'],
    );
    applier.applyOperations.and.callFake(async (ops, options) => {
      for (const operation of ops)
        localState = reduce(localState, convertOpToAction(operation));
      await options?.onReducersCommitted?.(ops);
      return { appliedOps: ops };
    });
    const validate = jasmine.createSpyObj<ValidateStateService>('ValidateStateService', [
      'validateAndRepairCurrentState',
    ]);
    validate.validateAndRepairCurrentState.and.resolveTo(true);
    const effects = jasmine.createSpyObj<OperationLogEffects>('OperationLogEffects', [
      'processDeferredActions',
    ]);
    effects.processDeferredActions.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        OperationLogStoreService,
        OperationCaptureService,
        { provide: Store, useValue: store },
        { provide: OperationApplierService, useValue: applier },
        { provide: ValidateStateService, useValue: validate },
        { provide: OperationLogEffects, useValue: effects },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj<SnackService>('SnackService', ['open']),
        },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: {
            loadClientId: async () => 'client-a',
            getOrGenerateClientId: async () => 'client-a',
            clearCache: () => {},
          },
        },
        { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
        { provide: StateSnapshotService, useValue: {} },
      ],
    });
    log = TestBed.inject(OperationLogStoreService);
    await log.init();
    await log._clearAllDataForTesting();
  });
  afterEach(async () => {
    await log._clearAllDataForTesting();
    TestBed.resetTestingModule();
  });
  const detect = async (
    remote: Operation,
  ): ReturnType<ConflictResolutionService['checkOpForConflicts']> =>
    TestBed.inject(ConflictResolutionService).checkOpForConflicts(remote, {
      localPendingOpsByEntity: await log.getUnsyncedByEntity(),
      appliedFrontierByEntity: new Map(),
      retainedOpsByEntity: new Map(),
      snapshotVectorClock: undefined,
      snapshotEntityKeys: undefined,
      hasNoSnapshotClock: true,
    });

  for (const [localMode, remoteMode, localTime, remoteTime, localWins] of [
    ['delete', 'compensated-delete', 100, 200, false],
    ['delete', 'compensated-delete', 200, 100, true],
    ['delete', 'compensated-delete', 100, 100, false],
    ['weekly', 'monthly', 100, 200, false],
    ['weekly', 'monthly', 200, 100, true],
    ['weekly', 'monthly', 100, 100, false],
    ['monthly', 'weekly', 200, 100, true],
    ['delete', 'weekly', 100, 200, true],
    ['weekly', 'delete', 200, 100, false],
    ['compensated-delete', 'monthly', 100, 200, true],
    ['monthly', 'compensated-delete', 200, 100, false],
  ] as const) {
    it(`converges ${localMode}/${remoteMode} at ${localTime}/${remoteTime} through durable compensation and replay`, async () => {
      const local = op('client-a', localTime, localMode);
      const remote = op('client-b', remoteTime, remoteMode);
      expect(validateOperationPayload(local).success).toBeTrue();
      expect(validateOperationPayload(remote).success).toBeTrue();
      localState = reduce(initial, convertOpToAction(local));
      let remoteState = reduce(initial, convertOpToAction(remote));
      const expected = localWins ? localState.eventSeries : remoteState.eventSeries;
      await log.append(local, 'local');
      const detection = await detect(remote);
      expect(detection.conflicts.length).toBe(1);
      const result = await TestBed.inject(
        ConflictResolutionService,
      ).autoResolveConflictsLWW(detection.conflicts);
      expect(result.localWinOpsCreated).toBe(localWins ? 1 : 0);
      expect(localState.eventSeries).toEqual(expected);
      for (const row of await log.getUnsynced()) {
        expect(validateOperationPayload(row.op).success).toBeTrue();
        expect(row.op.requiredCapabilities).toEqual([ROUTINES_V1]);
        remoteState = reduce(remoteState, convertOpToAction(row.op));
      }
      expect(remoteState.eventSeries).toEqual(expected);
      let restart = initial;
      const rows = await log.getOpsAfterSeq(0);
      for (const row of rows) restart = reduce(restart, convertOpToAction(row.op));
      expect(restart.eventSeries).toEqual(expected);
      await log.appendBatchSkipDuplicates(rows.map((r) => r.op).reverse(), 'remote');
      expect((await log.getOpsAfterSeq(0)).length).toBe(rows.length);
      const winner = expected!.entities[series.id]!;
      if (winner.deletedAt !== undefined) {
        expect(
          projectEventOccurrences(
            [winner],
            { fromDate: '2026-01-01', toDateExclusive: '2027-01-01' },
            'UTC',
          ),
        ).toEqual([]);
      }
      expect(localState.tasks).toBe(initial.tasks);
      expect(localState.workSession).toBe(initial.workSession);
      expect(localState.planning).toBe(initial.planning);
      expect(localState.event).toBe(initial.event);
      expect(localState.occurrenceException).toBe(initial.occurrenceException);
    });
  }
});
