import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideStore, Store } from '@ngrx/store';
import { WorkSessionService } from './work-session.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { selectWorkSessionEntities } from './store/work-session.selectors';
import {
  workSessionReducer,
  initialWorkSessionState,
} from './store/work-session.reducer';
import { WorkSession, WorkSessionState } from './work-session.model';
import { addWorkSession } from './store/work-session.actions';
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
    expect(service.scheduledTaskSession(task)).toBe(Object.values(entities())[0]);
    expect(Object.values(entities())[0]).toEqual(
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
      expect(Object.values(entities())[0]?.end).toBe(900100);
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

  it('creates independent sessions for repeated Task scheduling, including an older primary session', () => {
    setup();
    const oldPrimary = service.create(
      task.id,
      10,
      20,
      'Europe/Berlin',
      'task-schedule:4:task',
    )!;
    service.scheduleTask(task, 100);
    const before = { ...entities() };
    writes.calls.reset();
    expect(service.scheduleTask(task, 200)).toBeTrue();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.calls.mostRecent().args[0].type).toBe(addWorkSession.type);
    for (const [id, session] of Object.entries(before))
      expect(entities()[id]).toBe(session);
    expect(entities()[oldPrimary]?.start).toBe(10);
    expect(Object.keys(entities()).length).toBe(3);
    expect(new Set(Object.values(entities()).map((session) => session!.id)).size).toBe(3);
  });

  it('schedules anew without overwriting a migrated legacy session or restoring its fallback', () => {
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
    expect(entities()[session.id]).toBe(session);
    const next = Object.values(entities()).find((s) => s?.id !== session.id)!;
    expect(next).toEqual(
      jasmine.objectContaining({
        start: 100,
        end: 3600100,
        timeZone: 'Asia/Singapore',
      }),
    );
    expect(store.selectSignal(selectTaskEntities)()[task.id]?.dueWithTime).toBe(10);
    expect(
      projectLocalCalendarDisplayItems([session, next], { task: legacy }, [legacy]).map(
        (i) => i.sourceType,
      ),
    ).toEqual(['workSession', 'workSession']);
  });

  it('keeps a new intent distinct from an unbackfilled V1 reservation across hydration', () => {
    const legacy = { ...task, dueWithTime: 10 };
    setup(legacy);
    expect(service.scheduleTask(legacy, 100)).toBeTrue();
    const next = Object.values(entities())[0]!;
    expect(next.id).not.toBe(legacyTaskWorkSessionId(task.id, 10));
    expect(store.selectSignal(selectTaskEntities)()[task.id]).toBe(legacy);
    const persisted = { ids: [next.id], entities: { [next.id]: next } };
    const hydrated = backfillLegacyTaskWorkSessions(
      { ...initialTaskState, ids: [legacy.id], entities: { [legacy.id]: legacy } },
      persisted,
      'Europe/Berlin',
    );
    expect(hydrated.entities[next.id]).toEqual(next);
    expect(hydrated.ids.length).toBe(2);
    expect(
      projectLocalCalendarDisplayItems(
        Object.values(hydrated.entities) as WorkSession[],
        { task: legacy },
        [legacy],
      ).map((i) => i.sourceType),
    ).toEqual(['workSession', 'workSession']);
    expect(
      backfillLegacyTaskWorkSessions(
        { ...initialTaskState, ids: [legacy.id], entities: { [legacy.id]: legacy } },
        hydrated,
        'Europe/Berlin',
      ),
    ).toBe(hydrated);
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

  for (const folderId of [undefined, 'nested-folder']) {
    it(`retains independent Vancouver sessions, Planning and idempotent wire replay for ${folderId ?? 'Inbox'}`, () => {
      const currentTask = { ...task, isDone: false, ...(folderId ? { folderId } : {}) };
      setup(currentTask);
      zone.set({ timeZone: 'America/Vancouver' });
      store.dispatch(
        setPlacement({
          record: {
            id: task.id,
            placement: { target: { type: 'DAY', key: '2026-10-07' }, orderKey: 'V' },
            revision: { counter: 1, clientId: 'local', opId: 'today' },
          },
        }),
      );
      const planning = store.selectSignal((s) => s['planning'])();
      writes.calls.reset();
      const morning = Date.parse('2026-10-07T16:00:00Z');
      const afternoon = Date.parse('2026-10-07T21:00:00Z');
      expect(service.scheduleTask(currentTask, morning)).toBeTrue();
      expect(service.scheduleTask(currentTask, afternoon)).toBeTrue();
      const [first, second] = Object.values(entities()) as WorkSession[];
      expect(service.scheduledTaskSession(currentTask)).toBeUndefined();
      expect(first.id).not.toBe(second.id);
      expect([first.start, second.start]).toEqual([morning, afternoon]);
      expect(writes.calls.allArgs().map(([action]) => action.type)).toEqual([
        addWorkSession.type,
        addWorkSession.type,
      ]);
      expect(
        service.update(first.id, { start: morning + 3600000, end: morning + 7200000 }),
      ).toBeTrue();
      expect(entities()[second.id]).toBe(second);
      expect(service.update(second.id, { end: afternoon + 5400000 })).toBeTrue();
      expect(entities()[first.id]?.end).toBe(morning + 7200000);
      expect(service.complete(first.id, afternoon)).toBeTrue();
      expect(entities()[second.id]?.completedAt).toBeUndefined();
      expect(store.selectSignal(selectTaskEntities)()[task.id]).toBe(currentTask);
      expect(currentTask.isDone).toBeFalse();
      expect(store.selectSignal((s) => s['planning'])()).toBe(planning);
      const capture = TestBed.inject(OperationCaptureService);
      const client = new TestClient('local');
      let replayed = initialWorkSessionState;
      const remoteActions: ReturnType<typeof convertOpToAction>[] = [];
      for (const [action] of writes.calls.allArgs()) {
        const { type, meta, ...actionPayload } = action;
        const op = client.createOperation({
          actionType: type,
          opType: meta.opType,
          entityType: meta.entityType,
          entityId: meta.entityId,
          payload: { actionPayload, entityChanges: capture.extractEntityChanges(action) },
        });
        const remote = convertOpToAction(JSON.parse(JSON.stringify(op)));
        expect(remote.meta.isRemote).toBeTrue();
        remoteActions.push(remote);
        replayed = workSessionReducer(replayed, remote);
      }
      // Startup replay reconstructs a fresh slice; duplicate delivery is filtered
      // by the existing operation applier, not by accepting duplicate creates.
      expect(remoteActions.reduce(workSessionReducer, initialWorkSessionState)).toEqual(
        replayed,
      );
      expect(replayed.entities).toEqual(entities());
      expect(replayed.ids.length).toBe(2);
      expect(
        projectLocalCalendarDisplayItems(
          Object.values(replayed.entities) as WorkSession[],
          { task: currentTask },
          [],
        ),
      ).toHaveSize(2);
      expect(writes).toHaveBeenCalledTimes(5);
    });
  }

  // Explicit instants and Intl's named zone keep DST coverage independent of the
  // browser/Windows viewing zone. WorkSessions store elapsed time, not wall time.
  for (const boundary of [
    { name: 'ordinary midnight', start: '2026-01-16T07:30:00Z', hours: ['23', '00'] },
    { name: 'spring DST gap', start: '2026-03-08T09:30:00Z', hours: ['01', '03'] },
    { name: 'fall DST fold', start: '2026-11-01T08:30:00Z', hours: ['01', '01'] },
  ]) {
    it(`moves and resizes across ${boundary.name} without changing elapsed duration, zone or Task identity`, () => {
      setup();
      zone.set({ timeZone: 'America/Los_Angeles' });
      const originalStart = Date.parse('2026-01-15T18:00:00Z');
      expect(service.scheduleTask(task, originalStart)).toBeTrue();
      const id = Object.keys(entities())[0];
      const otherId = service.create(task.id, originalStart, originalStart + 1000)!;
      const other = entities()[otherId];
      const target = Date.parse(boundary.start);
      // A changed default must not replace the stored zone during movement.
      zone.set({ timeZone: 'Invalid/Zone' });
      writes.calls.reset();
      expect(
        service.update(id, { start: target, end: target + task.timeEstimate }),
      ).toBeTrue();
      const moved = entities()[id]!;
      expect(moved.end - moved.start).toBe(task.timeEstimate);
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: moved.timeZone,
        hour: '2-digit',
        hourCycle: 'h23',
      });
      expect([formatter.format(moved.start), formatter.format(moved.end)]).toEqual(
        boundary.hours,
      );
      expect(service.update(id, { end: moved.end + 1800000 })).toBeTrue();
      const resized = entities()[id]!;
      expect(resized).toEqual(
        jasmine.objectContaining({
          taskId: task.id,
          start: target,
          end: target + task.timeEstimate + 1800000,
          timeZone: 'America/Los_Angeles',
        }),
      );
      expect(resized.completedAt).toBeUndefined();
      expect(entities()[otherId]).toBe(other);
      expect(store.selectSignal(selectTaskEntities)()[task.id]).toBe(task);
      expect(writes).toHaveBeenCalledTimes(2);
      expect(projectLocalCalendarDisplayItems([resized], { task }, [])[0].end).toBe(
        resized.end,
      );
    });
  }

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
