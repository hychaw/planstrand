/** Planstrand's supported release channels: stable and numbered release candidates. */
const parseReleaseVersion = (tag: string): number[] | null => {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.exec(
    tag,
  );
  if (!match || match[0] !== tag) return null;
  const version = match.slice(1, 4).map(Number);
  if (match[4] !== undefined) version.push(Number(match[4]));
  return version.every(Number.isSafeInteger) ? version : null;
};

/** Positive means a is newer; stable follows every RC of the same base version. */
export const compareReleaseVersions = (a: string, b: string): number => {
  const left = parseReleaseVersion(a);
  const right = parseReleaseVersion(b);
  if (!left || !right) throw new Error('Unsupported Planstrand release version');
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  if (left.length !== right.length) return left.length === 3 ? 1 : -1;
  return (left[3] ?? 0) - (right[3] ?? 0);
};

/** Ignore remote URLs and unsupported tags; channel policy follows the local build. */
export const newestPlanstrandRelease = (
  releases: unknown[],
  currentVersion: string,
): string | undefined => {
  const current = parseReleaseVersion(currentVersion);
  if (!current) throw new Error('Unsupported local Planstrand version');
  let newest: string | undefined;
  for (const release of releases) {
    if (!release || typeof release !== 'object') continue;
    const { tag_name: tag, draft, prerelease } = release as Record<string, unknown>;
    if (draft !== false || typeof tag !== 'string') continue;
    const version = parseReleaseVersion(tag);
    if (!version) continue;
    if (current.length === 3 && (version.length !== 3 || prerelease !== false)) continue;
    if (compareReleaseVersions(tag, currentVersion) <= 0) continue;
    if (!newest || compareReleaseVersions(tag, newest) > 0) newest = tag;
  }
  return newest;
};
