import { dataRepair } from '../../op-log/validation/data-repair';
import {
  addTaskToAppData,
  createValidAppData,
  createValidTask,
} from '../../op-log/validation/state-validity-test-utils';
import { validateFull } from '../../op-log/validation/validation-fn';
import { WorkSession } from './work-session.model';
import { AppDataComplete, withDefaultModelSlices } from '../../op-log/model/model-config';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import {
  initialWorkSessionState,
  workSessionReducer,
} from './store/work-session.reducer';
import {
  loadAllDataFailureGuardMetaReducer,
  runWithLoadAllDataFailureCollector,
} from '../../op-log/apply/load-all-data-failure-guard.meta-reducer';

const validSession = (overrides: Partial<WorkSession> = {}): WorkSession => ({
  id: 'session-1',
  taskId: 'task-1',
  start: 100,
  end: 200,
  created: 50,
  modified: 50,
  ...overrides,
});

const dataWithSession = (session: WorkSession): AppDataComplete => {
  const data = addTaskToAppData(createValidAppData(), createValidTask('task-1'));
  data.workSession = {
    ids: [session.id],
    entities: { [session.id]: session },
  };
  return data;
};

describe('WorkSession persisted-state validation', () => {
  it('rejects dangling records even when a malformed Task ID list claims the Task exists', () => {
    const data = dataWithSession(validSession());
    data.task.entities = {};
    expect(() =>
      workSessionReducer(initialWorkSessionState, loadAllData({ appDataComplete: data })),
    ).toThrowError('Invalid WorkSession state');
    expect(data.workSession.entities['session-1']).toEqual(validSession());
  });

  it('defaults an absent legacy slice but hydrates valid present data unchanged', () => {
    const data = dataWithSession(validSession());
    expect(
      workSessionReducer(initialWorkSessionState, loadAllData({ appDataComplete: data })),
    ).toBe(data.workSession);
    const legacy: Partial<AppDataComplete> = { ...data };
    delete legacy.workSession;
    expect(
      workSessionReducer(
        data.workSession,
        loadAllData({ appDataComplete: legacy as AppDataComplete }),
      ),
    ).toBe(initialWorkSessionState);
  });

  it('preserves prior state and incoming data through the existing load failure guard', () => {
    const previous = dataWithSession(validSession()).workSession;
    const future = { ...validSession({ id: 'future' }), timeZone: 'UTC' };
    const incoming = dataWithSession(future);
    const collector = jasmine.createSpy('load failure');
    const guarded = loadAllDataFailureGuardMetaReducer(workSessionReducer);
    const result = runWithLoadAllDataFailureCollector(collector, () =>
      guarded(previous, loadAllData({ appDataComplete: incoming })),
    );
    expect(result).toBe(previous);
    expect(collector).toHaveBeenCalledOnceWith(jasmine.any(Error));
    expect(incoming.workSession.entities['future']).toEqual(future);
  });

  it('rejects empty identities, malformed normalized containers and invalid completion values', () => {
    for (const changes of [
      { id: '' },
      { taskId: '' },
      { completedAt: Infinity },
      { modified: -1 },
    ]) {
      expect(validateFull(dataWithSession(validSession(changes))).isValid).toBeFalse();
    }
    const data = dataWithSession(validSession());
    data.workSession = {
      ids: 'invalid',
      entities: [],
    } as unknown as typeof data.workSession;
    expect(validateFull(data).isValid).toBeFalse();
  });
  it('accepts the exact Phase 1 shape', () => {
    expect(validateFull(dataWithSession(validSession())).isValid).toBeTrue();
  });

  it('rejects a dangling Task reference', () => {
    const data = dataWithSession(validSession({ taskId: 'missing' }));

    expect(validateFull(data).isValid).toBeFalse();
  });

  it('rejects invalid ranges and non-finite timestamps', () => {
    expect(validateFull(dataWithSession(validSession({ end: 100 }))).isValid).toBeFalse();
    expect(
      validateFull(dataWithSession(validSession({ start: Number.NaN }))).isValid,
    ).toBeFalse();
  });

  it('rejects future persisted fields', () => {
    const session = {
      ...validSession(),
      timeZone: 'Europe/Berlin',
    } as WorkSession;

    expect(validateFull(dataWithSession(session)).isValid).toBeFalse();
  });

  it('rejects duplicate IDs, unlisted entities and mismatched entity IDs', () => {
    const duplicate = dataWithSession(validSession());
    duplicate.workSession.ids.push('session-1');
    expect(validateFull(duplicate).isValid).toBeFalse();
    const unlisted = dataWithSession(validSession());
    unlisted.workSession.ids = [];
    expect(validateFull(unlisted).isValid).toBeFalse();
    const mismatched = dataWithSession(validSession());
    mismatched.workSession.entities['session-1']!.id = 'other';
    expect(validateFull(mismatched).isValid).toBeFalse();
  });

  it('repairs ordering corruption without inventing a session or duration', () => {
    const data = dataWithSession(validSession());
    data.workSession.ids = ['session-1', 'session-1', 'missing'];
    const repaired = dataRepair(data).data;
    expect(repaired.workSession.ids).toEqual(['session-1']);
    expect(repaired.workSession.entities['session-1']).toEqual(validSession());
    expect(validateFull(repaired).isValid).toBeTrue();
  });

  it('repairs corrupt numeric ordering without changing entity payloads', () => {
    const data = dataWithSession(validSession({ id: '1' }));
    data.workSession.ids = [1, '1'] as unknown as string[];
    expect(() =>
      workSessionReducer(initialWorkSessionState, loadAllData({ appDataComplete: data })),
    ).toThrowError('Invalid WorkSession state');
    const loaded = dataRepair(data).data.workSession;
    expect(loaded.ids).toEqual(['1']);
    expect(loaded.entities['1']).toEqual(validSession({ id: '1' }));
  });

  it('leaves malformed and dangling records invalid and recoverable after repair', () => {
    const data = dataWithSession(validSession({ taskId: 'missing' }));
    const result = validateFull(data);
    const errors = 'errors' in result.typiaResult ? result.typiaResult.errors : [];

    const repaired = dataRepair(data, errors).data;

    expect(repaired.workSession).toEqual(data.workSession);
    expect(validateFull(repaired).isValid).toBeFalse();
    expect(() =>
      workSessionReducer(
        initialWorkSessionState,
        loadAllData({ appDataComplete: repaired }),
      ),
    ).toThrowError('Invalid WorkSession state');
  });

  it('preserves unknown fields through repair instead of downgrading the record', () => {
    const session = {
      ...validSession(),
      source: 'future-contract',
    } as WorkSession;
    const data = dataWithSession(session);
    const result = validateFull(data);
    const errors = 'errors' in result.typiaResult ? result.typiaResult.errors : [];

    const repaired = dataRepair(data, errors).data;

    expect(repaired.workSession.entities['session-1']).toEqual(session);
    expect(validateFull(repaired).isValid).toBeFalse();
  });

  it('does not coerce or delete malformed payload fields or present malformed slices', () => {
    const malformed = { ...validSession(), start: '100' } as unknown as WorkSession;
    const data = dataWithSession(malformed);
    const result = validateFull(data);
    const errors = 'errors' in result.typiaResult ? result.typiaResult.errors : [];
    const repaired = dataRepair(data, errors).data;
    expect(repaired.workSession.entities['session-1']).toEqual(malformed);
    expect(validateFull(repaired).isValid).toBeFalse();
    const nullSlice = { ...data, workSession: null } as unknown as AppDataComplete;
    expect(withDefaultModelSlices(nullSlice).workSession).toBeNull();
    expect(dataRepair(nullSlice).data.workSession).toBeNull();
    expect(() =>
      workSessionReducer(
        initialWorkSessionState,
        loadAllData({ appDataComplete: nullSlice }),
      ),
    ).toThrowError('Invalid WorkSession state');
  });

  it('bookkeeping repair never renames or deletes invalid entity payloads', () => {
    const data = dataWithSession(validSession());
    data.workSession.entities['session-1'] = validSession({ id: '' });
    data.workSession.ids = [];
    const repaired = dataRepair(data).data;
    expect(repaired.workSession.ids).toEqual(['session-1']);
    expect(repaired.workSession.entities).toEqual(data.workSession.entities);
    expect(validateFull(repaired).isValid).toBeFalse();
  });
});
