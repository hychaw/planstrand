import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { ScheduleService } from './schedule.service';
import { DateService } from '../../core/date/date.service';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import { TaskService } from '../tasks/task.service';
import { DEFAULT_TASK, TaskWithDueTime } from '../tasks/task.model';
import { WorkSession } from '../work-session/work-session.model';
import { legacyTaskWorkSessionId } from '../work-session/legacy-task-work-session-backfill';
import { selectLocalCalendarDisplayItems } from './calendar-display-item.selectors';
import { selectTimelineTasks } from '../work-context/store/work-context.selectors';
import { selectTaskRepeatCfgsWithAndWithoutStartTime } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { selectTimelineConfig } from '../config/store/global-config.reducer';
import { selectPlannerDayMap } from '../planner/store/planner.selectors';
import { mapScheduleDaysToScheduleEvents } from './map-schedule-data/map-schedule-days-to-schedule-events';
import { FH, SVEType } from './schedule.const';
import { isDraggableSE } from './map-schedule-data/is-schedule-types-type';
import { ScheduleDay, ScheduleFromCalendarEvent } from './schedule.model';

describe('Schedule WorkSession read integration', () => {
  const now = new Date(2026, 0, 15).getTime();
  const start = new Date(2026, 0, 15, 10, 45).getTime();
  const task: TaskWithDueTime = {
    ...DEFAULT_TASK,
    id: 'task',
    title: 'Current title',
    projectId: 'INBOX',
    dueWithTime: start,
    timeEstimate: 3600000,
  };
  const session: WorkSession = {
    id: 'session',
    taskId: task.id,
    start,
    end: start + 3600000,
    created: now,
    modified: now,
    timeZone: 'America/Vancouver',
  };
  const external: ScheduleFromCalendarEvent = {
    id: 'external',
    calProviderId: 'provider',
    issueProviderKey: 'ICAL',
    title: 'External',
    start,
    duration: 1800000,
    isReferenceCalendar: true,
  };
  let service: ScheduleService;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ScheduleService,
        DateService,
        provideMockStore({
          selectors: [
            { selector: selectLocalCalendarDisplayItems, value: [] },
            { selector: selectTimelineTasks, value: { planned: [task], unPlanned: [] } },
            {
              selector: selectTaskRepeatCfgsWithAndWithoutStartTime,
              value: { withStartTime: [], withoutStartTime: [] },
            },
            {
              selector: selectTimelineConfig,
              value: { isWorkStartEndEnabled: false, isLunchBreakEnabled: false },
            },
            { selector: selectPlannerDayMap, value: {} },
          ],
        }),
        { provide: TaskService, useValue: { currentTaskId: () => null } },
        {
          provide: CalendarIntegrationService,
          useValue: {
            calendarEvents$: of([
              { items: [external, { ...external, id: 'all-day', isAllDay: true }] },
            ]),
          },
        },
        {
          provide: HiddenCalendarProvidersService,
          useValue: { hiddenProviderIds: signal([]) },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    service = TestBed.inject(ScheduleService);
  });

  const project = (sessions: WorkSession[]): void => {
    store.overrideSelector(
      selectLocalCalendarDisplayItems,
      selectLocalCalendarDisplayItems.projector(
        sessions,
        { [task.id]: task },
        { planned: [task], unPlanned: [] },
        {
          ids: sessions.map((s) => s.id),
          entities: Object.fromEntries(sessions.map((s) => [s.id, s])),
        },
      ),
    );
    store.refreshState();
  };
  const read = (days = ['2026-01-15', '2026-01-16']): ScheduleDay[] =>
    service.createScheduleDaysWithContext({
      daysToShow: days,
      contextNow: now,
      realNow: now,
      currentTaskId: null,
    });

  it('renders distinct sessions including completion with exact range and current title', () => {
    project([session, { ...session, id: 'second', completedAt: session.end }]);
    const days = read();
    const entries = days
      .flatMap((day) => day.entries)
      .filter((entry) => entry.type === SVEType.WorkSession);
    expect(entries.map((entry) => entry.id)).toEqual([
      'workSession:session',
      'workSession:second',
    ]);
    expect(entries[0].start).toBe(start);
    expect(entries[0].duration).toBe(session.end - start);
    expect(entries[0].data.title).toBe(task.title);
    const events = mapScheduleDaysToScheduleEvents(days, FH).eventsFlat.filter(
      (event) => event.type === SVEType.WorkSession,
    );
    expect(events.length).toBe(2);
    expect(events[0].startHours).toBe(10.75);
    expect(events[0].timeLeftInHours).toBe(1);
    expect(events[0].overlap?.count).toBeGreaterThan(1);
    expect(events.every((event) => !isDraggableSE(event))).toBeTrue();
    expect(service.getEventsForDay('2026-01-15', events).length).toBe(2);
  });

  it('suppresses only the migrated legacy block even after move and completion', () => {
    project([
      {
        ...session,
        id: legacyTaskWorkSessionId(task.id, start),
        start: start + 7200000,
        end: session.end + 7200000,
        completedAt: session.end,
      },
      session,
    ]);
    const entries = read().flatMap((day) => day.entries);
    expect(entries.filter((entry) => entry.type === SVEType.ScheduledTask).length).toBe(
      0,
    );
    expect(entries.filter((entry) => entry.type === SVEType.WorkSession).length).toBe(2);
  });

  it('refreshes the displayed title from current Task state', () => {
    project([session]);
    const days = service.createScheduleDaysComputed(signal(['2026-01-15']));
    expect(
      days()[0].entries.find((entry) => entry.type === SVEType.WorkSession)?.data.title,
    ).toBe(task.title);
    store.overrideSelector(
      selectLocalCalendarDisplayItems,
      selectLocalCalendarDisplayItems.projector(
        [session],
        { [task.id]: { ...task, title: 'Renamed Task', isDone: true } },
        { planned: [task], unPlanned: [] },
        { ids: [session.id], entities: { [session.id]: session } },
      ),
    );
    store.refreshState();
    expect(
      days()[0].entries.find((entry) => entry.type === SVEType.WorkSession)?.data.title,
    ).toBe('Renamed Task');
  });

  it('clips sessions at both visible week edges and excludes outside sessions', () => {
    const weekEnd = new Date(2026, 0, 22).getTime();
    project([
      { ...session, id: 'first', start: now - 1800000, end: now + 1800000 },
      { ...session, id: 'last', start: weekEnd - 1800000, end: weekEnd + 1800000 },
      { ...session, id: 'outside', start: weekEnd, end: weekEnd + 3600000 },
    ]);
    const days = read(service.getDaysToShow(7, new Date(now)));
    const entries = days
      .flatMap((day) => day.entries)
      .filter((entry) => entry.type === SVEType.WorkSession);
    expect(entries.map((entry) => [entry.id, entry.start, entry.duration])).toEqual([
      ['workSession:first', now, 1800000],
      ['workSession:last', weekEnd - 1800000, 1800000],
    ]);
  });

  it('keeps legacy fallback and one reference integration event on their existing paths', () => {
    project([session]);
    const entries = read().flatMap((day) => day.entries);
    expect(entries.filter((entry) => entry.type === SVEType.ScheduledTask).length).toBe(
      1,
    );
    const events = entries.filter((entry) => entry.type === SVEType.CalendarEvent);
    expect(events.length).toBe(1); // Explicit all-day events still do not block timed slots.
    expect(events[0].data).toEqual({ ...external, icon: 'event' });
    expect(events[0].start).toBe(external.start);
    expect(events[0].duration).toBe(external.duration);
  });

  it('clips midnight and visible range boundaries using the existing day splitter', () => {
    const midnight = new Date(2026, 0, 16).getTime();
    project([{ ...session, start: midnight - 1800000, end: midnight + 1800000 }]);
    const entries = read()
      .flatMap((day) => day.entries)
      .filter((entry) => entry.type === SVEType.WorkSession);
    expect(entries.map((entry) => [entry.start, entry.duration])).toEqual([
      [midnight - 1800000, 1800000],
      [midnight, 1800000],
    ]);
    expect(
      entries.every(
        (entry) =>
          entry.data.start === midnight - 1800000 &&
          entry.data.end === midnight + 1800000,
      ),
    ).toBeTrue();
    const boundary = read(['2026-01-16'])
      .flatMap((day) => day.entries)
      .filter((entry) => entry.type === SVEType.WorkSession);
    expect(boundary.length).toBe(1);
    expect(boundary[0].start).toBe(midnight);
  });

  it('consumes the projection in the day-panel computed path without dispatching', () => {
    project([session]);
    const dispatch = spyOn(store, 'dispatch');
    const days = service.createScheduleDaysComputed(signal(['2026-01-15']))();
    expect(
      days
        .flatMap((day) => day.entries)
        .some((entry) => entry.id === 'workSession:session'),
    ).toBeTrue();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
