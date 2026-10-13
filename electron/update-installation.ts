import { execFile } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { win32 } from 'node:path';
import { UPDATE_APP_ID } from './update-trust';

// electron-builder's UUID v5 for UPDATE_APP_ID. Contract-tested against the
// installed builder; neither a channel label nor a marker establishes ownership.
export const UPDATE_INSTALL_GUID = 'f742ac0b-6794-588a-a5f8-d13e36ad8eb9';

export interface InstallationRegistration {
  hive: 'CurrentUser' | 'LocalMachine';
  view: 'Registry64' | 'Registry32';
  location: string;
  uninstall: string;
}

export interface InstallationContext {
  packaged: boolean;
  platform: string;
  arch: string;
  channel: string | null;
  executable: string;
}

const localDirectory = (value: string): boolean =>
  /^[a-z]:\\/i.test(value) &&
  !/[\x00-\x1f"<>|?*]/.test(value) &&
  !value.slice(2).includes(':') &&
  value.length > 3 &&
  win32.normalize(value) === value &&
  !value.endsWith('\\') &&
  value.split('\\').every((part) => !/[. ]$/.test(part));

/** Pure registration policy, shared by tests and the main-owned probe. Reject
 * mixed/all-user registrations, matching the existing NSIS customInit rules.
 * The registry is local installation evidence, never a publisher trust root.
 */
export const registeredInstallationDirectory = (
  context: InstallationContext,
  records: readonly InstallationRegistration[],
): string | undefined => {
  if (
    !context.packaged ||
    context.platform !== 'win32' ||
    context.arch !== 'x64' ||
    context.channel !== 'win-nsis' ||
    records.length !== 4
  )
    return undefined;
  if (
    records.some(
      (r) =>
        !r ||
        !['CurrentUser', 'LocalMachine'].includes(r.hive) ||
        !['Registry64', 'Registry32'].includes(r.view) ||
        typeof r.location !== 'string' ||
        typeof r.uninstall !== 'string',
    )
  )
    return undefined;
  if (new Set(records.map((r) => `${r.hive}/${r.view}`)).size !== 4) return undefined;
  const registration = records.find(
    (r) => r.hive === 'CurrentUser' && r.view === 'Registry64',
  );
  const sharedUserView = records.find(
    (r) => r.hive === 'CurrentUser' && r.view === 'Registry32',
  );
  if (
    !registration ||
    !sharedUserView ||
    // These HKCU Software keys are shared across WOW64 views. An identical
    // read is expected, not evidence of a second installation.
    sharedUserView.location !== registration.location ||
    sharedUserView.uninstall !== registration.uninstall ||
    records.some(
      (r) => r.hive === 'LocalMachine' && (r.location !== '' || r.uninstall !== ''),
    ) ||
    !localDirectory(registration.location) ||
    win32.basename(context.executable) !== 'Planstrand.exe' ||
    win32.dirname(context.executable).toLowerCase() !==
      registration.location.toLowerCase() ||
    registration.uninstall.toLowerCase() !==
      `"${registration.location}\\Uninstall Planstrand.exe" /currentuser`.toLowerCase()
  )
    return undefined;
  return registration.location;
};

// Fixed, read-only program. No renderer input, shell expansion, profile scripts,
// arbitrary registry keys, execution-policy bypass, or generic command IPC.
const REGISTRATION_QUERY = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$result = @()
foreach ($hive in @('CurrentUser', 'LocalMachine')) {
  foreach ($view in @('Registry64', 'Registry32')) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$hive, [Microsoft.Win32.RegistryView]::$view)
    try {
      $install = $base.OpenSubKey('Software\\${UPDATE_INSTALL_GUID}', $false)
      $remove = $base.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${UPDATE_INSTALL_GUID}', $false)
      try {
        $location = ''; $uninstall = ''
        if ($install) {
          if ($install.GetValueNames() -contains 'InstallLocation') {
            if ($install.GetValueKind('InstallLocation') -ne [Microsoft.Win32.RegistryValueKind]::String) { throw 'Invalid registration' }
            $location = $install.GetValue('InstallLocation')
          }
        }
        if ($remove) {
          if ($remove.GetValueNames() -contains 'UninstallString') {
            if ($remove.GetValueKind('UninstallString') -ne [Microsoft.Win32.RegistryValueKind]::String) { throw 'Invalid registration' }
            $uninstall = $remove.GetValue('UninstallString')
          }
        }
        $result += @{ hive = $hive; view = $view; location = $location; uninstall = $uninstall }
      } finally { if ($install) { $install.Dispose() }; if ($remove) { $remove.Dispose() } }
    } finally { $base.Dispose() }
  }
}
ConvertTo-Json -Compress -InputObject $result
`;

export const readInstallationRegistrations = async (): Promise<
  InstallationRegistration[]
> => {
  if (process.platform !== 'win32') throw new Error('Installation unavailable');
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !localDirectory(systemRoot))
    throw new Error('Installation unavailable');
  return new Promise((resolve, reject) => {
    execFile(
      win32.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(REGISTRATION_QUERY, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        try {
          if (error) throw error;
          const records: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ''));
          if (!Array.isArray(records) || records.length !== 4)
            throw new Error('Invalid registration');
          resolve(records as InstallationRegistration[]);
        } catch {
          reject(new Error('Installation unavailable'));
        }
      },
    );
  });
};

/** Supplemental filesystem evidence. Conservative alias/link checks; this is
 * eligibility at probe time, NOT a race-free authorization to execute NSIS.
 */
export const verifyInstallationFiles = async (directory: string): Promise<void> => {
  let ancestor = directory;
  while (true) {
    const info = await lstat(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Installation unavailable');
    try {
      await lstat(win32.join(ancestor, '.git'));
      throw new Error('Installation unavailable');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = win32.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if ((await realpath(directory)).toLowerCase() !== directory.toLowerCase())
    throw new Error('Installation unavailable');
  for (const name of [
    'Planstrand.exe',
    'Uninstall Planstrand.exe',
    'planstrand-install.ini',
  ]) {
    const info = await lstat(win32.join(directory, name));
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0)
      throw new Error('Installation unavailable');
  }
  const marker = win32.join(directory, 'planstrand-install.ini');
  if ((await lstat(marker)).size > 1024) throw new Error('Installation unavailable');
  const text = (await readFile(marker, 'utf8')).replace(/^\uFEFF/, '').trim();
  if (!/^\[Planstrand\]\r?\nAppId=io\.github\.hychaw\.planstrand$/i.test(text))
    throw new Error('Installation unavailable');
  // Keep the marker identity coupled to authenticated package identity.
  if (text.split('=')[1].toLowerCase() !== UPDATE_APP_ID)
    throw new Error('Installation unavailable');
};

export const isRegisteredUpdateInstallation = async (
  context: InstallationContext,
): Promise<boolean> => {
  if (
    !context.packaged ||
    context.platform !== 'win32' ||
    context.arch !== 'x64' ||
    context.channel !== 'win-nsis'
  )
    return false;
  try {
    const directory = registeredInstallationDirectory(
      context,
      await readInstallationRegistrations(),
    );
    if (!directory) return false;
    await verifyInstallationFiles(directory);
    return true;
  } catch {
    return false;
  }
};
