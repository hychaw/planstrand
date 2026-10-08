import { getDbDateStr } from '../../../util/get-db-date-str';
import {
  zonedDateTimeFields,
  zonedDateTimeToTimestamp,
} from '../../../util/iana-time-zone';

describe('ShortSyntaxEffects timezone test', () => {
  describe('plannedDayInIsoFormat calculation', () => {
    it('uses the local calendar date on both sides of midnight', () => {
      // Short syntax receives an instant and stores its system-local date.
      // Local constructors define the fixture without assuming the host's zone
      // or requiring Intl to disclose its default zone (not guaranteed on Windows).
      expect(getDbDateStr(new Date(2025, 0, 16, 23, 59).getTime())).toBe('2025-01-16');
      expect(getDbDateStr(new Date(2025, 0, 17, 0, 0).getTime())).toBe('2025-01-17');
    });

    it('preserves local day keys for winter, summer and DST transition dates', () => {
      for (const date of ['2026-01-17', '2026-07-17', '2026-03-08', '2026-11-01']) {
        const instant = zonedDateTimeToTimestamp(date, '23:30', 'America/Vancouver');
        expect(instant).withContext(date).not.toBeNull();
        const fields = zonedDateTimeFields(instant!, 'America/Vancouver');
        expect(fields).toEqual({ date, time: '23:30' });
        const [year, month, day] = fields.date.split('-').map(Number);
        // The parser constructs a local Date from wall fields; no UTC ISO slicing.
        expect(getDbDateStr(new Date(year, month - 1, day, 23, 30))).toBe(date);
      }
    });
  });
});
