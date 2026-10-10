import { eventSeriesReducer } from './store/event-series.reducer';
import { addEventSeries, replaceEventSeriesPlan } from './store/event-series.actions';
import { EventSeries } from './event-series.model';
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
import { weeklyTemplateReducer } from './store/weekly-template.reducer';
import {
  addWeeklyTemplate,
  deleteWeeklyTemplate,
  updateWeeklyTemplate,
} from './store/weekly-template.actions';
import { WeeklyTemplate } from './weekly-template.model';
import { validateOperationPayload } from '../../op-log/validation/validate-operation-payload';
import { buildReplacementOperation } from '../../op-log/sync/build-replacement-operation';
import { projectEventOccurrences } from '../schedule/project-event-occurrences';

describe('WeeklyTemplate synchronization and terminal deletion', () => {
  let log: OperationLogStoreService;
  let localState: RootState;
  let initial: RootState;
  let reduce: ActionReducer<RootState, Action>;
  const series: WeeklyTemplate = {
    id: 'template',
    title: 'Original',
    isActive: true,
    startDate: '2026-01-01',
    created: 1,
    modified: 1,
  };
  const op = (
    clientId: string,
    timestamp: number,
    mode: 'weekly' | 'monthly' | 'delete' | 'compensated-delete',
  ): Operation => {
    const next: WeeklyTemplate = {
      ...series,
      title: mode,
      modified: timestamp,
      startDate: mode === 'weekly' ? '2026-02-02' : '2026-03-03',
    };
    if (mode === 'compensated-delete')
      return buildReplacementOperation(
        'WEEKLY_TEMPLATE',
        series.id,
        { ...next, deletedAt: timestamp },
        clientId,
        { [clientId]: 1 },
        timestamp,
      );
    const a =
      mode === 'delete'
        ? deleteWeeklyTemplate({ weeklyTemplate: { ...next, deletedAt: timestamp } })
        : updateWeeklyTemplate({
            id: series.id,
            changes: {
              title: next.title,
              isActive: next.isActive,
              startDate: next.startDate,
            },
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
      weeklyTemplate: weeklyTemplateReducer(
        undefined,
        addWeeklyTemplate({ weeklyTemplate: series }),
      ),
    } as unknown as RootState;
    localState = initial;
    reduce = eventSeriesIntegrityMetaReducer(
      lwwUpdateMetaReducer((s = initial, a) => ({
        ...s,
        eventSeries: eventSeriesReducer(s.eventSeries, a),
        weeklyTemplate: weeklyTemplateReducer(s.weeklyTemplate, a),
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

  it('syncs concurrent independent entry edits without parent conflicts or duplicate Events', async () => {
    const child: EventSeries = {
      id: 'entry-a',
      templateId: series.id,
      title: 'Entry',
      created: 1,
      modified: 1,
      segments: [
        {
          id: 'segment-a',
          recurrence: {
            frequency: 'weekly',
            interval: 1,
            startDate: '2026-01-01',
            weekdays: [1],
          },
          timing: { kind: 'allDay' },
        },
      ],
    };
    initial = reduce(initial, addEventSeries({ eventSeries: child }));
    initial = reduce(
      initial,
      addEventSeries({
        eventSeries: {
          ...child,
          id: 'entry-b',
          segments: [{ ...child.segments[0], id: 'segment-b' }],
        },
      }),
    );
    const edit = (id: string, client: string): Operation => {
      const current = initial.eventSeries!.entities[id]!;
      const { type, meta, ...actionPayload } = replaceEventSeriesPlan({
        id,
        plan: { title: client, segments: current.segments },
        modified: 2,
      });
      return new TestClient(client).createOperation({
        actionType: type,
        entityType: meta.entityType,
        entityId: id,
        opType: meta.opType,
        payload: { actionPayload, entityChanges: [] },
      });
    };
    const local = edit('entry-a', 'client-a');
    const remote = edit('entry-b', 'client-b');
    localState = reduce(initial, convertOpToAction(local));
    await log.append(local, 'local');
    expect((await detect(remote)).conflicts).toEqual([]);
    localState = reduce(localState, convertOpToAction(remote));
    const reordered = reduce(
      reduce(initial, convertOpToAction(remote)),
      convertOpToAction(local),
    );
    expect(localState).toEqual(reordered);
    expect(localState.eventSeries!.entities['entry-a']!.title).toBe('client-a');
    expect(localState.eventSeries!.entities['entry-b']!.title).toBe('client-b');
    expect(localState.weeklyTemplate).toBe(initial.weeklyTemplate);
    expect(localState.tasks).toBe(initial.tasks);
    expect(localState.workSession).toBe(initial.workSession);
    expect(localState.planning).toBe(initial.planning);
    expect(localState.event).toBe(initial.event);
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
      const expected = localWins ? localState.weeklyTemplate : remoteState.weeklyTemplate;
      await log.append(local, 'local');
      const detection = await detect(remote);
      expect(detection.conflicts.length).toBe(1);
      const result = await TestBed.inject(
        ConflictResolutionService,
      ).autoResolveConflictsLWW(detection.conflicts);
      expect(result.localWinOpsCreated).toBe(localWins ? 1 : 0);
      expect(localState.weeklyTemplate).toEqual(expected);
      for (const row of await log.getUnsynced()) {
        expect(validateOperationPayload(row.op).success).toBeTrue();
        expect(row.op.requiredCapabilities).toEqual([ROUTINES_V1]);
        remoteState = reduce(remoteState, convertOpToAction(row.op));
      }
      expect(remoteState.weeklyTemplate).toEqual(expected);
      let restart = initial;
      const rows = await log.getOpsAfterSeq(0);
      for (const row of rows) restart = reduce(restart, convertOpToAction(row.op));
      expect(restart.weeklyTemplate).toEqual(expected);
      await log.appendBatchSkipDuplicates(rows.map((r) => r.op).reverse(), 'remote');
      expect((await log.getOpsAfterSeq(0)).length).toBe(rows.length);
      const winner = expected!.entities[series.id]!;
      if (winner.deletedAt !== undefined) {
        expect(
          projectEventOccurrences(
            [
              {
                id: 'child',
                templateId: winner.id,
                title: 'Entry',
                created: 1,
                modified: 1,
                segments: [
                  {
                    id: 'segment',
                    recurrence: {
                      frequency: 'weekly',
                      interval: 1,
                      startDate: '2026-01-01',
                      weekdays: [1],
                    },
                    timing: { kind: 'allDay' },
                  },
                ],
              },
            ],
            { fromDate: '2026-01-01', toDateExclusive: '2027-01-01' },
            'UTC',
            [],
            [winner],
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
