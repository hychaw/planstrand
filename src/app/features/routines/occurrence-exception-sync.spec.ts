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
import { occurrenceExceptionIntegrityMetaReducer } from '../../root-store/meta/occurrence-exception-integrity.meta-reducer';
import {
  occurrenceExceptionReducer,
  initialOccurrenceExceptionState,
} from './store/occurrence-exception.reducer';
import { setOccurrenceException } from './store/occurrence-exception.actions';
import { occurrenceExceptionId } from './occurrence-exception.validation';
import { OccurrenceExceptionValue } from './occurrence-exception.model';

/** Real conflict detection/resolution and IndexedDB; only Store/applier side
 * effects are adapted to a synchronous reducer harness, as in existing sync specs.
 */
describe('Occurrence exception synchronization', () => {
  let log: OperationLogStoreService;
  let localState: RootState;
  let initial: RootState;
  let reduce: ActionReducer<RootState, Action>;
  const key = { seriesId: 'temporarily-missing', slot: 3 };
  const edit: OccurrenceExceptionValue = {
    kind: 'override',
    event: { title: 'Moved', isAllDay: true, date: '2027-05-01' },
  };
  const cancel: OccurrenceExceptionValue = { kind: 'cancelled' };
  const op = (
    clientId: string,
    value: OccurrenceExceptionValue,
    timestamp: number,
    slot = 3,
  ): Operation => {
    const a = setOccurrenceException({
      occurrenceException: {
        id: occurrenceExceptionId({ ...key, slot }),
        seriesId: key.seriesId,
        slot,
        value,
        modified: timestamp,
      },
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
      occurrenceException: initialOccurrenceExceptionState,
    } as unknown as RootState;
    localState = initial;
    reduce = occurrenceExceptionIntegrityMetaReducer(
      lwwUpdateMetaReducer((s = initial, a) => ({
        ...s,
        occurrenceException: occurrenceExceptionReducer(s.occurrenceException, a),
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
  for (const [localTime, remoteTime] of [
    [100, 200],
    [200, 100],
    [100, 100],
  ]) {
    for (const localValue of [cancel, edit]) {
      it(`converges cancel/edit at ${localTime}/${remoteTime}, local ${localValue.kind}, through durable compensation and restart`, async () => {
        const local = op('client-a', localValue, localTime);
        const remoteValue = localValue.kind === 'cancelled' ? edit : cancel;
        const remote = op('client-b', remoteValue, remoteTime);
        localState = reduce(initial, convertOpToAction(local));
        let remoteState = reduce(initial, convertOpToAction(remote));
        await log.append(local, 'local');
        const detection = await detect(remote);
        expect(detection.conflicts.length).toBe(1);
        const resolution = await TestBed.inject(
          ConflictResolutionService,
        ).autoResolveConflictsLWW(detection.conflicts);
        const localWins = localTime > remoteTime; // Equal timestamps use lexical clientId: b wins.
        expect(resolution.localWinOpsCreated).toBe(localWins ? 1 : 0);
        expect(localState.occurrenceException?.entities[local.entityId!]?.value).toEqual(
          localWins ? localValue : remoteValue,
        );
        for (const entry of await log.getUnsynced()) {
          expect(entry.op.requiredCapabilities).toEqual([ROUTINES_V1]);
          remoteState = reduce(remoteState, convertOpToAction(entry.op));
        }
        expect(remoteState.occurrenceException).toEqual(localState.occurrenceException);
        let restart = initial;
        const rows = await log.getOpsAfterSeq(0);
        for (const row of rows) restart = reduce(restart, convertOpToAction(row.op));
        expect(restart.occurrenceException).toEqual(localState.occurrenceException);
        await log.appendBatchSkipDuplicates(
          rows.map((row) => row.op).reverse(),
          'remote',
        );
        expect((await log.getOpsAfterSeq(0)).length).toBe(rows.length);
        expect(localState.tasks).toBe(initial.tasks);
        expect(localState.workSession).toBe(initial.workSession);
        expect(localState.planning).toBe(initial.planning);
        expect(localState.eventSeries).toBe(initial.eventSeries);
      });
    }
  }
  it('detects no conflict between concurrently edited slots in the same lineage', async () => {
    const local = op('client-a', edit, 100);
    const remote = op('client-b', cancel, 200, 4);
    localState = reduce(initial, convertOpToAction(local));
    await log.append(local, 'local');
    expect((await detect(remote)).conflicts).toEqual([]);
    localState = reduce(localState, convertOpToAction(remote));
    const reordered = reduce(
      reduce(initial, convertOpToAction(remote)),
      convertOpToAction(local),
    );
    expect(reordered.occurrenceException?.entities).toEqual(
      localState.occurrenceException?.entities,
    );
  });
});
