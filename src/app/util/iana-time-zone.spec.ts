import {
  getSystemIanaTimeZone,
  isValidIanaTimeZone,
  resolveIanaTimeZone,
} from './iana-time-zone';

describe('IANA time zones', () => {
  it('accepts a known IANA zone', () => {
    expect(isValidIanaTimeZone('America/Vancouver')).toBe(true);
  });

  ['Invalid/Zone', '', '+01:00', '-08:00'].forEach((timeZone) => {
    it(`rejects ${JSON.stringify(timeZone)}`, () => {
      expect(isValidIanaTimeZone(timeZone)).toBe(false);
    });
  });

  describe('resolution', () => {
    let systemOptionsSpy: jasmine.Spy;

    beforeEach(() => {
      const options = Intl.DateTimeFormat().resolvedOptions();
      systemOptionsSpy = spyOn(
        Intl.DateTimeFormat.prototype,
        'resolvedOptions',
      ).and.returnValue({ ...options, timeZone: 'Europe/Berlin' });
    });

    it('reads the system IANA zone', () => {
      expect(getSystemIanaTimeZone()).toBe('Europe/Berlin');
    });

    [null, undefined].forEach((timeZone) => {
      it(`uses the system zone for ${timeZone}`, () => {
        expect(resolveIanaTimeZone(timeZone)).toBe('Europe/Berlin');
      });
    });

    it('uses a valid configured zone without reading the system zone', () => {
      expect(resolveIanaTimeZone('America/Vancouver')).toBe('America/Vancouver');
      expect(systemOptionsSpy).not.toHaveBeenCalled();
    });

    it('fails an invalid configured zone without falling through to the system', () => {
      expect(resolveIanaTimeZone('Invalid/Zone')).toBeNull();
      expect(systemOptionsSpy).not.toHaveBeenCalled();
    });

    ['', 'Invalid/Zone'].forEach((timeZone) => {
      it(`fails when the system returns ${JSON.stringify(timeZone)}`, () => {
        const options = { ...Intl.DateTimeFormat().resolvedOptions(), timeZone };
        systemOptionsSpy.and.returnValue(options);
        expect(getSystemIanaTimeZone()).toBeNull();
        expect(resolveIanaTimeZone(null)).toBeNull();
      });
    });

    it('fails when the environment cannot provide a system zone', () => {
      systemOptionsSpy.and.throwError('System zone unavailable');
      expect(getSystemIanaTimeZone()).toBeNull();
      expect(resolveIanaTimeZone(undefined)).toBeNull();
    });
  });

  it('fails when Intl formatting is unavailable', () => {
    spyOn(Intl, 'DateTimeFormat').and.throwError('Intl unavailable');
    expect(isValidIanaTimeZone('America/Vancouver')).toBe(false);
    expect(getSystemIanaTimeZone()).toBeNull();
  });
});
