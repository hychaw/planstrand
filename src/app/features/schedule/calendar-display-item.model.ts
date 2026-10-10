/** Derived calendar read model. Never persisted or dispatched as an entity. */
export interface CalendarDisplayItem {
  id: string;
  sourceType: 'workSession' | 'event' | 'eventOccurrence' | 'legacyTask' | 'external';
  sourceId: string;
  date?: string;
  start: number;
  end: number;
  timeZone?: string;
  title?: string;
  taskId?: string;
  completedAt?: number | null;
  isAllDay?: boolean;
  canMove: boolean;
  canResize: boolean;
  canDelete: boolean;
  isReadOnly: boolean;
}

/** sourceId is the persisted series lineage, never an individual Event id. */
export interface EventOccurrenceDisplayItem extends CalendarDisplayItem {
  sourceType: 'eventOccurrence';
  occurrence: {
    segmentId: string;
    slot: number;
    key: string;
    scheduledDate: string;
  };
}
