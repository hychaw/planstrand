import { compareReleaseVersions, newestPlanstrandRelease } from './planstrand-release';

describe('Planstrand release discovery', () => {
  const release = (tag_name: string, extra = {}): object => ({
    tag_name,
    draft: false,
    prerelease: tag_name.includes('-'),
    ...extra,
  });

  for (const [older, newer] of [
    ['1.2.0-rc.1', '1.2.0-rc.2'],
    ['1.2.0-rc.2', '1.2.0-rc.10'],
    ['1.2.0-rc.2', '1.2.0'],
    ['1.2.0', '1.3.0-rc.1'],
    ['1.3.0-rc.1', '1.3.0'],
    ['1.9.0', '1.10.0'],
  ]) {
    it(`orders ${older} before ${newer}`, () => {
      expect(compareReleaseVersions(newer, older)).toBeGreaterThan(0);
      expect(compareReleaseVersions(older, newer)).toBeLessThan(0);
      expect(compareReleaseVersions('v' + older, older)).toBe(0);
    });
  }

  it('selects by version rather than API order and allows RC builds to advance', () => {
    expect(
      newestPlanstrandRelease(
        [release('v1.2.0-rc.2'), release('v1.3.0-rc.1'), release('v1.2.0')],
        '1.2.0-rc.1',
      ),
    ).toBe('v1.3.0-rc.1');
  });

  it('keeps stable builds on stable releases, including API prerelease flags', () => {
    expect(
      newestPlanstrandRelease(
        [
          release('v1.3.0-rc.1'),
          release('v1.4.0', { prerelease: true }),
          release('v1.2.1'),
        ],
        '1.2.0',
      ),
    ).toBe('v1.2.1');
    expect(newestPlanstrandRelease([release('v1.3.0-rc.1')], '1.2.0')).toBeUndefined();
  });

  it('ignores drafts, malformed data and unsupported channels', () => {
    expect(
      newestPlanstrandRelease(
        [
          release('v99.0.0', { draft: true }),
          null,
          {},
          ...[
            'v99.0.0-beta.1',
            'v99.0.0-rc',
            'v99.0.0-rc.01',
            'v099.0.0',
            'v99.0.0/evil',
            'v99.0.0\n',
            'v99.0.0<img>',
            'v99.0.0+build',
          ].map((tag) => release(tag)),
          release('v1.2.0-rc.2'),
        ],
        '1.2.0-rc.1',
      ),
    ).toBe('v1.2.0-rc.2');
  });

  it('does not offer equal or older releases and accepts an empty list', () => {
    expect(
      newestPlanstrandRelease(
        [release('v1.2.0'), release('v1.2.0-rc.10'), release('v1.1.0')],
        '1.2.0',
      ),
    ).toBeUndefined();
    expect(newestPlanstrandRelease([], '1.2.0')).toBeUndefined();
  });
});
