import { app, ipcMain } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDistChannel } from './shared-with-frontend/get-dist-channel';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { UpdateDownloadService } from './update-download';
import { isAppOriginUrl } from './navigation-guard';
import { getAppLoadedUrl, getWin } from './main-window';

export const isVerifiedDownloadEligible = (
  packaged: boolean,
  platform: string,
  arch: string,
  channel: string | null,
  installed: boolean,
): boolean =>
  packaged &&
  platform === 'win32' &&
  arch === 'x64' &&
  channel === 'win-nsis' &&
  installed;

export const initUpdateIpc = (): void => {
  const service = new UpdateDownloadService({
    // electron-builder stamps the Planstrand product version into package.json.
    // Development retains the upstream package version, so read its local product
    // metadata only there. No runtime require outside the packaged electron tree.
    currentVersion: app.isPackaged
      ? app.getVersion()
      : JSON.parse(readFileSync(join(__dirname, '../planstrand-product.json'), 'utf8'))
          .version,
    stagingRoot: join(app.getPath('temp'), 'Planstrand-updates'),
    eligible: () =>
      isVerifiedDownloadEligible(
        app.isPackaged,
        process.platform,
        process.arch,
        getDistChannel(),
        existsSync(join(dirname(process.execPath), 'planstrand-install.ini')) &&
          existsSync(join(dirname(process.execPath), 'Uninstall Planstrand.exe')),
      ),
  });
  const authorize = (event: Electron.IpcMainInvokeEvent): void => {
    const frame = event.senderFrame;
    const expectedUrl = getAppLoadedUrl();
    if (
      !expectedUrl ||
      event.sender !== getWin().webContents ||
      !frame ||
      frame !== event.sender.mainFrame ||
      !isAppOriginUrl(frame.url, expectedUrl)
    )
      throw new Error('Update request unavailable');
  };
  ipcMain.handle(IPC.UPDATE_DISCOVER, async (event) => {
    authorize(event);
    try {
      return await service.discover();
    } catch {
      throw new Error('Update check unavailable');
    }
  });
  ipcMain.handle(IPC.UPDATE_DOWNLOAD, (event, tag: unknown) => {
    authorize(event);
    return service.download(tag);
  });
  ipcMain.handle(IPC.UPDATE_STATUS, (event) => {
    authorize(event);
    return service.status();
  });
};
