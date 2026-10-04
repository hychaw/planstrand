import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { clearSessionKeyCache, setArgon2ParamsForTesting } from '@sp/sync-core';
import { SUPER_SYNC_OPERATION_CAPABILITIES } from '@sp/shared-schema';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationLogUploadService } from '../../op-log/sync/operation-log-upload.service';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { CLIENT_ID_PROVIDER } from '../../op-log/util/client-id.provider';
import { SnackService } from '../../core/snack/snack.service';
import {
  OperationSyncCapable,
  SyncOperation,
} from '../../op-log/sync-providers/provider.interface';
import { SyncServerIncompatibleError } from '../../op-log/core/errors/sync-errors';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { syncOpToOperation } from '../../op-log/sync/operation-sync.util';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';
import { addEvent } from './store/event.actions';
import { eventReducer } from './store/event.reducer';
import { LocalEvent } from './event.model';
const event: LocalEvent = {
  id: 'local',
  title: 'Meeting',
  isAllDay: false,
  start: 100,
  end: 200,
  timeZone: 'UTC',
  created: 50,
  modified: 50,
};
describe('Event encrypted sync integration', () => {
  let log: OperationLogStoreService;
  let upload: OperationLogUploadService;
  let provider: jasmine.SpyObj<OperationSyncCapable>;
  let received: SyncOperation[];
  let supported: boolean;
  beforeEach(async () => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
    clearSessionKeyCache();
    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        {
          provide: StateSnapshotService,
          useValue: {
            getStateSnapshotForOperationLog: () =>
              createValidAppData({
                event: { ids: [event.id], entities: { [event.id]: event } },
              }),
          },
        },
        {
          provide: SyncProviderManager,
          useValue: { assertSyncEpochUnchanged: () => undefined },
        },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: { loadClientId: async () => 'client-local' },
        },
        { provide: SnackService, useValue: { open: () => undefined } },
      ],
    });
    log = TestBed.inject(OperationLogStoreService);
    upload = TestBed.inject(OperationLogUploadService);
    await log.init();
    await log._clearAllDataForTesting();
    supported = true;
    received = [];
    provider = jasmine.createSpyObj<OperationSyncCapable>('provider', [
      'getServerSyncCapabilities',
      'getLastServerSeq',
      'setLastServerSeq',
      'uploadOps',
      'downloadOps',
      'getEncryptKey',
    ]);
    provider.supportsOperationSync = true;
    provider.providerMode = 'superSyncOps';
    Object.defineProperty(provider, 'requiresServerCapabilities', { value: true });
    Object.defineProperty(provider, 'isEncryptionMandatory', { value: true });
    provider.getLastServerSeq.and.resolveTo(0);
    (provider.getEncryptKey as jasmine.Spy).and.resolveTo('event-test-key');
    (provider.getServerSyncCapabilities as jasmine.Spy).and.callFake(async () => ({
      kind: 'available',
      capabilities: {
        ...SUPER_SYNC_OPERATION_CAPABILITIES,
        supportedEntityTypes:
          SUPER_SYNC_OPERATION_CAPABILITIES.supportedEntityTypes.filter(
            (t) => supported || t !== 'EVENT',
          ),
      },
    }));
    provider.uploadOps.and.callFake(async (ops) => {
      received.push(...ops);
      return {
        results: ops.map((op) => ({ opId: op.id, accepted: true })),
        latestSeq: received.length,
        newOps: [],
      };
    });
    const action = addEvent({ event });
    const { type, meta, ...actionPayload } = action;
    await log.append(
      new TestClient('client-local').createOperation({
        actionType: type,
        entityType: meta.entityType,
        entityId: event.id,
        opType: meta.opType,
        payload: { actionPayload, entityChanges: [] },
      }),
      'local',
    );
  });
  afterEach(async () => {
    await log._clearAllDataForTesting();
    setArgon2ParamsForTesting();
    clearSessionKeyCache();
  });
  it('uploads EVENT encrypted and replays the decrypted payload on another reader', async () => {
    await upload.uploadPendingOps(provider);
    expect(received.length).toBe(1);
    expect(received[0].isPayloadEncrypted).toBeTrue();
    const decoded = await TestBed.inject(OperationEncryptionService).decryptOperation(
      received[0],
      'event-test-key',
    );
    expect(
      eventReducer(undefined, convertOpToAction(syncOpToOperation(decoded))).entities[
        event.id
      ],
    ).toEqual(event);
    expect(await log.getUnsynced()).toEqual([]);
  });
  it('blocks unsupported EVENT upload while keeping the local operation durable', async () => {
    supported = false;
    await expectAsync(upload.uploadPendingOps(provider)).toBeRejectedWithError(
      SyncServerIncompatibleError,
    );
    expect(provider.uploadOps).not.toHaveBeenCalled();
    expect((await log.getUnsynced()).length).toBe(1);
  });
});
