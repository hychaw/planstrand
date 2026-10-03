import { INBOX_FOLDER_ID } from '../../features/folder/folder.const';
import { isFolderState } from '../../features/folder/folder-state';

/** SuperSync advertises server vocabulary, not the capabilities of every peer.
 * Until snapshots carry an enforced reader manifest, only the canonical default
 * Folder domain is safe in a SuperSync full-state replacement. File v4 is gated
 * by its durable semantic manifest; local backups remain current-reader artifacts.
 */
export const assertFolderSuperSyncSnapshotCompatible = (state: unknown): void => {
  if (!state || typeof state !== 'object' || !Object.hasOwn(state, 'folder')) return;
  const folder = (state as { folder?: unknown }).folder;
  if (
    isFolderState(folder) &&
    folder.ids.length === 1 &&
    folder.ids[0] === INBOX_FOLDER_ID &&
    (folder.entities[INBOX_FOLDER_ID]!.orderKey ?? 'V') === 'V'
  )
    return;
  throw new Error(
    'Folder-bearing SuperSync snapshots are not supported until all readers can enforce the Folder capability. Use operation sync or a current-client file provider.',
  );
};
