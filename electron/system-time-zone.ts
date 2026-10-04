import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const windowsTimeZoneToIana = (windowsId: string): string | null => {
  // Windows added this ID in 2026 before the bundled ICU Windows mapping knew it.
  // Map identity only; Intl's America/Vancouver rules still determine every offset.
  // https://techcommunity.microsoft.com/blog/dstblog/interim-guidance-for-british-columbia-time-zone-changes-2026/4544988
  return windowsId === 'British Columbia Standard Time' ? 'America/Vancouver' : null;
};

export const getNativeSystemTimeZone = (): string | null => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone) return zone;
  if (process.platform !== 'win32') return null;
  try {
    const result = execFileSync(
      join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'),
      [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation',
        '/v',
        'TimeZoneKeyName',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 },
    );
    const id = /TimeZoneKeyName\s+REG_SZ\s+([^\r\n]+)/.exec(result)?.[1].trim();
    return id ? windowsTimeZoneToIana(id) : null;
  } catch {
    return null;
  }
};
