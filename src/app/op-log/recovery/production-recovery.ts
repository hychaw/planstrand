import '@angular/compiler';
import { Injector } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { BehaviorSubject, map } from 'rxjs';
import { FEATURE_STORE_REDUCERS } from '../../root-store/feature-store-reducers';
import { META_REDUCERS } from '../../root-store/meta/meta-reducer-registry';
import { reducerFailureGuardMetaReducer } from '../../root-store/meta/reducer-failure-guard.meta-reducer';
import { operationCaptureMetaReducer } from '../capture/operation-capture.meta-reducer';
import { OperationApplierService } from '../apply/operation-applier.service';
import { ArchiveOperationHandler } from '../apply/archive-operation-handler.service';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { ArchiveStoreService } from '../persistence/archive-store.service';
import { IndexedDbOpLogAdapter } from '../persistence/indexed-db-op-log-adapter';
import { OP_LOG_DB_ADAPTER_FACTORY } from '../persistence/op-log-db-adapter.token';
import { ArchiveService } from '../../features/archive/archive.service';
import { TaskArchiveService } from '../../features/archive/task-archive.service';
import { LockService } from '../sync/lock.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import {
  StateSnapshotService,
  SNAPSHOT_SELECTORS,
} from '../backup/state-snapshot.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import {
  Operation,
  FULL_STATE_OP_TYPES,
  extractActionPayload,
} from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';
import { TaskSharedActions as T } from '../../root-store/meta/task-shared.actions';
import { validateRecoverySnapshot } from '../validation/validate-recovery-snapshot';
import { validateOperationPayload } from '../validation/validate-operation-payload';
import {
  getOperationTaskReplayContext,
  getOperationTaskReplayContexts,
  TASK_CONTEXT_ACTIONS,
} from '../core/task-replay-context';
import { applyFolderRecoveryOperation } from '../../features/folder/folder-recovery';
import { applyWorkSessionRecoveryOperation } from '../../features/work-session/work-session-recovery';
import { applyRoutinesRecoveryOperation } from '../../features/routines/routines-recovery';
import {
  CLIENT_SYNC_READER_CAPABILITIES,
  supportsRequiredCapabilities,
  getFullStateRequiredCapabilities,
  isPlanningState,
  CURRENT_SCHEMA_VERSION,
  migrateOperation,
} from '@sp/shared-schema';
import { flushYoungToOld } from '../../features/archive/store/archive.actions';
import { validateFull, appDataValidators } from '../validation/validation-fn';
import { AppDataComplete } from '../model/model-config';
import { isValidEntityId } from '../validation/is-valid-entity-id';
import { isValidDBDateStr } from '../../util/get-db-date-str';

const validatePersistedState = (value: unknown): void => {
  validateRecoverySnapshot(value as Record<string, unknown>);
  const state = value as AppDataComplete;
  if (
    !validateFull(state).isValid ||
    !appDataValidators.archiveYoung(state.archiveYoung).success ||
    !appDataValidators.archiveOld(state.archiveOld).success
  )
    throw new Error('RECOVERY_INVALID_PERSISTED_STATE');
};

