import { promises as fs } from 'fs';
import { app } from 'electron';
import * as path from 'path';
import { error, log } from 'electron-log/main';

// Lazy getter: userData path can be changed by start-app.ts (--user-data-dir, Snap)
// before any store function is called, so we must not cache it at import time.
const getDataPath = (): string => path.join(app.getPath('userData'), 'simpleSettings');

type SimpleStoreData = { [key: string]: unknown };

let _saveQueue: Promise<void> = Promise.resolve();
// Update preparation is local to this store, not an application/profile barrier.
// Public reads count too: legacy/corrupt-file handling can rename files.
const _pendingOperations = new Set<Promise<unknown>>();
let _updatePreparation: symbol | undefined;
let _persistenceFailed = false;

const _trackOperation = <T>(operation: Promise<T>): Promise<T> => {
  _pendingOperations.add(operation);
  void operation.then(
    () => _pendingOperations.delete(operation),
    () => {
      _persistenceFailed = true;
      _pendingOperations.delete(operation);
    },
  );
  return operation;
};

const _assertStoreAvailable = (): void => {
  if (_updatePreparation) throw new Error('Settings paused for update preparation');
};

export type SimpleStorePreparationFailure =
  | 'CONSENT_REQUIRED'
  | 'BUSY'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'PERSISTENCE_FAILED';

export type SimpleStorePreparationResult =
  | { ok: false; reason: SimpleStorePreparationFailure }
  | {
      ok: true;
      coverage: 'electron-simple-settings';
      /** Must still be active at any later handoff. No filesystem-copy grant. */
      lease: { readonly active: boolean; resume: () => void };
    };

/** Main-only building block for a future explicitly consented update flow.
 * Closes this store's admission synchronously, then awaits every admitted save
 * and repair-capable read. No renderer IPC, checkpoint, exit or install action.
 * Timeout/abort never cancel an accepted operation: normal queue ordering remains
 * intact after admission reopens. A failed persistence attempt prevents preparing
 * this store again for the rest of the process; ordinary reads/writes still work.
 */
export const prepareSimpleStoreForUpdate = async (options: {
  userConfirmed: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SimpleStorePreparationResult> => {
  const { userConfirmed, signal } = options;
  if (userConfirmed !== true) return { ok: false, reason: 'CONSENT_REQUIRED' };
  if (_updatePreparation) return { ok: false, reason: 'BUSY' };
  if (signal?.aborted) return { ok: false, reason: 'CANCELLED' };
  if (_persistenceFailed) return { ok: false, reason: 'PERSISTENCE_FAILED' };
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000)
    return { ok: false, reason: 'TIMED_OUT' };

  const token = Symbol('simple-store-update');
  _updatePreparation = token;
  let timer: ReturnType<typeof setTimeout>;
  let cancelWait: (reason: SimpleStorePreparationFailure) => void;
  const resume = (): void => {
    if (_updatePreparation === token) _updatePreparation = undefined;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
  const onAbort = (): void => {
    resume();
    cancelWait('CANCELLED');
  };
  const cancelled = new Promise<SimpleStorePreparationFailure>((resolve) => {
    cancelWait = resolve;
    timer = setTimeout(() => resolve('TIMED_OUT'), timeoutMs);
  });
  signal?.addEventListener('abort', onAbort, { once: true });
  const drained = Promise.allSettled([..._pendingOperations]).then((results) =>
    _persistenceFailed || results.some((r) => r.status === 'rejected')
      ? ('PERSISTENCE_FAILED' as const)
      : undefined,
  );
  const failure = await Promise.race([drained, cancelled]);
  if (failure || signal?.aborted) {
    resume();
    return { ok: false, reason: signal?.aborted ? 'CANCELLED' : failure! };
  }
  clearTimeout(timer!);
  return {
    ok: true,
    coverage: 'electron-simple-settings',
    lease: {
      get active(): boolean {
        return _updatePreparation === token;
      },
      resume,
    },
  };
};

const _getTmpDataPath = (): string => `${getDataPath()}.${process.pid}.${Date.now()}.tmp`;

const _quarantineCorruptStore = async (): Promise<void> => {
  const dataPath = getDataPath();
  const corruptPath = `${dataPath}.corrupt-${Date.now()}`;
  try {
    await fs.rename(dataPath, corruptPath);
    log(`Quarantined corrupt simpleSettings file to ${corruptPath}`);
  } catch (renameErr) {
    _persistenceFailed = true;
    error('Failed to quarantine corrupt simple store:', renameErr);
  }
};

const _writeStoreAtomically = async (json: string): Promise<void> => {
  const dataPath = getDataPath();
  const tmpPath = _getTmpDataPath();

  try {
    await fs.writeFile(tmpPath, json, { encoding: 'utf8' });
    await fs.rename(tmpPath, dataPath);
  } catch (e: unknown) {
    const nodeErr = e as NodeJS.ErrnoException;
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {
      // Best effort cleanup only.
    }

    if (nodeErr.code === 'EISDIR') {
      // In older app versions simpleSettings was stored as a directory.
      // Remove the legacy directory so we can write the file.
      log('simpleSettings is a directory, removing for file-based storage');
      await fs.rm(dataPath, { recursive: true });
      await fs.writeFile(tmpPath, json, { encoding: 'utf8' });
      await fs.rename(tmpPath, dataPath);
    } else {
      error('Failed to save simple store:', e);
      throw e;
    }
  }
};

export const saveSimpleStore = async (dataKey = 'main', data: unknown): Promise<void> => {
  _assertStoreAvailable();
  const runSave = async (): Promise<void> => {
    // Already admitted before preparation: finish the whole read/merge/write.
    const prevData = await _loadSimpleStoreAll();
    const json = JSON.stringify({ ...prevData, [dataKey]: data });
    await _writeStoreAtomically(json);
  };

  _saveQueue = _saveQueue.then(runSave, runSave);
  return _trackOperation(_saveQueue);
};

export const loadSimpleStoreAll = async (): Promise<SimpleStoreData> => {
  _assertStoreAvailable();
  return _trackOperation(_loadSimpleStoreAll());
};

const _loadSimpleStoreAll = async (): Promise<SimpleStoreData> => {
  try {
    const data = await fs.readFile(getDataPath(), { encoding: 'utf8' });
    return JSON.parse(data);
  } catch (e: unknown) {
    const nodeErr = e as NodeJS.ErrnoException;
    if (nodeErr.code !== 'ENOENT' && nodeErr.code !== 'EISDIR') _persistenceFailed = true;
    if (nodeErr.code === 'EISDIR') {
      // In older app versions simpleSettings was stored as a directory.
      // Reading it as a file threw EISDIR which was caught/logged but
      // saveSimpleStore() would subsequently fail with an uncaught EISDIR
      // when writing to the same path. Rename to .bak to unblock writes.
      log('simpleSettings is a directory (legacy), renaming to .bak');
      try {
        await fs.rename(getDataPath(), getDataPath() + '.bak');
      } catch (renameErr) {
        _persistenceFailed = true;
        error('Failed to rename legacy simpleSettings directory:', renameErr);
      }
    } else if (nodeErr.code === 'ENOENT') {
      // ENOENT is expected on first run.
    } else if (e instanceof SyntaxError) {
      error('Failed to parse simple store JSON, quarantining corrupt file:', e);
      await _quarantineCorruptStore();
    } else {
      error('Failed to load simple store:', e);
    }
    return {};
  }
};
