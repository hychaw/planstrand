import {
  DistChannel,
  distChannelSuffix,
  extractSemver,
  getAppSemver,
  getAppVersionStr,
} from './get-app-version-str';
import { environment } from '../../environments/environment';
import { PLANSTRAND_PRODUCT_VERSION } from './planstrand-product-version';

describe('distChannelSuffix', () => {
  const cases: [DistChannel, string][] = [
    ['win-nsis', 'W'],
    ['win-portable', 'P'],
    ['win-store', 'MS'],
    ['mac-dmg', 'D'],
    ['mac-store', 'MAS'],
    ['linux-appimage', 'AI'],
    ['linux-snap', 'SN'],
    ['linux-flatpak', 'FP'],
    ['linux-native', 'L'],
    ['android-play', 'A'],
    ['android-fdroid', 'AF'],
    ['ios', 'I'],
    ['web', 'WB'],
  ];

  cases.forEach(([channel, suffix]) => {
    it(`maps ${channel} -> "${suffix}"`, () => {
      expect(distChannelSuffix(channel)).toBe(suffix);
    });
  });

  it('maps null/undefined -> "" (no suffix)', () => {
    expect(distChannelSuffix(null)).toBe('');
    expect(distChannelSuffix(undefined)).toBe('');
  });
});

describe('getAppVersionStr', () => {
  it('reports the product version without the inherited package/channel suffix', () => {
    expect(getAppVersionStr()).toBe(PLANSTRAND_PRODUCT_VERSION);
    expect(getAppVersionStr()).toBe('1.1.0-rc.1');
  });
});

describe('extractSemver', () => {
  it('keeps a bare semver as is', () => {
    expect(extractSemver('18.22.0')).toBe('18.22.0');
  });

  it('strips the Android launch-mode marker', () => {
    expect(extractSemver('18.22.0_L1')).toBe('18.22.0');
  });

  it('returns undefined when no version leads the string', () => {
    expect(extractSemver('')).toBeUndefined();
    expect(extractSemver('dev')).toBeUndefined();
    expect(extractSemver('v18.22.0')).toBeUndefined();
  });
});

describe('getAppSemver', () => {
  it('reports the bare package version in a browser context, without the channel suffix', () => {
    expect(getAppSemver()).toBe(environment.version);
  });
});
