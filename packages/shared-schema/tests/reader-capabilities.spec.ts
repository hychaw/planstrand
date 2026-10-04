import { describe, expect, it } from 'vitest';
import { ENTITY_TYPES } from '../src/entity-types';
import { supportsRequiredEntityTypes } from '../src/full-state-capabilities';
import {
  CLIENT_SYNC_READER_CAPABILITIES,
  TASK_FOLDER_OWNERSHIP_V1,
  supportsRequiredCapabilities,
  getFullStateRequiredCapabilities,
} from '../src/reader-capabilities';
import {
  SuperSyncOperationResponseSchema,
  SuperSyncUploadSnapshotRequestSchema,
} from '../src/supersync-http-contract';

describe('semantic sync reader capabilities', () => {
  it('does not grant ownership semantics to existing Folder readers', () => {
    expect(supportsRequiredEntityTypes(['FOLDER'], ENTITY_TYPES)).toBe(true);
    expect(CLIENT_SYNC_READER_CAPABILITIES).toEqual([TASK_FOLDER_OWNERSHIP_V1]);
    expect(supportsRequiredCapabilities([TASK_FOLDER_OWNERSHIP_V1], [])).toBe(false);
  });
  it('accepts a simulated future reader with ownership support', () => {
    expect(
      supportsRequiredCapabilities(
        [TASK_FOLDER_OWNERSHIP_V1],
        [TASK_FOLDER_OWNERSHIP_V1],
      ),
    ).toBe(true);
  });
  it('advertises ownership support on the current client', () => {
    expect(
      supportsRequiredCapabilities(
        [TASK_FOLDER_OWNERSHIP_V1],
        CLIENT_SYNC_READER_CAPABILITIES,
      ),
    ).toBe(true);
  });
  it('infers requirements from active and archived Task ownership, excluding unrelated settings', () => {
    for (const state of [
      { task: { entities: { t: { folderId: 'INBOX_FOLDER' } } } },
      { archiveYoung: { task: { entities: { t: { folderId: 'stale' } } } } },
      { archiveOld: { task: { entities: { t: { folderId: 'manual' } } } } },
    ])
      expect(getFullStateRequiredCapabilities(state)).toEqual([TASK_FOLDER_OWNERSHIP_V1]);
    expect(
      getFullStateRequiredCapabilities({
        task: { entities: { t: {} } },
        pluginUserData: { folderId: 'unrelated' },
      }),
    ).toEqual([]);
  });
  it('defaults a missing advertisement to no semantic support', () => {
    expect(supportsRequiredCapabilities([TASK_FOLDER_OWNERSHIP_V1])).toBe(false);
  });
  it('rejects unknown and malformed requirements', () => {
    for (const requirement of [['FUTURE'], null, 'FUTURE', [42]])
      expect(supportsRequiredCapabilities(requirement, [TASK_FOLDER_OWNERSHIP_V1])).toBe(
        false,
      );
  });
  it('keeps existing operations compatible', () => {
    expect(supportsRequiredCapabilities(undefined)).toBe(true);
    expect(supportsRequiredCapabilities([])).toBe(true);
    expect(supportsRequiredEntityTypes(['FOLDER'], ['TASK'])).toBe(false);
  });
  it('preserves bounded optional requirements outside encrypted snapshot payloads', () => {
    const snapshot = {
      state: 'ciphertext',
      clientId: 'writer',
      reason: 'initial',
      vectorClock: {},
      schemaVersion: 5,
      isPayloadEncrypted: true,
      requiredEntityTypes: ['FOLDER'],
      requiredCapabilities: [TASK_FOLDER_OWNERSHIP_V1],
    };
    expect(
      SuperSyncUploadSnapshotRequestSchema.parse(JSON.parse(JSON.stringify(snapshot)))
        .requiredCapabilities,
    ).toEqual(snapshot.requiredCapabilities);
    expect(
      SuperSyncOperationResponseSchema.parse({
        id: 'op',
        clientId: 'writer',
        actionType: 'test',
        opType: 'UPD',
        entityType: 'TASK',
        payload: 'ciphertext',
        vectorClock: {},
        timestamp: 1,
        schemaVersion: 5,
        requiredCapabilities: snapshot.requiredCapabilities,
      }).requiredCapabilities,
    ).toEqual(snapshot.requiredCapabilities);
  });
});
