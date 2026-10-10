import { selectPersistedCalendarDisplayItems } from './calendar-display-item.selectors';
import { projectEvent } from './calendar-display-item';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { CalendarDisplayService } from './calendar-display.service';
import { selectAllEventSeries } from '../routines/store/event-series.selectors';
import { EventSeries } from '../routines/event-series.model';
import { selectLocalizationConfig } from '../config/store/global-config.reducer';
import { CurrentDateService } from '../../core/date/current-date.service';
import { projectWorkSession } from './calendar-display-item';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { ScheduleCalendarMapEntry } from './schedule.model';

describe('CalendarDisplayService', () => {
  it('owns independent bounded queries and keeps expansion independent of Task, provider and clock updates', () => {
    const series: EventSeries = {
      id: 'series',
      title: 'Routine',
      created: 1,
      modified: 1,
      segments: [
        {
          id: 'segment',
          recurrence: { frequency: 'daily', startDate: '1900-01-01', interval: 1 },
          timing: {
            kind: 'timed',
            localTime: '09:00',
            timeZone: 'Asia/Tokyo',
            durationMs: 3600000,
          },
        },
      ],
    };
    const events = new BehaviorSubject<ScheduleCalendarMapEntry[]>([]);
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectAllEventSeries, value: [series] },
            { selector: selectLocalizationConfig, value: { timeZone: 'UTC' } },
            { selector: selectPersistedCalendarDisplayItems, value: [] },
          ],
        }),
        { provide: CalendarIntegrationService, useValue: { calendarEvents$: events } },
        {
          provide: HiddenCalendarProvidersService,
          useValue: { hiddenProviderIds: signal([]) },
        },
      ],
    });
    const store = TestBed.inject(MockStore);
    const dispatch = spyOn(store, 'dispatch');
    const service = TestBed.inject(CalendarDisplayService);
    const days = signal(['2026-01-10']);
    const first = service.createItemsForDaysComputed(days);
    const second = service.createItemsForDaysComputed(signal(['2026-02-01']));
    const original = first()[0];
    expect(original.sourceType).toBe('eventOccurrence');
    expect(second()[0].start).toBe(Date.parse('2026-02-01T00:00:00Z'));
    expect(service.items()).toEqual([]);
    const local = projectWorkSession({
      id: 'session',
      taskId: 'task',
      start: 100,
      end: 200,
      created: 1,
      modified: 1,
    });
    store.overrideSelector(selectPersistedCalendarDisplayItems, [local]);
    store.refreshState();
    days.set(['2026-01-10']); // Same range, newly allocated by a clock-dependent caller.
    expect(first().find((item) => item.sourceType === 'eventOccurrence')).toBe(original);
    events.next([]);
    expect(first().find((item) => item.sourceType === 'eventOccurrence')).toBe(original);
    TestBed.inject(CurrentDateService).refresh();
    expect(first().find((item) => item.sourceType === 'eventOccurrence')).toBe(original);
    days.set(['2026-01-11']);
    const next = first().find((item) => item.sourceType === 'eventOccurrence')!;
    expect(next.start).toBe(Date.parse('2026-01-11T00:00:00Z'));
    expect(next.id).not.toBe(original.id);
    expect(second().find((item) => item.sourceType === 'eventOccurrence')!.start).toBe(
      Date.parse('2026-02-01T00:00:00Z'),
    );
    store.overrideSelector(selectLocalizationConfig, { timeZone: 'America/Los_Angeles' });
    store.refreshState();
    days.set(['2026-01-10']);
    const shifted = first().find((item) => item.sourceType === 'eventOccurrence')!;
    expect(shifted.id).toBe(next.id);
    expect(shifted.start).toBe(next.start);
    expect(dispatch).not.toHaveBeenCalled();
  });
  afterEach(() => TestBed.inject(MockStore).resetSelectors());
  it('merges local/provider items, reacts to capabilities/visibility, and never dispatches', () => {
    const local = projectWorkSession({
      id: 'session',
      taskId: 'task',
      start: 100,
      end: 200,
      timeZone: 'America/Vancouver',
      created: 50,
      modified: 50,
    });
    const events = new BehaviorSubject<ScheduleCalendarMapEntry[]>([
      {
        items: [
          {
            id: 'event',
            calProviderId: 'calendar',
            issueProviderKey: 'plugin:calendar',
            title: 'Calendar event',
            start: 300,
            duration: 100,
          },
          {
            id: 'ical',
            calProviderId: 'ical-calendar',
            issueProviderKey: 'ICAL',
            title: 'Read only',
            start: 500,
            duration: 100,
          },
        ],
      },
    ]);
    const hiddenProviderIds = signal<string[]>([]);
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          selectors: [{ selector: selectPersistedCalendarDisplayItems, value: [local] }],
        }),
        { provide: CalendarIntegrationService, useValue: { calendarEvents$: events } },
        { provide: HiddenCalendarProvidersService, useValue: { hiddenProviderIds } },
      ],
    });
    const store = TestBed.inject(MockStore);
    const dispatch = spyOn(store, 'dispatch');
    const registry = TestBed.inject(PluginIssueProviderRegistryService);
    const service = TestBed.inject(CalendarDisplayService);
    expect(service.items().length).toBe(3);
    expect(service.items()[0]).toEqual(local);
    expect(service.items()[1].isReadOnly).toBeTrue();
    expect(service.items()).toBe(service.items());
    registry.register({
      pluginId: 'calendar',
      name: 'calendar',
      humanReadableName: 'Calendar',
      icon: 'event',
      pollIntervalMs: 1000,
      issueStrings: { singular: 'event', plural: 'events' },
      definition: {
        configFields: [],
        getHeaders: () => ({}),
        searchIssues: async () => [],
        getById: async () => ({
          id: 'event',
          title: 'Calendar event',
          body: '',
          url: '',
        }),
        getIssueLink: () => '',
        issueDisplay: [],
        updateIssue: async () => undefined,
        deleteIssue: async () => undefined,
      },
    });
    expect(service.items()[1].canMove).toBeTrue();
    expect(service.items()[1].canDelete).toBeTrue();
    expect(service.items()[1].canResize).toBeFalse();
    expect(service.items()[2].isReadOnly).toBeTrue();
    hiddenProviderIds.set(['calendar']);
    expect(service.items().map((item) => item.sourceId)).toEqual(['session', 'ical']);
    events.next([]);
    expect(service.items()).toEqual([local]);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('combines WorkSession, local Event and external items without provider duplicates', () => {
    const local = projectEvent({
      id: 'local',
      title: 'Local',
      isAllDay: true,
      date: '2026-10-04',
      created: 50,
      modified: 50,
    });
    const session = projectWorkSession({
      id: 'session',
      taskId: 'task',
      start: 100,
      end: 200,
      timeZone: 'UTC',
      created: 50,
      modified: 50,
    });
    const external = {
      id: 'external',
      calProviderId: 'provider',
      issueProviderKey: 'ICAL',
      title: 'External',
      start: 300,
      duration: 100,
    };
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectPersistedCalendarDisplayItems, value: [session, local] },
          ],
        }),
        {
          provide: CalendarIntegrationService,
          useValue: {
            calendarEvents$: new BehaviorSubject([{ items: [external, external] }]),
          },
        },
        {
          provide: HiddenCalendarProvidersService,
          useValue: { hiddenProviderIds: signal([]) },
        },
      ],
    });
    const service = TestBed.inject(CalendarDisplayService);
    expect(service.items().map((item) => item.sourceType)).toEqual([
      'workSession',
      'event',
      'external',
    ]);
    expect(service.externalCalendars()[0].items.length).toBe(1);
  });
});