export interface RecoveryOperation extends Operation {
  serverSeq: number;
}
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const assertSize = (value: unknown): void => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 100 * 1024 * 1024)
    throw new Error('RECOVERY_STATE_TOO_LARGE');
};
const timestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const fail: () => never = () => {
  throw new Error('RECOVERY_UNSUPPORTED_OPERATION');
};
const taskActions = new Map<string, string>([
  [T.addTask.type, 'CRT'],
  [T.updateTask.type, 'UPD'],
  [T.updateTasks.type, 'UPD'],
  [T.deleteTask.type, 'DEL'],
  [T.deleteTasks.type, 'DEL'],
  [T.moveToArchive.type, 'UPD'],
  [T.restoreTask.type, 'UPD'],
  [T.scheduleTaskWithTime.type, 'UPD'],
  [T.reScheduleTaskWithTime.type, 'UPD'],
  [T.unscheduleTask.type, 'UPD'],
  [T.convertToMainTask.type, 'UPD'],
  [T.convertToSubTask.type, 'UPD'],
  [flushYoungToOld.type, 'BATCH'],
  [T.batchUpdateForProject.type, 'BATCH'],
]);
const eventActions = new Map<string, string>([
  ['[Event] Add Event', 'CRT'],
  ['[Event] Update Event', 'UPD'],
  ['[Event] Remove Event', 'DEL'],
]);
const familyPattern =
  /^\[(Folder|FOLDER|WorkSession|EventSeries|OccurrenceException|WeeklyTemplate|EVENT_SERIES|OCCURRENCE_EXCEPTION|WEEKLY_TEMPLATE)\]/;

