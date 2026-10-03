import { EntityState } from '@ngrx/entity';

export interface Folder {
  readonly id: string;
  readonly title: string;
  /** Missing parentId defaults to a root; ancestry is never duplicated in child arrays. */
  readonly parentId?: string | null;
  /** Absolute sibling position; legacy/omitted values use the fixed key V. */
  readonly orderKey?: string;
}

/** ids is canonical identity enumeration; sibling order belongs to each Folder. */
export interface FolderState extends EntityState<Folder> {
  ids: string[];
}
