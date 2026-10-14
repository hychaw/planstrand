import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { NotifyService } from '../../core/notify/notify.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { GlobalConfigService } from '../config/global-config.service';
import { selectEventEntities } from '../event/store/event.selectors';
import { selectWorkSessionEntities } from '../work-session/store/work-session.selectors';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { LocalEvent } from '../event/event.model';
import { WorkSession } from '../work-session/work-session.model';
import { DEFAULT_TASK } from '../tasks/task.model';
import {
  LOCAL_SCHEDULE_REMINDER_KEY,
  LocalScheduleReminderService,
  SCHEDULE_REMINDER_GRACE_MS,
  ScheduleReminderOffset,
} from './local-schedule-reminder.service';

describe('device-local Event and WorkSession reminders', () => {
  const now = 1800000000000;
  const event: LocalEvent = {
    id: 'e',
    title: 'Meeting',
    isAllDay: false,
    start: now,
    end: now + 3600000,
    timeZone: 'UTC',
    created: 1,
    modified: 1,
  };
  const session: WorkSession = {
    id: 'w',
    taskId: 't',
    start: now,
    end: now + 3600000,
    created: 1,
    modified: 1,
  };
  let service: LocalScheduleReminderService;
  let store: MockStore;
  let loaded: BehaviorSubject<boolean>;
  let disabled: boolean;
  let notify: jasmine.Spy;
  let imex: ImexViewService;
  const restart = (): LocalScheduleReminderService => {
    const next = TestBed.runInInjectionContext(() => new LocalScheduleReminderService());
    next.init();
    return next;
  };
  const events = (value: LocalEvent | undefined): void => {
    store.overrideSelector(selectEventEntities, value ? { e: value } : {});
    store.refreshState();
  };
  const sessions = (value: WorkSession | undefined): void => {
    store.overrideSelector(selectWorkSessionEntities, value ? { w: value } : {});
    store.refreshState();
  };
  beforeEach(() => {
    localStorage.removeItem(LOCAL_SCHEDULE_REMINDER_KEY);
    spyOn(Date, 'now').and.returnValue(now);
    loaded = new BehaviorSubject(false);
    disabled = false;
    notify = jasmine.createSpy('notifyDesktop').and.returnValue(Promise.resolve());
    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: loaded },
        },
        {
          provide: GlobalConfigService,
          useValue: { cfg: () => ({ reminder: { disableReminders: disabled } }) },
        },
        { provide: NotifyService, useValue: { notifyDesktop: notify } },
      ],
    });
    store = TestBed.inject(MockStore);
    events(event);
    sessions(session);
    store.overrideSelector(selectTaskEntities, {
      t: { ...DEFAULT_TASK, id: 't', title: 'Focus', projectId: 'INBOX' },
    });
    imex = TestBed.inject(ImexViewService);
    service = restart();
    loaded.next(true);
  });
  afterEach(() => {
    store.resetSelectors();
    localStorage.removeItem(LOCAL_SCHEDULE_REMINDER_KEY);
  });

  it('defaults Off and persists setting/disabling by kind and identity across restart', () => {
    expect(service.offset('event', 'e')).toBeNull();
    service.set('event', 'e', 15);
    service = restart();
    expect(service.offset('event', 'e')).toBe(15);
    expect(service.offset('workSession', 'e')).toBeNull();
    service.set('event', 'e', null);
    expect(restart().offset('event', 'e')).toBeNull();
    expect(service.set('event', 'e', 7 as ScheduleReminderOffset)).toBeFalse();
  });
  [0, 5, 10, 15, 30, 60].forEach((offset) => {
    it(`derives ${offset}-minute offset from the hydrated start`, () => {
      const offsetMs = offset * 60000;
      const start = now + offsetMs;
      events({ ...event, start: start + 1 } as LocalEvent);
      service.set('event', 'e', offset as ScheduleReminderOffset);
      service.checkDue();
      expect(notify).not.toHaveBeenCalled();
      events({ ...event, start } as LocalEvent);
      service.checkDue();
      expect(notify).toHaveBeenCalledTimes(1);
    });
  });
  it('deduplicates ticks, startup, resume and Off/On for the same instant', () => {
    service.set('event', 'e', 0);
    service.checkDue();
    service.checkDue();
    service = restart();
    service.checkDue();
    service.set('event', 'e', null);
    service.set('event', 'e', 0);
    service.checkDue();
    expect(notify).toHaveBeenCalledTimes(1);
  });
  for (const [kind, id] of [
    ['event', 'e'],
    ['workSession', 'w'],
  ] as const) {
    it(`delivers ${kind} without a native toast tag and still deduplicates the instant`, () => {
      service.set(kind, id, 0);
      service.checkDue();
      const [options, guard] = notify.calls.mostRecent().args;
      expect(options.title).toBe(kind === 'event' ? 'Meeting' : 'Focus');
      expect(options.tag).toBeUndefined();
      expect(guard()).toBeTrue();
      restart().checkDue();
      expect(notify).toHaveBeenCalledTimes(1);
    });
  }
  it('waits for initial hydration and pauses during imports or globally disabled reminders', () => {
    loaded.next(false);
    service = restart();
    service.set('event', 'e', 0);
    service.checkDue();
    expect(notify).not.toHaveBeenCalled();
    loaded.next(true);
    disabled = true;
    service.checkDue();
    disabled = false;
    imex.setDataImportInProgress(true);
    service.checkDue();
    expect(notify).not.toHaveBeenCalled();
    imex.setDataImportInProgress(false);
    service.checkDue();
    expect(notify).toHaveBeenCalledTimes(1);
  });
  for (const kind of ['event', 'workSession'] as const) {
    const id = kind === 'event' ? 'e' : 'w';
    const move = (start: number): void =>
      kind === 'event'
        ? events({ ...event, start } as LocalEvent)
        : sessions({ ...session, start });
    it(`recalculates moved ${kind}, delivers a new instant and never replays an old one`, () => {
      service.set(kind, id, 0);
      move(now + 60000);
      service.checkDue();
      expect(notify).not.toHaveBeenCalled();
      move(now);
      service.checkDue();
      move(now - 1000);
      service.checkDue();
      move(now);
      service.checkDue();
      expect(notify).toHaveBeenCalledTimes(2);
    });
    it(`stops deleted ${kind} and cancels an in-flight stale notification`, () => {
      service.set(kind, id, 0);
      service.checkDue();
      const guard = notify.calls.mostRecent().args[1] as () => boolean;
      expect(guard()).toBeTrue();
      if (kind === 'event') events(undefined);
      else sessions(undefined);
      expect(guard()).toBeFalse();
      notify.calls.reset();
      service.checkDue();
      expect(notify).not.toHaveBeenCalled();
    });
  }
  it('stops completed WorkSessions, including while notification permission is pending', () => {
    service.set('workSession', 'w', 0);
    sessions({ ...session, completedAt: now });
    service.checkDue();
    expect(notify).not.toHaveBeenCalled();
    sessions(session);
    service.checkDue();
    const guard = notify.calls.mostRecent().args[1] as () => boolean;
    sessions({ ...session, completedAt: now });
    expect(guard()).toBeFalse();
  });
  it('ignores all-day conversions, and revalidates movement, Off and global disabling before delivery', () => {
    service.set('event', 'e', 0);
    events({
      id: 'e',
      title: 'All day',
      isAllDay: true,
      date: '2027-01-15',
      created: 1,
      modified: 1,
    });
    service.checkDue();
    expect(notify).not.toHaveBeenCalled();
    events(event);
    service.checkDue();
    const guard = notify.calls.mostRecent().args[1] as () => boolean;
    events({ ...event, start: now + 10000 } as LocalEvent);
    expect(guard()).toBeFalse();
    events(event);
    disabled = true;
    expect(guard()).toBeFalse();
    disabled = false;
    service.set('event', 'e', null);
    expect(guard()).toBeFalse();
  });
  it('delivers within the bounded startup/resume grace and consumes historical overdue reminders silently', () => {
    service.set('event', 'e', 0);
    events({ ...event, start: now - SCHEDULE_REMINDER_GRACE_MS } as LocalEvent);
    service.checkDue();
    expect(notify).toHaveBeenCalledTimes(1);
    events({ ...event, start: now - SCHEDULE_REMINDER_GRACE_MS - 1 } as LocalEvent);
    service.checkDue();
    restart().checkDue();
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('fails closed when persisting the delivery record fails', () => {
    service.set('event', 'e', 0);
    spyOn(localStorage, 'setItem').and.throwError('Storage full');
    service.checkDue();
    expect(notify).not.toHaveBeenCalled();
  });
  it('does not dispatch shared operations or alter Task reminder fields', () => {
    const dispatch = spyOn(store, 'dispatch');
    service.set('workSession', 'w', 5);
    service.checkDue();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('ignores corrupt preferences safely', () => {
    localStorage.setItem(LOCAL_SCHEDULE_REMINDER_KEY, '{broken');
    expect(restart().offset('event', 'e')).toBeNull();
  });
});
