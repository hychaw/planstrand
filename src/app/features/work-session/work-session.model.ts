import { EntityState } from '@ngrx/entity';

export interface WorkSession {
  id: string;
  taskId: string;
  start: number;
  end: number;
  /** Intended IANA scheduling zone; absent only on legacy persisted sessions. */
  timeZone?: string;
  completedAt?: number | null;
  created: number;
  modified: number;
}

export interface WorkSessionState extends EntityState<WorkSession> {
  ids: string[];
  /** Exact legacy schedule identities intentionally removed; absent means none. */
  dismissedLegacySessionIds?: string[];
}

export type WorkSessionEditableFields = Pick<
  WorkSession,
  'taskId' | 'start' | 'end' | 'timeZone'
>;

export type WorkSessionUpdate = Partial<WorkSessionEditableFields>;
