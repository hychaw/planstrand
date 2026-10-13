import { fakeAsync, TestBed, tick, discardPeriodicTasks } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { UpdateCheckService } from './update-check.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { BannerService } from '../banner/banner.service';
import { BannerId, Banner } from '../banner/banner.model';
import { SnackService } from '../snack/snack.service';
import { LS } from '../persistence/storage-keys.const';
import { T } from '../../t.const';
import { ElectronAPI } from '../../../../electron/electronAPI';
import { IS_ELECTRON_TOKEN } from '../../app.constants';

describe('UpdateCheckService', () => {
  let service: UpdateCheckService;
  let banners: jasmine.SpyObj<BannerService>;
  let snacks: jasmine.SpyObj<SnackService>;
  let bridge: jasmine.SpyObj<ElectronAPI>;
  let original: ElectronAPI;
  let preferences: BehaviorSubject<{ isCheckForUpdates?: boolean }>;
  const latest = (): Banner => banners.open.calls.mostRecent().args[0];

  beforeEach(() => {
    original = window.ea;
    bridge = jasmine.createSpyObj('ea', [
      'discoverUpdate',
      'downloadUpdate',
      'getUpdateDownloadStatus',
      'openExternalUrl',
      'getDistChannel',
    ]);
    bridge.discoverUpdate.and.resolveTo({ tag: 'v99.0.0', canDownload: false });
    bridge.getDistChannel.and.returnValue('win-nsis');
    window.ea = bridge;
    preferences = new BehaviorSubject({});
    banners = jasmine.createSpyObj('BannerService', ['open', 'dismiss']);
    snacks = jasmine.createSpyObj('SnackService', ['open']);
    TestBed.configureTestingModule({
      providers: [
        { provide: IS_ELECTRON_TOKEN, useValue: true },
        { provide: BannerService, useValue: banners },
        { provide: SnackService, useValue: snacks },
        { provide: GlobalConfigService, useValue: { misc$: preferences } },
      ],
    });
    service = TestBed.inject(UpdateCheckService);
    localStorage.removeItem(LS.UPDATE_CHECK_DISMISSED_VERSION);
  });
  afterEach(() => {
    window.ea = original;
    localStorage.removeItem(LS.UPDATE_CHECK_DISMISSED_VERSION);
  });

  it('uses main-process discovery and retains manual fallback without authenticated metadata', async () => {
    await service.checkForUpdate();
    expect(latest().translateParams).toEqual({ version: 'v99.0.0' });
    latest().action?.fn();
    expect(bridge.openExternalUrl).toHaveBeenCalledWith(
      'https://github.com/hychaw/planstrand/releases/tag/v99.0.0',
    );
    expect(bridge.downloadUpdate).not.toHaveBeenCalled();
    expect(localStorage.getItem(LS.UPDATE_CHECK_DISMISSED_VERSION)).toBe('v99.0.0');
  });
  it('retains dismissal until an explicit check', async () => {
    await service.checkForUpdate();
    latest().action2?.fn();
    banners.open.calls.reset();
    await service.checkForUpdate();
    expect(banners.open).not.toHaveBeenCalled();
    await service.checkForUpdate({ isUserTriggered: true });
    expect(banners.open).toHaveBeenCalledTimes(1);
  });
  it('stays quiet offline during automatic checks and reports explicit failures', async () => {
    bridge.discoverUpdate.and.rejectWith(new Error('offline'));
    await service.checkForUpdate();
    expect(snacks.open).not.toHaveBeenCalled();
    await service.checkForUpdate({ isUserTriggered: true });
    expect(snacks.open).toHaveBeenCalledWith(jasmine.objectContaining({ type: 'ERROR' }));
  });
  it('reports current version only for explicit checks', async () => {
    bridge.discoverUpdate.and.resolveTo({ canDownload: false });
    await service.checkForUpdate();
    expect(snacks.open).not.toHaveBeenCalled();
    await service.checkForUpdate({ isUserTriggered: true });
    expect(snacks.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: 'SUCCESS' }),
    );
  });
  it('does not overlap discovery', async () => {
    await Promise.all([service.checkForUpdate(), service.checkForUpdate()]);
    expect(bridge.discoverUpdate).toHaveBeenCalledTimes(1);
  });
  it('downloads only on action and shows progress, verification, and ready without an install action', fakeAsync(() => {
    let finish!: (value: { state: 'ready' }) => void;
    bridge.discoverUpdate.and.resolveTo({ tag: 'v99.0.0', canDownload: true });
    bridge.downloadUpdate.and.returnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    bridge.getUpdateDownloadStatus.and.resolveTo({
      state: 'downloading',
      percent: 42,
      tag: 'v99.0.0',
    });
    void service.checkForUpdate();
    tick();
    expect(bridge.downloadUpdate).not.toHaveBeenCalled();
    latest().action?.fn();
    tick();
    expect(latest().msg).toBe(T.APP.UPDATE_CHECK.VERIFYING);
    tick(500);
    expect(latest().msg).toBe(T.APP.UPDATE_CHECK.DOWNLOADING);
    expect(latest().translateParams?.['percent']).toBe(42);
    bridge.getUpdateDownloadStatus.and.resolveTo({ state: 'verifying' });
    tick(500);
    expect(latest().msg).toBe(T.APP.UPDATE_CHECK.VERIFYING);
    finish({ state: 'ready' });
    tick();
    expect(latest().msg).toBe(T.APP.UPDATE_CHECK.READY);
    expect(latest().action).toBeUndefined();
    expect(latest().action3).toBeUndefined();
    expect(bridge.openExternalUrl).not.toHaveBeenCalled();
  }));
  it('does not reopen progress after dismissal', fakeAsync(() => {
    let finish!: (value: { state: 'ready' }) => void;
    bridge.discoverUpdate.and.resolveTo({ tag: 'v99.0.0', canDownload: true });
    bridge.downloadUpdate.and.returnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    bridge.getUpdateDownloadStatus.and.resolveTo({ state: 'downloading', percent: 10 });
    void service.checkForUpdate();
    tick();
    latest().action?.fn();
    tick();
    latest().action2?.fn();
    const count = banners.open.calls.count();
    tick(500);
    finish({ state: 'ready' });
    tick();
    expect(banners.open.calls.count()).toBe(count);
    expect(banners.dismiss).toHaveBeenCalledWith(BannerId.UpdateAvailable);
  }));
  it('shows a concise download failure', fakeAsync(() => {
    bridge.discoverUpdate.and.resolveTo({ tag: 'v99.0.0', canDownload: true });
    bridge.downloadUpdate.and.rejectWith(new Error('internal detail'));
    void service.checkForUpdate();
    tick();
    latest().action?.fn();
    tick();
    expect(latest().msg).toBe(T.APP.UPDATE_CHECK.DOWNLOAD_ERROR);
  }));
  it('respects opt-out and re-enabling automatic discovery', fakeAsync(() => {
    preferences.next({ isCheckForUpdates: false });
    service.init();
    tick(31000);
    expect(bridge.discoverUpdate).not.toHaveBeenCalled();
    preferences.next({ isCheckForUpdates: true });
    tick(30000);
    expect(bridge.discoverUpdate).toHaveBeenCalledTimes(1);
    preferences.next({ isCheckForUpdates: false });
    tick(24 * 60 * 60 * 1000);
    expect(bridge.discoverUpdate).toHaveBeenCalledTimes(1);
    discardPeriodicTasks();
  }));

  it('defaults missing preferences to enabled after the initial delay', fakeAsync(() => {
    service.init();
    tick(29000);
    expect(bridge.discoverUpdate).not.toHaveBeenCalled();
    tick(1000);
    expect(bridge.discoverUpdate).toHaveBeenCalledTimes(1);
    discardPeriodicTasks();
  }));

  it('skips automatic checks on a store-managed channel', fakeAsync(() => {
    bridge.getDistChannel.and.returnValue('win-store');
    service.init();
    tick(31000);
    expect(bridge.discoverUpdate).not.toHaveBeenCalled();
  }));

  it('ignores a late progress response after the final verified result', fakeAsync(() => {
    let finish!: (value: { state: 'ready' }) => void;
    let progress!: (value: { state: 'downloading' }) => void;
    bridge.discoverUpdate.and.resolveTo({ tag: 'v99.0.0', canDownload: true });
    bridge.downloadUpdate.and.returnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    bridge.getUpdateDownloadStatus.and.returnValue(
      new Promise((resolve) => {
        progress = resolve;
      }),
    );
    void service.checkForUpdate();
    tick();
    latest().action?.fn();
    tick(500);
    finish({ state: 'ready' });
    tick();
    progress({ state: 'downloading' });
    tick();
    expect(latest().msg).toBe(T.APP.UPDATE_CHECK.READY);
  }));
});
