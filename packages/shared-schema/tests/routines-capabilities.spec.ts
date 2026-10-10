import { describe, it, expect } from 'vitest';
import {
  ROUTINES_V1,
  CLIENT_SYNC_READER_CAPABILITIES,
  SERVER_SYNC_READER_CAPABILITIES,
  getFullStateRequiredCapabilities,
  getFullStateRequiredEntityTypes,
  supportsRequiredCapabilities,
  SUPER_SYNC_OPERATION_CAPABILITIES,
} from '../src';

describe('conditional Routines reader requirements', () => {
  it('advertises support without activating it for absent or exact empty slices', () => {
    expect(CLIENT_SYNC_READER_CAPABILITIES).toContain(ROUTINES_V1);
    expect(SERVER_SYNC_READER_CAPABILITIES).toContain(ROUTINES_V1);
    expect(SUPER_SYNC_OPERATION_CAPABILITIES.supportedEntityTypes).toContain(
      'EVENT_SERIES',
    );
    for (const state of [{}, { eventSeries: { ids: [], entities: {} } }]) {
      expect(getFullStateRequiredCapabilities(state)).toEqual([]);
      expect(getFullStateRequiredEntityTypes(state)).not.toContain('EVENT_SERIES');
    }
  });
  it('infers the semantic fence from series and fails closed for malformed slices', () => {
    for (const eventSeries of [
      null,
      undefined,
      [],
      {},
      { ids: ['s'], entities: { s: {} } },
      { ids: [], entities: {}, future: true },
    ]) {
      expect(getFullStateRequiredCapabilities({ eventSeries })).toEqual([ROUTINES_V1]);
      expect(getFullStateRequiredEntityTypes({ eventSeries })).toContain('EVENT_SERIES');
    }
  });
  it('keeps a durable activated floor even after all series disappear', () => {
    const restored = JSON.parse(
      JSON.stringify({
        eventSeries: { ids: [], entities: {} },
        requiredCapabilities: [ROUTINES_V1],
      }),
    );
    expect(getFullStateRequiredCapabilities(restored)).toEqual([ROUTINES_V1]);
    expect(
      supportsRequiredCapabilities(getFullStateRequiredCapabilities(restored), []),
    ).toBe(false);
  });
});
