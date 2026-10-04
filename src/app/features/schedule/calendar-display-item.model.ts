/** Derived calendar read model. Never persisted or dispatched as an entity. */
export interface CalendarDisplayItem {
  id: string;
  sourceType: 'workSession' | 'event' | 'legacyTask' | 'external';
  sourceId: string;
  date?: string;
  start: number;
  end: number;
  timeZone?: string;
  title?: string;
  taskId?: string;
  isAllDay?: boolean;
  canMove: boolean;
  canResize: boolean;
  canDelete: boolean;
  isReadOnly: boolean;
}
