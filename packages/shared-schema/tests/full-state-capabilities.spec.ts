import { describe, it, expect } from 'vitest';
import {
  hasMeaningfulFolderState,
  getFullStateRequiredEntityTypes,
  supportsRequiredEntityTypes,
} from '../src/full-state-capabilities';
const bootstrap = {
  ids: ['INBOX_FOLDER'],
  entities: { INBOX_FOLDER: { id: 'INBOX_FOLDER', title: 'Inbox', parentId: null } },
};
describe('Full-state reader requirements', () => {
  it('does not require Folder for absent/default bootstrap', () => {
    expect(getFullStateRequiredEntityTypes({})).toEqual([]);
    expect(getFullStateRequiredEntityTypes({ folder: bootstrap })).toEqual([]);
    expect(
      hasMeaningfulFolderState({
        folder: {
          ...bootstrap,
          entities: {
            INBOX_FOLDER: { ...bootstrap.entities.INBOX_FOLDER, orderKey: 'V' },
          },
        },
      }),
    ).toBe(false);
  });
  for (const folder of [
    {
      ...bootstrap,
      ids: ['INBOX_FOLDER', 'x'],
      entities: { ...bootstrap.entities, x: { id: 'x', title: 'X' } },
    },
    { ...bootstrap, legacyProjectMigrationComplete: true },
    {
      ...bootstrap,
      entities: { INBOX_FOLDER: { ...bootstrap.entities.INBOX_FOLDER, title: 'Other' } },
    },
    {
      ...bootstrap,
      entities: { INBOX_FOLDER: { ...bootstrap.entities.INBOX_FOLDER, orderKey: 'Z' } },
    },
    null,
    { ids: [], entities: {} },
  ])
    it('requires Folder for meaningful or malformed present state', () => {
      expect(getFullStateRequiredEntityTypes({ folder })).toEqual(['FOLDER']);
    });
  it('refuses unknown/malformed requirements instead of silently ignoring them', () => {
    expect(supportsRequiredEntityTypes(['FOLDER'], ['FOLDER'])).toBe(true);
    for (const required of [['FOLDER'], ['FUTURE'], null, 'FOLDER', [42]])
      expect(supportsRequiredEntityTypes(required, ['TASK'])).toBe(false);
    expect(supportsRequiredEntityTypes(undefined, [])).toBe(true);
    expect(supportsRequiredEntityTypes([], [])).toBe(true);
  });
});
