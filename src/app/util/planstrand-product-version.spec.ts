import { planstrandBuildRevision } from './planstrand-product-version';

describe('Planstrand build revision presentation', () => {
  it('shortens a real revision', () => {
    expect(planstrandBuildRevision('526d9b156353dc9de6dc39b159d40b99fcf4a25f')).toBe(
      '526d9b1',
    );
  });

  it('omits missing metadata and generator placeholders', () => {
    for (const revision of [undefined, '', 'NO_REV', 'NO_BRANCH', 'HEAD', '<unknown>']) {
      expect(planstrandBuildRevision(revision)).toBeUndefined();
    }
  });
});
