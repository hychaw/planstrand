import { EntityState } from '@ngrx/entity';

export interface WorkSession {
  id: string;
  taskId: string;
  start: number;
  end: number;
  completedAt?: number | null;
  created: number;
  modified: number;
}

export interface WorkSessionState extends EntityState<WorkSession> {
  ids: string[];
}

export type WorkSessionEditableFields = Pick<WorkSession, 'taskId' | 'start' | 'end'>;

export type WorkSessionUpdate = Partial<WorkSessionEditableFields>;
