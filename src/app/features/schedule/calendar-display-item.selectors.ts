import { selectAllEvents } from '../event/store/event.selectors';
import { projectEvent } from './calendar-display-item';
import { createSelector } from '@ngrx/store';
import {
  selectAllWorkSessions,
  selectWorkSessionFeatureState,
} from '../work-session/store/work-session.selectors';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { selectTimelineTasks } from '../work-context/store/work-context.selectors';
import { projectLocalCalendarDisplayItems } from './calendar-display-item';

export const selectLocalCalendarDisplayItems = createSelector(
  selectAllWorkSessions,
  selectTaskEntities,
  selectTimelineTasks,
  selectWorkSessionFeatureState,
  (sessions, tasks, timelineTasks, state) =>
    projectLocalCalendarDisplayItems(
      sessions,
      tasks,
      timelineTasks.planned,
      state?.dismissedLegacySessionIds,
    ),
);

export const selectPersistedCalendarDisplayItems = createSelector(
  selectLocalCalendarDisplayItems,
  selectAllEvents,
  (items, events) => [...items, ...events.map(projectEvent)],
);
