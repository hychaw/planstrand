import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideStore, Store } from '@ngrx/store';
import { WorkSessionService, taskScheduledWorkSessionId } from './work-session.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { selectWorkSessionEntities } from './store/work-session.selectors';
import {
  workSessionReducer,
  initialWorkSessionState,
} from './store/work-session.reducer';
import { WorkSession, WorkSessionState } from './work-session.model';
import { addWorkSession, updateWorkSession } from './store/work-session.actions';
import {
  backfillLegacyTaskWorkSessions,
  legacyTaskWorkSessionId,
} from './legacy-task-work-session-backfill';
import { initialTaskState } from '../tasks/store/task.reducer';
import { projectLocalCalendarDisplayItems } from '../schedule/calendar-display-item';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { isPersistentAction } from '../../op-log/core/persistent-action.interface';
import { PlanningState } from '../planning/planning.model';
import {
  planningReducer,
  initialPlanningState,
} from '../planning/store/planning.reducer';
import { setPlacement } from '../planning/store/planning.actions';

describe('Task timed scheduling cutover', () => {
  const task: Task = {
    ...DEFAULT_TASK,
    id: 'task',
    projectId: 'INBOX',
    timeEstimate: 3600000,
    isDone: true,
  };
  let store: Store;
  let service: WorkSessionService;
  let writes: jasmine.Spy;
  const zone = signal({ timeZone: 'Asia/Singapore' });
  const setup = (currentTask = task, sessions: WorkSession[] = []): void => {
    zone.set({ timeZone: 'Asia/Singapore' });
    TestBed.configureTestingModule({
      providers: [
        provideStore<{
          tasks: { ids: string[]; entities: Record<string, Task> };
          workSession: WorkSessionState;
          planning: PlanningState;
        }>(
          {
            tasks: (
              state = {
                ids: [currentTask.id],
                entities: { [currentTask.id]: currentTask },
              },
            ) => state,
            workSession: workSessionReducer,
            planning: planningReducer,
          },
          {
            initialState: {
              tasks: {
                ids: [currentTask.id],
                entities: { [currentTask.id]: currentTask },
              },
              planning: initialPlanningState,
              workSession: {
                ids: sessions.map((s) => s.id),
                entities: Object.fromEntries(sessions.map((s) => [s.id, s])),
              } as WorkSessionState,
            },
          },
        ),
        { provide: GlobalConfigService, useValue: { localization: zone } },
      ],
    });
    store = TestBed.inject(Store);
    service = TestBed.inject(WorkSessionService);
    writes = spyOn(store, 'dispatch').and.callThrough();
  };
  const entities = (): WorkSessionState['entities'] =>
    store.selectSignal(selectWorkSessionEntities)();

  it('creates one timed block from the estimate with a valid configured zone and no Task or planning mutation', () => {
    setup();
    const before = store.selectSignal(selectTaskEntities)();
    const planning = store.selectSignal((s) => s['planning']);
    const placement = planning();
    expect(service.scheduleTask(task, 100)).toBeTrue();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.calls.mostRecent().args[0].type).toBe(addWorkSession.type);
    expect(entities()[taskScheduledWorkSessionId(task)]).toEqual(
      jasmine.objectContaining({
        taskId: task.id,
        start: 100,
        end: 3600100,
        timeZone: 'Asia/Singapore',
      }),
    );
    expect(store.selectSignal(selectTaskEntities)()).toBe(before);
    expect(before[task.id]?.dueWithTime).toBeUndefined();
    expect(before[task.id]?.isDone).toBeTrue();
    expect(planning()).toBe(placement);
  });

  it('uses only the caller supplied existing fallback for invalid estimates', () => {
    for (const estimate of [undefined, 0, -1, NaN, Infinity]) {
      TestBed.resetTestingModule();
      const invalid = { ...task, timeEstimate: estimate as number };
      setup(invalid);
      expect(service.scheduleTask(invalid, 100)).toBeFalse();
      expect(writes).not.toHaveBeenCalled();
      expect(service.scheduleTask(invalid, 100, 900000)).toBeTrue();
      expect(entities()[taskScheduledWorkSessionId(invalid)]?.end).toBe(900100);
      expect(
        Object.is(
          store.selectSignal(selectTaskEntities)()[task.id]?.timeEstimate,
          estimate,
        ),
      ).toBeTrue();
    }
  });

  it('applies day/week planning independently without creating a WorkSession', () => {
    setup();
    const before = entities();
    for (const type of ['DAY', 'WEEK'] as const) {
      store.dispatch(
        setPlacement({
          record: {
            id: task.id,
            placement: { target: { type, key: '2026-10-05' }, orderKey: 'V' },
            revision: { counter: type === 'DAY' ? 1 : 2, clientId: 'local', opId: type },
          },
        }),
      );
      expect(entities()).toBe(before);
    }
    expect(writes.calls.allArgs().map(([action]) => action.type)).toEqual([
      setPlacement.type,
      setPlacement.type,
    ]);
  });

  it('updates the deterministic primary block preserving duration and zone without selecting unrelated sessions', () => {
    setup();
    const unrelated = service.create(task.id, 10, 20, 'Europe/Berlin')!;
    service.scheduleTask(task, 100);
    const other = entities()[unrelated];
    zone.set({ timeZone: 'Invalid/Zone' });
    writes.calls.reset();
    expect(service.scheduleTask({ ...task, timeEstimate: 1 }, 200)).toBeTrue();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.calls.mostRecent().args[0].type).toBe(updateWorkSession.type);
    expect(entities()[taskScheduledWorkSessionId(task)]).toEqual(
      jasmine.objectContaining({ start: 200, end: 3600200, timeZone: 'Asia/Singapore' }),
    );
    expect(entities()[unrelated]).toBe(other);
    expect(Object.keys(entities()).length).toBe(2);
  });

  it('updates a migrated legacy session with stale Task timing intact and no visual duplicate', () => {
    const legacy = { ...task, dueWithTime: 10 };
    const session: WorkSession = {
      id: legacyTaskWorkSessionId(task.id, 10),
      taskId: task.id,
      start: 20,
      end: 50,
      timeZone: 'Europe/Berlin',
      completedAt: 40,
      created: 10,
      modified: 10,
    };
    setup(legacy, [session]);
    expect(service.scheduleTask(legacy, 100)).toBeTrue();
    const next = entities()[session.id]!;
    expect(next).toEqual(
      jasmine.objectContaining({
        start: 100,
        end: 130,
        timeZone: 'Europe/Berlin',
        completedAt: 40,
      }),
    );
    expect(store.selectSignal(selectTaskEntities)()[task.id]?.dueWithTime).toBe(10);
    expect(
      projectLocalCalendarDisplayItems([next], { task: legacy }, [legacy]).map(
        (i) => i.sourceType,
      ),
    ).toEqual(['workSession']);
  });

  it('creates using legacy identity when backfill was absent, so stale timing remains suppressed after startup', () => {
    const legacy = { ...task, dueWithTime: 10 };
    setup(legacy);
    expect(service.scheduleTask(legacy, 100)).toBeTrue();
    const next = entities()[legacyTaskWorkSessionId(task.id, 10)]!;
    expect(
      projectLocalCalendarDisplayItems([next], { task: legacy }, [legacy]).length,
    ).toBe(1);
    expect(store.selectSignal(selectTaskEntities)()[task.id]).toBe(legacy);
    const persisted = { ids: [next.id], entities: { [next.id]: next } };
    expect(
      backfillLegacyTaskWorkSessions(
        { ...initialTaskState, ids: [legacy.id], entities: { [legacy.id]: legacy } },
        persisted,
        'Europe/Berlin',
      ),
    ).toBe(persisted);
  });

  it('fails without writing for an invalid timezone or range', () => {
    setup();
    zone.set({ timeZone: 'Invalid/Zone' });
    expect(service.scheduleTask(task, 100)).toBeFalse();
    zone.set({ timeZone: 'Asia/Singapore' });
    expect(service.scheduleTask(task, NaN)).toBeFalse();
    expect(service.scheduleTask(task, -1)).toBeFalse();
    expect(writes).not.toHaveBeenCalled();
  });

  it('captures and wire-replays one creation intent without a follow-up scheduling write', () => {
    setup();
    service.scheduleTask(task, 100);
    const action = writes.calls.mostRecent().args[0] as ReturnType<typeof addWorkSession>;
    expect(isPersistentAction(action)).toBeTrue();
    const capture = TestBed.inject(OperationCaptureService);
    const op = new TestClient('local').createOperation({
      actionType: action.type,
      opType: action.meta.opType,
      entityType: action.meta.entityType,
      entityId: action.meta.entityId,
      payload: {
        actionPayload: { workSession: action.workSession },
        entityChanges: capture.extractEntityChanges(action),
      },
    });
    const replay = convertOpToAction(JSON.parse(JSON.stringify(op)));
    expect(replay.meta.isRemote).toBeTrue();
    const schedule = spyOn(service, 'scheduleTask');
    expect(workSessionReducer(initialWorkSessionState, replay).entities).toEqual(
      entities(),
    );
    // Replay on a fresh slice: no UI service is invoked by reducers.
    expect(schedule).not.toHaveBeenCalled();
    expect(writes).toHaveBeenCalledTimes(1);
  });
});
