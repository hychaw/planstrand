import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { WorkSessionService } from './work-session.service';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { selectWorkSessionEntities } from './store/work-session.selectors';
import { createValidTask } from '../../op-log/validation/state-validity-test-utils';
import { completeWorkSession, uncompleteWorkSession } from './store/work-session.actions';
import { GlobalConfigService } from '../config/global-config.service';

describe('WorkSessionService', () => {
  let service: WorkSessionService;
  let store: MockStore;
  let dispatch: jasmine.Spy;
  let configuredTimeZone: string | null | undefined;
  beforeEach(() => {
    configuredTimeZone = 'Europe/Berlin';
    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        {
          provide: GlobalConfigService,
          useValue: { localization: () => ({ timeZone: configuredTimeZone }) },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectTaskEntities, { task: createValidTask('task') });
    store.overrideSelector(selectWorkSessionEntities, {
      session: {
        id: 'session',
        taskId: 'task',
        start: 1,
        end: 2,
        timeZone: 'Europe/Berlin',
        created: 1,
        modified: 1,
      },
    });
    service = TestBed.inject(WorkSessionService);
    dispatch = spyOn(store, 'dispatch');
  });
  afterEach(() => store.resetSelectors());

  it('creates locally with the configured timezone and exact persisted fields', () => {
    const id = service.create('task', 10, 20);
    expect(id).toBeTruthy();
    const action = dispatch.calls.mostRecent().args[0];
    expect(Object.keys(action.workSession).sort()).toEqual([
      'created',
      'end',
      'id',
      'modified',
      'start',
      'taskId',
      'timeZone',
    ]);
    expect(action.workSession.timeZone).toBe('Europe/Berlin');
    expect(action.workSession.created).toBe(action.workSession.modified);
  });
  it('persists an explicit valid zone instead of the configured zone', () => {
    expect(service.create('task', 10, 20, 'America/Vancouver')).toBeTruthy();
    expect(dispatch.calls.mostRecent().args[0].workSession.timeZone).toBe(
      'America/Vancouver',
    );
  });
  it('resolves null input through config and missing config through the system', () => {
    expect(service.create('task', 10, 20, null)).toBeTruthy();
    expect(dispatch.calls.mostRecent().args[0].workSession.timeZone).toBe(
      'Europe/Berlin',
    );
    const options = Intl.DateTimeFormat().resolvedOptions();
    spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').and.returnValue({
      ...options,
      timeZone: 'Asia/Singapore',
    });
    for (const config of [null, undefined]) {
      configuredTimeZone = config;
      expect(service.create('task', 10, 20)).toBeTruthy();
      expect(dispatch.calls.mostRecent().args[0].workSession.timeZone).toBe(
        'Asia/Singapore',
      );
    }
  });
  it('rejects invalid explicit and configured zones without fallback or dispatch', () => {
    for (const zone of ['Invalid/Zone', '', '+01:00']) {
      expect(service.create('task', 10, 20, zone)).toBeNull();
      configuredTimeZone = zone;
      expect(service.create('task', 10, 20)).toBeNull();
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('rejects creation when the system timezone is invalid or unavailable', () => {
    configuredTimeZone = undefined;
    const options = Intl.DateTimeFormat().resolvedOptions();
    const system = spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
    for (const zone of ['', 'Invalid/Zone']) {
      system.and.returnValue({ ...options, timeZone: zone });
      expect(service.create('task', 10, 20)).toBeNull();
    }
    system.and.throwError('Unavailable');
    expect(service.create('task', 10, 20)).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('accepts valid timezone edits and rejects invalid or clearing edits', () => {
    expect(service.update('session', { timeZone: 'America/Vancouver' })).toBeTrue();
    expect(dispatch.calls.mostRecent().args[0].changes).toEqual({
      timeZone: 'America/Vancouver',
    });
    dispatch.calls.reset();
    expect(service.update('session', { timeZone: 'Invalid/Zone' })).toBeFalse();
    expect(service.update('session', { timeZone: undefined })).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('rejects missing Tasks and invalid ranges without dispatching', () => {
    expect(service.create('missing', 10, 20)).toBeNull();
    expect(service.create('task', 20, 10)).toBeNull();
    expect(service.update('session', { taskId: 'missing' })).toBeFalse();
    expect(service.update('session', { end: Number.POSITIVE_INFINITY })).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('dispatches only explicit completion and uncompletion actions', () => {
    spyOn(Date, 'now').and.returnValue(50);
    expect(service.complete('session', 40)).toBeTrue();
    expect(dispatch).toHaveBeenCalledWith(
      completeWorkSession({ id: 'session', completedAt: 40, modified: 50 }),
    );
    expect(service.uncomplete('session')).toBeTrue();
    expect(dispatch).toHaveBeenCalledWith(
      uncompleteWorkSession({ id: 'session', modified: 50 }),
    );
    expect(dispatch.calls.count()).toBe(2);
  });
  it('rejects missing sessions and malformed completion timestamps', () => {
    expect(service.complete('session', Number.NaN)).toBeFalse();
    expect(service.complete('missing')).toBeFalse();
    expect(service.update('missing', {})).toBeFalse();
    expect(service.remove('missing')).toBeFalse();
    expect(service.uncomplete('missing')).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
