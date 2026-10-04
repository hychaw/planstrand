import {
  calendarAddDays,
  calendarDate,
  calendarDayStart,
  calendarDisplayZone,
  calendarHours,
  calendarTimeRow,
  calendarClockLabel,
} from './calendar-time';
import {
  selectLocalCalendarDisplayItems,
  selectPersistedCalendarDisplayItems,
} from './calendar-display-item.selectors';
import { mapToScheduleDays } from './map-schedule-data/map-to-schedule-days';
import { mapScheduleDaysToScheduleEvents } from './map-schedule-data/map-schedule-days-to-schedule-events';
import { anchorContextNow } from './anchor-context-now';
import { DEFAULT_TASK, TaskWithDueTime } from '../tasks/task.model';
import { LocalEvent } from '../event/event.model';
import { WorkSession } from '../work-session/work-session.model';
import { FH } from './schedule.const';

describe('Calendar display timezone and persisted timed projections', () => {
  const zone = 'America/Vancouver';
  const now = Date.parse('2026-10-04T19:21:00Z');
  // The reported persisted record is 09:00–10:00 UTC, i.e. 02:00–03:00 Vancouver.
  const event: LocalEvent = {
    id: 'persisted',
    title: 'Early event',
    isAllDay: false,
    start: 1791104400000,
    end: 1791108000000,
    timeZone: 'UTC',
    created: now,
    modified: now,
  };
  const session: WorkSession = {
    id: 'session',
    taskId: 'owner',
    start: now,
    end: now + 3600000,
    timeZone: 'Asia/Tokyo',
    created: now,
    modified: now,
  };
  const task: TaskWithDueTime = {
    ...DEFAULT_TASK,
    id: 'owner',
    projectId: 'INBOX',
    title: 'Owner',
    dueWithTime: Date.parse('2026-10-05T06:30:00Z'),
    timeEstimate: 1800000,
  };

  for (const length of [1, 7, 35]) {
    it(`keeps persisted Event, WorkSession and legacy Task in the same ${length}-day projection after noon`, () => {
      const persisted = JSON.parse(JSON.stringify({ event, session, task })) as {
        event: LocalEvent;
        session: WorkSession;
        task: TaskWithDueTime;
      };
      const items = selectPersistedCalendarDisplayItems.projector(
        selectLocalCalendarDisplayItems.projector(
          [persisted.session],
          { owner: persisted.task },
          { planned: [persisted.task], unPlanned: [] },
          { ids: ['session'], entities: { session: persisted.session } },
        ),
        [persisted.event],
      );
      const first = length === 35 ? '2026-09-28' : '2026-10-04';
      const dates = Array.from({ length }, (_, i) => calendarAddDays(first, i));
      const days = mapToScheduleDays(
        anchorContextNow(first, now, zone),
        dates,
        [],
        [persisted.task],
        [],
        [],
        [],
        null,
        {},
        { startTime: '9:00', endTime: '17:00' },
        undefined,
        now,
        items,
        zone,
      );
      const projected = mapScheduleDaysToScheduleEvents(days, FH, zone).eventsFlat;
      for (const [id, hours] of [
        ['event:persisted', 2],
        ['workSession:session', 12.35],
        ['owner', 23.5],
      ] as const) {
        const entries = projected.filter((e) => e.id === id);
        expect(entries.length).withContext(id).toBe(1);
        expect(entries[0].plannedForDay).toBe('2026-10-04');
        expect(entries[0].startHours).toBe(hours);
        expect(entries[0].style).toContain(`grid-row: ${Math.round(hours * FH) + 1}`);
      }
      expect(persisted.event).toEqual(event);
      expect(persisted.session).toEqual(session);
    });
  }

  it('places the current-time line and an event at the same 12:21 Vancouver wall-clock row', () => {
    expect(calendarHours(now, zone)).toBe(12.35);
    expect(calendarTimeRow(now, zone, FH)).toBe(149);
    expect(calendarDate(now, zone)).toBe('2026-10-04');
    expect(calendarDate(Date.parse('2026-10-05T06:30:00Z'), zone)).toBe('2026-10-04');
  });
  it('uses IANA spring-forward rules and 23-hour day boundaries', () => {
    expect(calendarHours(Date.parse('2026-03-08T09:30:00Z'), zone)).toBe(1.5);
    expect(calendarHours(Date.parse('2026-03-08T10:30:00Z'), zone)).toBe(3.5);
    expect(
      calendarDayStart('2026-03-09', zone) - calendarDayStart('2026-03-08', zone),
    ).toBe(23 * 3600000);
    expect(calendarTimeRow(Date.parse('2026-03-08T10:30:00Z'), zone, FH)).toBe(43);
  });
  it('uses both occurrences of the historical fall-back hour without moving persisted instants', () => {
    for (const instant of ['2025-11-02T08:30:00Z', '2025-11-02T09:30:00Z']) {
      expect(calendarHours(Date.parse(instant), zone)).toBe(1.5);
      expect(calendarTimeRow(Date.parse(instant), zone, FH)).toBe(19);
    }
    expect(
      calendarDayStart('2025-11-03', zone) - calendarDayStart('2025-11-02', zone),
    ).toBe(25 * 3600000);
  });
  it('selects configured zone, then system IANA zone, then UTC', () => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions.call(
      new Intl.DateTimeFormat(),
    );
    const system = spyOn(
      Intl.DateTimeFormat.prototype,
      'resolvedOptions',
    ).and.returnValue({ ...original, timeZone: 'Asia/Tokyo' });
    expect(calendarDisplayZone(zone)).toBe(zone);
    expect(calendarDisplayZone('Invalid/Zone')).toBe('Asia/Tokyo');
    expect(calendarDisplayZone()).toBe('Asia/Tokyo');
    system.and.returnValue({ ...original, timeZone: undefined as unknown as string });
    expect(calendarDisplayZone()).toBe('UTC');
  });
  it('distinguishes early morning, noon and afternoon in 12-hour labels', () => {
    expect(calendarClockLabel(2, 'en-US', false)).toBe('2:00 AM');
    expect(calendarClockLabel(12, 'en-US', false)).toBe('12:00 PM');
    expect(calendarClockLabel(13, 'en-US', false)).toBe('1:00 PM');
  });
});
