import { inject, Injectable } from '@angular/core';
import { EMPTY, timer } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { PLANSTRAND_PRODUCT_VERSION } from '../../util/planstrand-product-version';
import { T } from '../../t.const';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { GlobalConfigService } from '../../features/config/global-config.service';
import { UpdateDownloadStatus } from '../../../../electron/shared-with-frontend/update.model';
import { BannerService } from '../banner/banner.service';
import { BannerId } from '../banner/banner.model';
import { SnackService } from '../snack/snack.service';
import { LS } from '../persistence/storage-keys.const';
import { Log } from '../log';
import { isUpdateCheckPossible } from './is-update-check-possible.util';
import { IS_ELECTRON_TOKEN } from '../../app.constants';

const INITIAL_CHECK_DELAY = 30 * 1000;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/**
 * Desktop-only "new version available" check (#5463). Fetches the latest
 * eligible GitHub release and shows a once-per-version banner linking to the
 * release page or explicitly requested verified download on supported NSIS builds.
 *
 * Privacy: a bare unauthenticated GET with no identifiers or user data; the
 * automatic check can be disabled via `misc.isCheckForUpdates` and is skipped
 * entirely on self-updating channels (see is-update-check-possible.util.ts).
 */
@Injectable({ providedIn: 'root' })
export class UpdateCheckService {
  private _isElectron = inject(IS_ELECTRON_TOKEN);
  private _globalConfigService = inject(GlobalConfigService);
  private _bannerService = inject(BannerService);
  private _snackService = inject(SnackService);

  private _isCheckInFlight = false;
  private _isDownloading = false;

  init(): void {
    if (!isUpdateCheckPossible(this._isElectron)) {
      return;
    }
    this._globalConfigService.misc$
      .pipe(
        // Hydration merges defaults per-key (global-config.reducer loadAllData),
        // but the pre-hydration initial state and partial section updates can
        // still lack the key — treat missing as the default ON either way.
        map((misc) => misc?.isCheckForUpdates !== false),
        distinctUntilChanged(),
        switchMap((isEnabled) =>
          isEnabled ? timer(INITIAL_CHECK_DELAY, CHECK_INTERVAL) : EMPTY,
        ),
      )
      .subscribe(() => this.checkForUpdate());
  }

  async checkForUpdate({ isUserTriggered = false } = {}): Promise<void> {
    if (this._isCheckInFlight || this._isDownloading) {
      return;
    }
    this._isCheckInFlight = true;
    try {
      const { tag: tagName, canDownload } = await window.ea.discoverUpdate();
      if (!tagName) {
        if (isUserTriggered) {
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.APP.UPDATE_CHECK.UP_TO_DATE,
            translateParams: { version: PLANSTRAND_PRODUCT_VERSION },
          });
        }
        return;
      }
      if (
        !isUserTriggered &&
        localStorage.getItem(LS.UPDATE_CHECK_DISMISSED_VERSION) === tagName
      ) {
        return;
      }
      this._showUpdateBanner(tagName, canDownload);
    } catch {
      // being offline is a normal state for the automatic check → info log only
      Log.log('Update check unavailable');
      if (isUserTriggered) {
        this._snackService.open({ type: 'ERROR', msg: T.APP.UPDATE_CHECK.ERROR });
      }
    } finally {
      this._isCheckInFlight = false;
    }
  }

  private _showUpdateBanner(versionTag: string, canDownload = false): void {
    // Built locally from the validated tag instead of trusting the response's
    // html_url: openExternalUrl only checks the scheme, so a forged response
    // could otherwise point "Download" at an arbitrary https host.
    const downloadUrl = `https://github.com/hychaw/planstrand/releases/tag/${versionTag}`;
    this._bannerService.open({
      id: BannerId.UpdateAvailable,
      msg: T.APP.B_UPDATE_AVAILABLE.MSG,
      translateParams: { version: versionTag },
      ico: 'file_download',
      // the plain X would not persist the dismissal → the banner would nag
      // again on the next check; both explicit actions below do persist
      isHideDismissBtn: true,
      isKeepVisibleAfterAction: canDownload,
      action: {
        label: T.APP.B_UPDATE_AVAILABLE.DOWNLOAD,
        fn: () => {
          this._rememberVersion(versionTag);
          if (canDownload) {
            void this._download(versionTag);
          } else {
            window.ea.openExternalUrl(downloadUrl);
          }
        },
      },
      action2: {
        label: T.G.DISMISS,
        fn: () => {
          this._rememberVersion(versionTag);
          this._bannerService.dismiss(BannerId.UpdateAvailable);
        },
      },
    });
  }

  private async _download(tag: string): Promise<void> {
    if (this._isDownloading) return;
    this._isDownloading = true;
    let visible = true;
    let polling = false;
    let finished = false;
    const show = (status: UpdateDownloadStatus): void => {
      if (!visible) return;
      const messages = {
        idle: T.APP.UPDATE_CHECK.VERIFYING,
        downloading: T.APP.UPDATE_CHECK.DOWNLOADING,
        verifying: T.APP.UPDATE_CHECK.VERIFYING,
        ready: T.APP.UPDATE_CHECK.READY,
        error: T.APP.UPDATE_CHECK.DOWNLOAD_ERROR,
      };
      this._bannerService.open({
        id: BannerId.UpdateAvailable,
        msg: messages[status.state],
        translateParams: { version: tag, percent: status.percent ?? 0 },
        ico: status.state === 'error' ? 'error_outline' : 'file_download',
        action:
          status.state === 'error'
            ? {
                label: T.APP.UPDATE_CHECK.RELEASE_PAGE,
                fn: () =>
                  window.ea.openExternalUrl(
                    `https://github.com/hychaw/planstrand/releases/tag/${tag}`,
                  ),
              }
            : undefined,
        action2: {
          label: T.G.DISMISS,
          fn: () => {
            visible = false;
            this._bannerService.dismiss(BannerId.UpdateAvailable);
          },
        },
        isHideDismissBtn: true,
        isKeepVisibleAfterAction: true,
      });
    };
    show({ state: 'verifying', tag });
    const interval = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const status = await window.ea.getUpdateDownloadStatus();
        if (!finished) show(status);
      } catch {
        /* Final invoke supplies the result. */
      } finally {
        polling = false;
      }
    }, 500);
    try {
      const status = await window.ea.downloadUpdate(tag);
      finished = true;
      show(status);
    } catch {
      finished = true;
      show({ state: 'error', tag });
    } finally {
      clearInterval(interval);
      this._isDownloading = false;
    }
  }

  private _rememberVersion(versionTag: string): void {
    localStorage.setItem(LS.UPDATE_CHECK_DISMISSED_VERSION, versionTag);
  }
}