/** Admission is deliberately stricter than the client's tolerant download path. */
const admit = (op: RecoveryOperation): void => {
  if (
    op.schemaVersion !== CURRENT_SCHEMA_VERSION ||
    !record(op.payload) ||
    !supportsRequiredCapabilities(
      op.requiredCapabilities,
      CLIENT_SYNC_READER_CAPABILITIES,
    )
  )
    fail();
  if (
    Object.hasOwn(op.payload, 'actionPayload') &&
    (!record(op.payload.actionPayload) ||
      !Array.isArray(op.payload.entityChanges) ||
      op.payload.entityChanges.length)
  )
    fail();
  if (!validateOperationPayload(op).success) fail();
  const body = extractActionPayload(op.payload);
  if (!record(body)) fail();
  if (taskActions.has(op.actionType)) {
    if (
      op.opType !== taskActions.get(op.actionType) ||
      op.entityType !==
        (op.actionType === T.batchUpdateForProject.type
          ? 'PROJECT'
          : op.actionType === flushYoungToOld.type
            ? 'ALL'
            : 'TASK')
    )
      fail();
    if (
      TASK_CONTEXT_ACTIONS.includes(op.actionType) &&
      !getOperationTaskReplayContext(op)
    )
      fail();
    if (op.actionType === T.updateTasks.type && !getOperationTaskReplayContexts(op))
      fail();
    if (op.actionType === T.moveToArchive.type && !body['archiveCommand']) fail();
    if (
      op.actionType === T.scheduleTaskWithTime.type ||
      op.actionType === T.reScheduleTaskWithTime.type
    ) {
      if (
        !record(body['task']) ||
        body['task'].id !== op.entityId ||
        !isValidEntityId(op.entityId) ||
        !timestamp(body['dueWithTime']) ||
        typeof body['isMoveToBacklog'] !== 'boolean' ||
        (body['remindAt'] !== undefined && !timestamp(body['remindAt']))
      )
        fail();
    }
    if (op.actionType === T.unscheduleTask.type) {
      if (
        !isValidEntityId(body['id']) ||
        body['id'] !== op.entityId ||
        (body['isLeaveInToday'] !== undefined &&
          typeof body['isLeaveInToday'] !== 'boolean') ||
        (body['today'] !== undefined &&
          (typeof body['today'] !== 'string' || !isValidDBDateStr(body['today'])))
      )
        fail();
    }
    if (op.actionType === T.convertToSubTask.type) {
      if (
        !isValidEntityId(body['taskId']) ||
        body['taskId'] !== op.entityId ||
        !isValidEntityId(body['targetParentId']) ||
        (body['afterTaskId'] !== null && !isValidEntityId(body['afterTaskId']))
      )
        fail();
    }
    if (op.actionType === T.convertToMainTask.type) {
      if (
        !record(body['task']) ||
        !isValidEntityId(body['task'].id) ||
        body['task'].id !== op.entityId ||
        (body['today'] !== undefined &&
          (typeof body['today'] !== 'string' || !isValidDBDateStr(body['today']))) ||
        (body['modified'] !== undefined && !timestamp(body['modified'])) ||
        (body['doneOn'] !== undefined && !timestamp(body['doneOn'])) ||
        (body['isDone'] !== undefined && typeof body['isDone'] !== 'boolean') ||
        (body['isPlanForToday'] !== undefined &&
          typeof body['isPlanForToday'] !== 'boolean')
      )
        fail();
    }
    if (op.actionType === T.addTask.type) {
      // Legacy scheduling fields do not capture handleAddTask's source calendar.
      if (
        !record(body['task']) ||
        !timestamp(body['task'].created) ||
        body['task'].dueDay ||
        body['task'].dueWithTime ||
        body['task'].deadlineDay ||
        body['task'].deadlineWithTime
      )
        fail();
    }
    if (op.actionType === T.batchUpdateForProject.type) {
      if (!record(body['createdTaskIds']) || !Array.isArray(body['operations'])) fail();
      for (const member of body['operations']) {
        if (
          !record(member) ||
          !['create', 'update', 'delete', 'reorder'].includes(member['type'])
        )
          fail();
        if (
          member['type'] === 'create' &&
          (!timestamp(body['createdTaskTimestamp']) ||
            !body['createdTaskIds'][member['tempId']])
        )
          fail();
      }
    }
    return;
  }
  if (op.entityType === 'TASK' && (op.actionType as string) === '[TASK] LWW Update') {
    if (
      op.opType !== 'UPD' ||
      !['patch', 'replace'].includes(op.payload['lwwUpdateMode']) ||
      !getOperationTaskReplayContext(op)
    )
      fail();
    return;
  }
  if (
    op.entityType === 'PROJECT' &&
    ((op.actionType === '[Project] Add Project' && op.opType === 'CRT') ||
      (op.actionType === '[Project] Update Project' && op.opType === 'UPD'))
  ) {
    if (
      !record(body['project']) ||
      !isValidEntityId(body['project'].id) ||
      body['project'].id !== op.entityId ||
      (op.entityIds !== undefined && op.entityIds.length > 1) ||
      (op.opType === 'UPD' && !record(body['project'].changes))
    )
      fail();
    return;
  }
  // Follow-up operations emitted by Project creation and Today retention.
  if (op.actionType === '[MenuTree] Update Project Tree') {
    if (
      op.entityType !== 'MENU_TREE' ||
      op.opType !== 'UPD' ||
      op.entityId !== 'projectTree' ||
      !Array.isArray(body['tree'])
    )
      fail();
    return;
  }
  if (op.actionType === '[Tag] Update Tag') {
    if (
      op.entityType !== 'TAG' ||
      op.opType !== 'UPD' ||
      !record(body['tag']) ||
      !isValidEntityId(body['tag'].id) ||
      body['tag'].id !== op.entityId ||
      !record(body['tag'].changes)
    )
      fail();
    return;
  }
  if (
    eventActions.has(op.actionType) &&
    op.entityType === 'EVENT' &&
    eventActions.get(op.actionType) === op.opType
  )
    return;
  if (
    familyPattern.test(op.actionType) &&
    [
      'FOLDER',
      'WORK_SESSION',
      'EVENT_SERIES',
      'OCCURRENCE_EXCEPTION',
      'WEEKLY_TEMPLATE',
    ].includes(op.entityType)
  )
    return;
  if (
    op.entityType === 'PLANNING' &&
    op.opType === 'PLANNING_V1' &&
    ['[Planning] Set Placement', '[Planning] Remove Placement'].includes(op.actionType)
  )
    return;
  fail();
};

