import {
  protectFullStateBackup,
  readFullStateBackup,
} from './full-state-backup-envelope';
import { createValidAppData } from '../validation/state-validity-test-utils';
import { initialFolderState } from '../../features/folder/folder-state';
import { addFolder } from '../../features/folder/store/folder.actions';
import { isDataRepairPossible } from '../validation/is-data-repair-possible.util';
import {
  countAllTasksInBackupStr,
  isUsableBackupStr,
  summarizeBackupStr,
} from '../../imex/local-backup/backup-ring.util';

describe('Folder backup envelope compatibility', () => {
  const meaningful = (): ReturnType<typeof createValidAppData> => ({
    ...createValidAppData(),
    folder: addFolder({
      state: initialFolderState,
      folder: { id: 'folder', title: 'Folder' },
    }).folderState,
  });
  it('makes meaningful Folder state opaque and unrepairable to the old import path', () => {
    const data = meaningful();
    const encoded = protectFullStateBackup(data);
    expect(
      isDataRepairPossible(encoded as ReturnType<typeof createValidAppData>),
    ).toBeFalse();
    expect(readFullStateBackup(JSON.parse(JSON.stringify(encoded)))).toEqual(
      JSON.parse(JSON.stringify(data)),
    );
    expect((encoded as { requiredEntityTypes: string[] }).requiredEntityTypes).toEqual([
      'FOLDER',
    ]);
  });
  it('retains raw compatibility for default and absent Folder state', () => {
    for (const state of [
      createValidAppData(),
      { ...createValidAppData(), folder: initialFolderState },
    ])
      expect(protectFullStateBackup(state)).toBe(state);
  });
  it('checks requirements before unwrapping for apply', () => {
    expect(() =>
      readFullStateBackup({
        requiredEntityTypes: ['FUTURE'],
        appDataComplete: meaningful(),
      }),
    ).toThrowError(/unsupported entity/);
  });
  it('keeps native backup availability, summary and shrink guards aware of wrapped state', () => {
    const json = JSON.stringify(protectFullStateBackup(meaningful()));
    expect(isUsableBackupStr(json)).toBeTrue();
    expect(summarizeBackupStr(json)?.projectCount).toBe(1);
    expect(countAllTasksInBackupStr(json)).toBe(0);
  });
});
