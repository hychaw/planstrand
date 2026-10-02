import { signal } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import {
  CdkDragMove,
  CdkDragRelease,
  CdkDragStart,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import { MatDialog } from '@angular/material/dialog';
import { provideStore, Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { TaskService } from '../tasks/task.service';
import { DEFAULT_TASK, TaskWithDueTime } from '../tasks/task.model';
import { CalendarEventActionsService } from '../calendar-integration/calendar-event-actions.service';
import { WorkSessionService } from '../work-session/work-session.service';
import { WorkSession, WorkSessionState } from '../work-session/work-session.model';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { selectWorkSessionEntities } from '../work-session/store/work-session.selectors';
import { workSessionReducer } from '../work-session/store/work-session.reducer';
import { updateWorkSession } from '../work-session/store/work-session.actions';
import { legacyTaskWorkSessionId } from '../work-session/legacy-task-work-session-backfill';
import { ScheduleWeekDragService } from './schedule-week/schedule-week-drag.service';
import { ScheduleEventComponent } from './schedule-event/schedule-event.component';
import { editableWorkSession, ScheduleEvent } from './schedule.model';
import { FH, SVEType } from './schedule.const';
import {
  projectLocalCalendarDisplayItems,
  projectWorkSession,
} from './calendar-display-item';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import { isPersistentAction } from '../../op-log/core/persistent-action.interface';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';

describe('existing WorkSession schedule edits', () => {
  const hour = 3600000;
  const twoHours = 2 * hour;
  const rowDuration = hour / FH;
  const start = new Date(2026, 0, 15, 10).getTime();
  const task: TaskWithDueTime = {
    ...DEFAULT_TASK,
    id: 'task',
    projectId: 'INBOX',
    dueWithTime: start,
    timeEstimate: hour,
  };
  const session: WorkSession = {
    id: legacyTaskWorkSessionId(task.id, start),
    taskId: task.id,
    start,
    end: start + hour,
    timeZone: 'America/Vancouver',
    completedAt: start + hour,
    created: start,
    modified: start,
  };
  const second = { ...session, id: 'second', completedAt: null };
  let store: Store;
  let drag: ScheduleWeekDragService;
  let writes: jasmine.Spy;
  let fixture: ComponentFixture<ScheduleEventComponent>;
  let grid: HTMLElement;
  let configZone: jasmine.Spy;

  beforeEach(async () => {
    configZone = jasmine
      .createSpy('localization')
      .and.throwError('Must not resolve a default zone');
    await TestBed.configureTestingModule({
      imports: [ScheduleEventComponent, DragDropModule, TranslateModule.forRoot()],
      providers: [
        provideStore(
          {
            tasks: (state = { ids: [task.id], entities: { [task.id]: task } }) => state,
            workSession: workSessionReducer,
          },
          {
            initialState: {
              tasks: { ids: [task.id], entities: { [task.id]: task } },
              workSession: {
                ids: [session.id, second.id],
                entities: {
                  [session.id]: session,
                  [second.id]: second,
                },
              } as WorkSessionState,
            },
          },
        ),
        ScheduleWeekDragService,
        {
          provide: GlobalConfigService,
          useValue: { cfg: signal(DEFAULT_GLOBAL_CONFIG), localization: configZone },
        },
        { provide: DateService, useValue: { todayStr: () => '2026-01-15' } },
        { provide: DateTimeFormatService, useValue: { is24HourFormat: () => true } },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
        {
          provide: TaskService,
          useValue: { setSelectedId: jasmine.createSpy('setSelectedId') },
        },
        {
          provide: CalendarEventActionsService,
          useValue: jasmine.createSpyObj('calendar', [
            'canMoveEvent',
            'moveToStartTime',
            'hasEventUrl',
          ]),
        },
      ],
    }).compileComponents();
    store = TestBed.inject(Store);
    writes = spyOn(store, 'dispatch').and.callThrough();
    drag = TestBed.inject(ScheduleWeekDragService);
    grid = document.createElement('div');
    grid.classList.add('grid-container');
    spyOn(grid, 'getBoundingClientRect').and.returnValue({
      top: 0,
      bottom: 24 * FH * 10,
      left: 0,
      right: 500,
      height: 24 * FH * 10,
    } as DOMRect);
    document.body.appendChild(grid);
    drag.setGridContainer(() => grid);
    drag.setDaysToShowAccessor(() => ['2026-01-15']);
  });

  afterEach(() => {
    fixture?.destroy();
    drag.destroy();
    grid.remove();
    expect(configZone).not.toHaveBeenCalled();
  });

  const entities = (): WorkSessionState['entities'] =>
    store.selectSignal(selectWorkSessionEntities)();
  const eventFor = (value = session): ScheduleEvent => ({
    id: `workSession:${value.id}`,
    type: SVEType.WorkSession,
    data: projectWorkSession(value),
    style: '',
    startHours: 10,
    timeLeftInHours: 1,
  });
  const release = (event = eventFor(), inside = true, preview = false): jasmine.Spy => {
    const col = document.createElement('div');
    col.classList.add('col');
    col.setAttribute('data-day', '2026-01-15');
    spyOn(document, 'elementsFromPoint').and.returnValue(inside ? [col] : []);
    const reset = jasmine.createSpy('reset');
    const source = {
      data: event,
      element: { nativeElement: document.createElement('schedule-event') },
      reset,
    };
    drag.handleDragStarted({ source } as unknown as CdkDragStart<ScheduleEvent>);
    const targetY = 12 * FH * 10;
    const centerOffset = Math.floor(FH / 2) * 10;
    const clientY = targetY + centerOffset;
    if (preview) {
      drag.handleDragMoved({
        source,
        pointerPosition: { x: 100, y: clientY },
      } as unknown as CdkDragMove<ScheduleEvent>);
      expect(drag.dragPreviewContext()).toEqual({
        kind: 'time',
        timestamp: start + twoHours,
      });
    }
    drag.handleDragReleased({
      source,
      event: new MouseEvent('mouseup', {
        clientX: inside ? 100 : 600,
        clientY,
      }),
    } as unknown as CdkDragRelease<ScheduleEvent>);
    return reset;
  };
  const assertRetained = (id = session.id): void => {
    const current = entities()[id]!;
    expect(current.taskId).toBe(task.id);
    expect(current.timeZone).toBe(session.timeZone);
    expect(current.completedAt).toBe(id === session.id ? session.completedAt : null);
    expect(store.selectSignal(selectTaskEntities)()[task.id]).toBe(task);
    expect(task.dueWithTime).toBe(start);
  };

  it('moves only the selected session, preserving duration, completion, zone and legacy fields', () => {
    drag.setShiftMode(true);
    expect(release(eventFor(), true, true)).toHaveBeenCalledTimes(1);
    expect(entities()[session.id]!.start).toBe(new Date(2026, 0, 15, 12).getTime());
    expect(entities()[session.id]!.end - entities()[session.id]!.start).toBe(hour);
    expect(entities()[second.id]).toEqual(second);
    assertRetained();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.calls.mostRecent().args[0].changes).toEqual({
      start: start + twoHours,
      end: start + twoHours + hour,
    });
    const items = projectLocalCalendarDisplayItems(
      Object.values(entities()).filter((s): s is WorkSession => !!s),
      { [task.id]: task },
      [task],
    );
    expect(items.some((item) => item.sourceType === 'legacyTask')).toBeFalse();
  });

  it('keeps an incomplete session incomplete when moved', () => {
    release(eventFor(second));
    assertRetained(second.id);
    expect(entities()[session.id]).toEqual(session);
  });

  it('routes a legacy timed Task release through its existing reschedule action', () => {
    const update = spyOn(TestBed.inject(WorkSessionService), 'update').and.callThrough();
    release({ ...eventFor(), id: task.id, type: SVEType.ScheduledTask, data: task });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.calls.mostRecent().args[0].type).toBe(
      TaskSharedActions.reScheduleTaskWithTime.type,
    );
    expect(update).not.toHaveBeenCalled();
    expect(entities()[session.id]).toEqual(session);
  });

  it('keeps unscheduled Task drop creation on the legacy scheduling path', () => {
    const create = spyOn(TestBed.inject(WorkSessionService), 'create').and.callThrough();
    release({
      ...eventFor(),
      id: task.id,
      type: SVEType.Task,
      data: { ...task, dueWithTime: undefined },
    });
    expect(writes.calls.mostRecent().args[0].type).toBe(
      TaskSharedActions.scheduleTaskWithTime.type,
    );
    expect(create).not.toHaveBeenCalled();
    expect(entities()[session.id]).toEqual(session);
  });

  it('rejects outside drops and restores the drag without deletion or a Task fallback', () => {
    expect(release(eventFor(), false)).toHaveBeenCalledTimes(1);
    expect(writes).not.toHaveBeenCalled();
  });

  it('restores a rejected move without dispatching a fallback or changing persisted state', () => {
    spyOn(TestBed.inject(WorkSessionService), 'update').and.returnValue(false);
    expect(release()).toHaveBeenCalledTimes(1);
    expect(entities()[session.id]).toEqual(session);
    expect(writes).not.toHaveBeenCalled();
    expect(drag.dragPreviewStyle()).toBeNull();
    expect(drag.currentDragEvent()).toBeNull();
  });

  it('blocks timezone-less, invalid-zone, read-only and wrong-source session interactions', () => {
    for (const changes of [
      { timeZone: undefined },
      { timeZone: 'Invalid/Zone' },
      { isReadOnly: true },
      { sourceType: 'legacyTask' as const },
    ]) {
      expect(
        editableWorkSession(
          { ...eventFor(), data: { ...projectWorkSession(session), ...changes } },
          'canMove',
        ),
      ).toBeNull();
    }
    release(eventFor({ ...session, timeZone: undefined }));
    expect(writes).not.toHaveBeenCalled();
  });

  const resize = (delta: number, value = session): void => {
    fixture = TestBed.createComponent(ScheduleEventComponent);
    fixture.componentRef.setInput('event', eventFor(value));
    fixture.detectChanges();
    grid.appendChild(fixture.nativeElement);
    spyOnProperty(fixture.nativeElement, 'offsetHeight').and.returnValue(12 * 10);
    fixture.nativeElement
      .querySelector('.resize-handle')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 100 + delta }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(fixture.componentInstance._resizeHeight()).toBe('');
  };

  it('persists the grid resize end boundary only and retains Task, zone and completion', fakeAsync(() => {
    resize(120);
    expect(entities()[session.id]!.start).toBe(start);
    expect(entities()[session.id]!.end).toBe(start + twoHours);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.calls.mostRecent().args[0].changes).toEqual({ end: start + twoHours });
    expect(entities()[second.id]).toEqual(second);
    assertRetained();
    tick(200);
  }));

  it('uses the existing one-row minimum during resize', fakeAsync(() => {
    resize(-500);
    expect(entities()[session.id]!.end).toBe(start + rowDuration);
    assertRetained();
    tick(200);
  }));

  it('retains incomplete completion state during resize', fakeAsync(() => {
    resize(120, second);
    assertRetained(second.id);
    expect(entities()[session.id]).toEqual(session);
    tick(200);
  }));

  it('rejects zero/negative resize ranges and clears the temporary height', fakeAsync(() => {
    // A stale UI projection can propose an invalid boundary; the service reads live state.
    resize(-10, { ...session, end: start + rowDuration });
    expect(entities()[session.id]).toEqual(session);
    expect(writes).not.toHaveBeenCalled();
    expect(
      TestBed.inject(WorkSessionService).update(session.id, { end: start }),
    ).toBeFalse();
    expect(
      TestBed.inject(WorkSessionService).update(session.id, { end: start - 1 }),
    ).toBeFalse();
    tick(200);
  }));

  it('serializes one persistent update intent and replays it without another UI write', () => {
    const update = spyOn(TestBed.inject(WorkSessionService), 'update').and.callThrough();
    release();
    const action = writes.calls.mostRecent().args[0] as ReturnType<
      typeof updateWorkSession
    >;
    expect(isPersistentAction(action)).toBeTrue();
    expect(action.meta.entityType).toBe('WORK_SESSION');
    expect(action.meta.entityId).toBe(session.id);
    expect(writes).toHaveBeenCalledTimes(1);
    const capture = TestBed.inject(OperationCaptureService);
    const op = new TestClient('client-local').createOperation({
      actionType: action.type,
      opType: action.meta.opType,
      entityType: action.meta.entityType,
      entityId: action.id,
      payload: {
        actionPayload: {
          id: action.id,
          changes: action.changes,
          modified: action.modified,
        },
        entityChanges: capture.extractEntityChanges(action),
      },
    });
    const replay = convertOpToAction(JSON.parse(JSON.stringify(op)));
    expect(replay.meta.isRemote).toBeTrue();
    const initial = {
      ids: [session.id, second.id],
      entities: { [session.id]: session, [second.id]: second },
    };
    expect(workSessionReducer(initial, replay).entities).toEqual(entities());
    writes.calls.reset();
    store.dispatch(replay);
    expect(update).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledTimes(1);
    assertRetained();
  });
});