/** A disposable browser owns the store, locks and real IndexedDB for this run. */
export const replayRecoveryHistory = async (
  rows: RecoveryOperation[],
): Promise<Record<string, unknown>> => {
  assertSize(rows);
  const requirements = new Set<string>();
  let hasAuthority = false;
  const operations: RecoveryOperation[] = [];
  for (const row of rows) {
    for (const capability of row.requiredCapabilities ?? []) requirements.add(capability);
    if (FULL_STATE_OP_TYPES.has(row.opType)) {
      if (hasAuthority && row.schemaVersion < 5)
        throw new Error('LEGACY_FULL_STATE_AFTER_CUTOVER');
      if (row.opType === 'REPAIR' && row.repairBaseServerSeq !== row.serverSeq - 1)
        throw new Error('LEGACY_REPAIR_REPLAY_UNSUPPORTED');
      const migration = migrateOperation(row, CURRENT_SCHEMA_VERSION);
      if (!migration.success || !migration.data || Array.isArray(migration.data)) fail();
      const op = migration.data as RecoveryOperation;
      const outer = op.payload;
      const snapshot =
        record(outer) && Object.hasOwn(outer, 'appDataComplete')
          ? outer['appDataComplete']
          : outer;
      if (!record(snapshot)) fail();
      validateRecoverySnapshot(snapshot);
      const modelKeys = new Set<string>([
        ...SNAPSHOT_SELECTORS.map(({ key }) => key),
        'archiveYoung',
        'archiveOld',
        'requiredCapabilities',
      ]);
      if (Object.keys(snapshot).some((key) => !modelKeys.has(key))) fail();
      for (const capability of [
        ...getFullStateRequiredCapabilities(outer),
        ...getFullStateRequiredCapabilities(snapshot),
      ])
        requirements.add(capability);
      hasAuthority = isPlanningState(snapshot['planning']);
      operations.push(op);
    } else {
      if (!operations.length) throw new Error('RECOVERY_MISSING_COMPLETE_BASE');
      admit(row);
      operations.push(row);
    }
  }
  if (!supportsRequiredCapabilities([...requirements], CLIENT_SYNC_READER_CAPABILITIES))
    fail();
  const subject = new BehaviorSubject<Record<string, any>>({});
  const snapshotFromRoot = (root: object): Record<string, unknown> =>
    Object.fromEntries(
      SNAPSHOT_SELECTORS.map(({ key, selector }) => [key, selector(root)]),
    );
  const base = (
    state: Record<string, any> | undefined,
    action: Action,
  ): Record<string, any> => {
    const persistent = action as PersistentAction;
    // Retain the existing strict family contracts at the actual chronological
    // reducer boundary, where Task/WorkSession relationships have their true base.
    if (familyPattern.test(action.type)) {
      const { type, meta, ...body } = persistent;
      const row = {
        serverSeq: 0,
        actionType: type,
        entityType: meta.entityType,
        entityId: meta.entityId ?? null,
        entityIds: meta.entityIds,
        opType: meta.opType,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        isPayloadEncrypted: false,
        payload: {
          actionPayload: body,
          entityChanges: [],
          ...(meta.lwwUpdateMode ? { lwwUpdateMode: meta.lwwUpdateMode } : {}),
        },
      };
      const snapshot = structuredClone(snapshotFromRoot(state ?? {}));
      if (
        !(
          applyFolderRecoveryOperation(snapshot, row) ||
          applyWorkSessionRecoveryOperation(snapshot, row) ||
          applyRoutinesRecoveryOperation(snapshot, row)
        )
      )
        fail();
    }
    const next = { ...state };
    for (const [key, reducer] of Object.entries(FEATURE_STORE_REDUCERS))
      next[key] = reducer(state?.[key], action);
    assertSize(snapshotFromRoot(next));
    return next;
  };
  const reduce = META_REDUCERS.filter(
    (meta) =>
      meta !== operationCaptureMetaReducer && meta !== reducerFailureGuardMetaReducer,
  ).reduceRight((inner, meta) => meta(inner), base);
  const store = {
    select: (selector: (root: object) => unknown) => subject.pipe(map(selector)),
    dispatch: (action: Action) => subject.next(reduce(subject.value, action)),
  };
  const injector = Injector.create({
    providers: [
      OperationApplierService,
      ArchiveOperationHandler,
      ArchiveDbAdapter,
      ArchiveStoreService,
      ArchiveService,
      TaskArchiveService,
      LockService,
      StateSnapshotService,
      { provide: Store, useValue: store },
      { provide: OP_LOG_DB_ADAPTER_FACTORY, useValue: () => new IndexedDbOpLogAdapter() },
      {
        provide: HydrationStateService,
        useValue: {
          startApplyingRemoteOps: () => {},
          startPostSyncCooldown: () => {},
          endApplyingRemoteOps: () => {},
        },
      },
      { provide: CLIENT_ID_PROVIDER, useValue: { loadClientId: async () => null } },
      {
        provide: OperationLogStoreService,
        useValue: { getRequiredCapabilities: async () => [...requirements].sort() },
      },
      { provide: TaskTimeSyncService, useValue: {} },
      { provide: OperationCaptureService, useValue: {} },
    ],
  });
  try {
    store.dispatch({ type: '@recovery/init' });
    const applier = injector.get(OperationApplierService);
    const snapshots = injector.get(StateSnapshotService);
    const archiveHandler = injector.get(ArchiveOperationHandler);
    const handleArchive = archiveHandler.handleOperation.bind(archiveHandler);
    archiveHandler.handleOperation = async (action) => {
      await handleArchive(action);
      assertSize(await snapshots.getStateSnapshotAsync());
    };
    // A verified replacement starts a new window. Never split a tail into rows:
    // the production batch pre-scan must see every archive/delete/LWW together.
    let cursor = 0;
    while (cursor < operations.length) {
      const replacement = operations[cursor++];
      if (!FULL_STATE_OP_TYPES.has(replacement.opType)) fail();
      const loaded = await applier.applyOperations([replacement], {
        skipDeferredLocalActions: true,
      });
      if (
        loaded.failedOp ||
        loaded.reducerFailures?.length ||
        loaded.appliedOps.length !== 1
      )
        throw new Error('RECOVERY_PRODUCTION_REPLAY_FAILED');
      const boundary = await snapshots.getStateSnapshotAsync();
      validatePersistedState(boundary);
      const incoming = extractActionPayload(replacement.payload);
      const full = (incoming['appDataComplete'] ?? incoming) as Record<string, unknown>;
      if (
        JSON.stringify(boundary.archiveYoung) !== JSON.stringify(full['archiveYoung']) ||
        JSON.stringify(boundary.archiveOld) !== JSON.stringify(full['archiveOld'])
      )
        throw new Error('RECOVERY_ARCHIVE_REPLACEMENT_REFUSED');
      const start = cursor;
      while (
        cursor < operations.length &&
        !FULL_STATE_OP_TYPES.has(operations[cursor].opType)
      )
        cursor++;
      const window = operations.slice(start, cursor);
      // Production compensation cannot relocate a winner from an existing archive.
      // A move inside this window is handled by the applier's whole-window pre-scan.
      if (
        window.some(
          (op) =>
            (op.actionType as string) === '[TASK] LWW Update' &&
            op.entityId &&
            (boundary.archiveYoung.task.entities[op.entityId] ||
              boundary.archiveOld.task.entities[op.entityId]),
        )
      )
        fail();
      const result = await applier.applyOperations(window, {
        skipDeferredLocalActions: true,
      });
      if (
        result.failedOp ||
        result.reducerFailures?.length ||
        result.appliedOps.length !== window.length
      )
        throw new Error('RECOVERY_PRODUCTION_REPLAY_FAILED');
      validatePersistedState(await snapshots.getStateSnapshotAsync());
    }
    return (await snapshots.getStateSnapshotAsync()) as unknown as Record<
      string,
      unknown
    >;
  } finally {
    injector.destroy();
    subject.complete();
  }
};
(
  window as unknown as { replayRecoveryHistory: typeof replayRecoveryHistory }
).replayRecoveryHistory = replayRecoveryHistory;
