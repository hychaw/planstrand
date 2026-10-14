import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideStore, Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DEFAULT_TASK } from '../../tasks/task.model';
import { workSessionReducer } from '../store/work-session.reducer';
import { selectWorkSessionEntities } from '../store/work-session.selectors';
import { updateWorkSession } from '../store/work-session.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { DialogWorkSessionComponent } from './dialog-work-session.component';
import { zonedDateTimeFields } from '../../../util/iana-time-zone';
import {
  createValidAppData,
  addTaskToAppData,
  createValidTask,
} from '../../../op-log/validation/state-validity-test-utils';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { WorkSessionState } from '../work-session.model';
import { GlobalConfigService } from '../../config/global-config.service';

describe('exact-minute WorkSession editor', () => {
  const session = {
    id: 'session',
    taskId: 'task',
    timeZone: 'Asia/Singapore',
    start: Date.parse('2026-10-14T16:15:00+08:00'),
    end: Date.parse('2026-10-14T17:15:00+08:00'),
    completedAt: 123,
    created: 100,
    modified: 100,
  };
  const task = {
    ...DEFAULT_TASK,
    id: 'task',
    projectId: 'INBOX',
    deadlineDay: '2026-10-20',
    dueDay: '2026-10-19',
  };
  let store: Store;
  let writes: jasmine.Spy;
  let close: jasmine.Spy;
  let localization: jasmine.Spy;
  beforeEach(async () => {
    close = jasmine.createSpy('close');
    localization = jasmine
      .createSpy('localization')
      .and.returnValue({ timeZone: 'Asia/Singapore' });
    await TestBed.configureTestingModule({
      imports: [DialogWorkSessionComponent, TranslateModule.forRoot()],
      providers: [
        provideStore(
          {
            tasks: (state = { ids: [task.id], entities: { task } }) => state,
            workSession: workSessionReducer,
          },
          {
            initialState: {
              tasks: { ids: [task.id], entities: { task } },
              workSession: {
                ids: [session.id, 'sibling'],
                entities: {
                  session,
                  sibling: { ...session, id: 'sibling' },
                },
              } as WorkSessionState,
            },
          },
        ),
        { provide: MAT_DIALOG_DATA, useValue: { id: session.id } },
        { provide: MatDialogRef, useValue: { close } },
        {
          provide: GlobalConfigService,
          useValue: { localization },
        },
      ],
    }).compileComponents();
    store = TestBed.inject(Store);
    writes = spyOn(store, 'dispatch').and.callThrough();
  });
  const editor = (): DialogWorkSessionComponent => {
    const fixture = TestBed.createComponent(DialogWorkSessionComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name=start]').step).toBe('60');
    expect(fixture.nativeElement.querySelector('input[name=end]').step).toBe('60');
    return fixture.componentInstance;
  };
  const current = (): WorkSessionState['entities'] =>
    store.selectSignal(selectWorkSessionEntities)();

  it('edits 16:17 to 17:23 in place and survives snapshot hydration and repeated replay', () => {
    const component = editor();
    expect(component.startTime).toBe('16:15');
    component.startTime = '16:17';
    component.endTime = '17:23';
    component.save();
    component.save();
    expect(writes).toHaveBeenCalledTimes(1);
    const action = writes.calls.mostRecent().args[0];
    expect(action.type).toBe(updateWorkSession.type);
    expect(action.id).toBe(session.id);
    expect(action.changes).toEqual({
      start: Date.parse('2026-10-14T16:17:00+08:00'),
      end: Date.parse('2026-10-14T17:23:00+08:00'),
    });
    expect(current().session).toEqual(
      jasmine.objectContaining({
        ...session,
        ...action.changes,
        modified: action.modified,
      }),
    );
    expect(current().sibling).toEqual({ ...session, id: 'sibling' });
    expect(close).toHaveBeenCalledOnceWith(true);
    expect(store.selectSignal(selectTaskEntities)().task).toBe(task);
    const hydrated = workSessionReducer(
      undefined,
      loadAllData({
        appDataComplete: addTaskToAppData(
          createValidAppData({
            workSession: JSON.parse(
              JSON.stringify({ ids: Object.keys(current()), entities: current() }),
            ),
          }),
          createValidTask('task'),
        ),
      }),
    );
    expect(hydrated.ids).toHaveSize(2);
    expect(workSessionReducer(hydrated, JSON.parse(JSON.stringify(action)))).toEqual(
      hydrated,
    );
    expect(hydrated.entities.session).toEqual(current().session);
  });

  it('supports different end dates across midnight in the stored zone', () => {
    const component = editor();
    component.startTime = '23:57';
    component.endDate = '2026-10-15';
    component.endTime = '00:17';
    component.save();
    expect(current().session!.end - current().session!.start).toBe(20 * 60000);
    expect(zonedDateTimeFields(current().session!.end, session.timeZone)).toEqual({
      date: '2026-10-15',
      time: '00:17',
    });
  });

  it('edits in the configured Calendar zone while retaining the session zone', () => {
    localization.and.returnValue({ timeZone: 'Europe/London' });
    const component = editor();
    expect(component.timeZone).toBe('Europe/London');
    expect(component.startTime).toBe('09:15');
    component.startTime = '09:17';
    component.endTime = '10:23';
    component.save();
    expect(current().session!.start).toBe(Date.parse('2026-10-14T09:17:00+01:00'));
    expect(current().session!.timeZone).toBe('Asia/Singapore');
    expect(current().session!.completedAt).toBe(session.completedAt);
  });

  for (const endTime of ['16:15', '16:14', '24:00']) {
    it(`rejects invalid end ${endTime}`, () => {
      const component = editor();
      component.endTime = endTime;
      component.save();
      expect(component.invalid).toBeTrue();
      expect(writes).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    });
  }

  it('rejects DST gaps and preserves the original repeated hour and seconds', () => {
    localization.and.returnValue({ timeZone: 'America/New_York' });
    store.dispatch(
      updateWorkSession({
        id: session.id,
        changes: {
          timeZone: 'America/New_York',
          start: Date.parse('2026-11-01T01:17:42-05:00'),
          end: Date.parse('2026-11-01T01:47:42-05:00'),
        },
        modified: 200,
      }),
    );
    writes.calls.reset();
    const component = editor();
    component.save();
    expect(current().session!.start).toBe(Date.parse('2026-11-01T01:17:42-05:00'));
    component.saved = false;
    writes.calls.reset();
    component.date = '2026-03-08';
    component.startTime = '02:17';
    component.save();
    expect(component.invalid).toBeTrue();
    expect(writes).not.toHaveBeenCalled();
  });
});
