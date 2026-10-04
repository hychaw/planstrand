import { EntityState } from '@ngrx/entity';
interface EventBase {
  id: string;
  title: string;
  created: number;
  modified: number;
}
/** All-day dates are calendar dates, never UTC instants. */
export type LocalEvent = EventBase &
  (
    | { isAllDay: true; date: string }
    | { isAllDay: false; start: number; end: number; timeZone: string }
  );
export type EventInput =
  | { title: string; isAllDay: true; date: string }
  | { title: string; isAllDay: false; start: number; end: number; timeZone: string };
export interface EventState extends EntityState<LocalEvent> {
  ids: string[];
}
