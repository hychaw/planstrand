import { createSelector } from '@ngrx/store';
import { selectAllWorkSessions } from '../work-session/store/work-session.selectors';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { selectTimelineTasks } from '../work-context/store/work-context.selectors';
import { projectLocalCalendarDisplayItems } from './calendar-display-item';

export const selectLocalCalendarDisplayItems = createSelector(
  selectAllWorkSessions,
  selectTaskEntities,
  selectTimelineTasks,
  (sessions, tasks, timelineTasks) =>
    projectLocalCalendarDisplayItems(sessions, tasks, timelineTasks.planned),
);
