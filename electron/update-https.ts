import { get, Agent } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { IncomingMessage } from 'node:http';

/** API requests never redirect; assets may only reach GitHub's release CDN.
 * Signed CDN query strings must never be logged.
 */
export const validateUpdateUrl = (input: string, asset: boolean): URL => {
  const u = new URL(input);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) {
    throw new Error('Unsafe update URL');
  }
  const allowed = asset
    ? (u.hostname === 'github.com' &&
        /^\/hychaw\/planstrand\/releases\/download\/v[^/]+\/[^/]+$/.test(u.pathname)) ||
      (u.hostname === 'release-assets.githubusercontent.com' &&
        u.pathname.startsWith('/github-production-release-asset/'))
    : u.hostname === 'api.github.com' &&
      /^\/repos\/hychaw\/planstrand\/releases(?:\/tags\/v[^/]+)?$/.test(u.pathname);
  if (!allowed) throw new Error('Unofficial update URL');
  return u;
};

// Separate from Electron certificate-error and from https.globalAgent.
const updateAgent = new Agent({
  rejectUnauthorized: true,
  checkServerIdentity,
  maxSockets: 2,
});

export const openUpdateResponse = async (
  input: string,
  asset: boolean,
  signal: AbortSignal,
  hops = 0,
): Promise<IncomingMessage> => {
  const url = validateUpdateUrl(input, asset);
  if (hops > 5) throw new Error('Too many update redirects');
  const res = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = get(
      url,
      {
        agent: updateAgent,
        rejectUnauthorized: true,
        checkServerIdentity,
        minVersion: 'TLSv1.2',
        signal,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'User-Agent': 'Planstrand-Update',
          Accept: asset ? 'application/octet-stream' : 'application/vnd.github+json',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Accept-Encoding': 'identity',
        },
      },
      resolve,
    );
    req.setTimeout(15000, () => req.destroy(new Error('Update timeout')));
    req.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
    res.destroy();
    if (!asset || !res.headers.location) throw new Error('Invalid update redirect');
    return openUpdateResponse(
      new URL(res.headers.location, url).href,
      asset,
      signal,
      hops + 1,
    );
  }
  if (
    res.statusCode !== 200 ||
    (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
  ) {
    res.destroy();
    throw new Error('Update request failed');
  }
  return res;
};

export const readUpdateBytes = async (
  input: string,
  asset: boolean,
  max: number,
): Promise<Buffer> => {
  const res = await openUpdateResponse(input, asset, AbortSignal.timeout(30000));
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of res) {
      bytes += chunk.length;
      if (bytes > max) throw new Error('Update metadata too large');
      chunks.push(chunk);
    }
    if (!res.complete) throw new Error('Incomplete update response');
    return Buffer.concat(chunks);
  } finally {
    res.destroy();
  }
};
