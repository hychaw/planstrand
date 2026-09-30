import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { WorkSessionService } from './work-session.service';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { selectWorkSessionEntities } from './store/work-session.selectors';
import { createValidTask } from '../../op-log/validation/state-validity-test-utils';
import { completeWorkSession, uncompleteWorkSession } from './store/work-session.actions';

describe('WorkSessionService', () => {
  let service: WorkSessionService;
  let store: MockStore;
  let dispatch: jasmine.Spy;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideMockStore()] });
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectTaskEntities, { task: createValidTask('task') });
    store.overrideSelector(selectWorkSessionEntities, {
      session: {
        id: 'session',
        taskId: 'task',
        start: 1,
        end: 2,
        created: 1,
        modified: 1,
      },
    });
    service = TestBed.inject(WorkSessionService);
    dispatch = spyOn(store, 'dispatch');
  });
  afterEach(() => store.resetSelectors());

  it('creates locally and persists only the Phase 1 fields', () => {
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
    ]);
    expect(action.workSession.created).toBe(action.workSession.modified);
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
