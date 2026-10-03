import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

interface Session {
  id: string;
  taskId: string;
  start: number;
  end: number;
  timeZone?: string;
  completedAt?: number | null;
  created: number;
  modified: number;
}
interface Snapshot {
  tasks: {
    entities: Record<
      string,
      { id: string; title: string; dueWithTime?: number } | undefined
    >;
  };
  workSession: {
    entities: Record<string, Session | undefined>;
    dismissedLegacySessionIds?: string[];
  };
}
const read = async (page: Page): Promise<Snapshot> => {
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __e2eTestHelpers?: { store?: unknown } }).__e2eTestHelpers
        ?.store,
  );
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (next: (value: Snapshot) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let state: Snapshot | undefined;
    const subscription = store.subscribe((value) => {
      state = value;
    });
    subscription.unsubscribe();
    if (!state) throw new Error('E2E store snapshot unavailable');
    return { tasks: state.tasks, workSession: state.workSession };
  });
};
const dispatch = async (page: Page, action: Record<string, unknown>): Promise<void> =>
  page.evaluate((value) => {
    (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers.store.dispatch(value);
  }, action);

// Completion currently has a domain action and no management UI. Use the same
// dev-only store helper as other provider regressions, exercising real capture,
// encrypted upload/download, live apply, reload, and IndexedDB hydration.
test.describe('@supersync migrated WorkSession replay', () => {
  test('preserves edits and completion on an unmaterialized current client, then retains dismissal', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let a: SimulatedE2EClient | null = null;
    let b: SimulatedE2EClient | null = null;
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await a.workView.waitForTaskList();
      await a.sync.setupSuperSync(config);
      const title = `A-${testRunId}-Migrated replay ${testRunId}`;
      await a.workView.addTask(title);
      await a.sync.syncAndWait();
      b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await b.workView.waitForTaskList();
      await b.sync.setupSuperSync(config);
      await b.sync.syncAndWait();
      const task = Object.values((await read(a.page)).tasks.entities).find(
        (entry) => entry?.title === title,
      );
      if (!task) throw new Error('Seed Task missing');
      const start = Date.now() + 3600000;
      const id = `legacy-task-schedule:${task.id.length}:${task.id}:${start}`;
      await dispatch(a.page, {
        type: '[Task Shared] updateTask',
        task: {
          id: task.id,
          changes: { dueWithTime: start, dueDay: null, timeEstimate: 1800000 },
        },
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: task.id,
          opType: 'UPD',
        },
      });
      await a.sync.syncAndWait();
      await b.sync.syncAndWait();
      expect((await read(a.page)).workSession.entities[id]).toBeUndefined();
      expect((await read(b.page)).workSession.entities[id]).toBeUndefined();
      await a.page.reload();
      await expect
        .poll(async () => (await read(a!.page)).workSession.entities[id])
        .toBeTruthy();
      const original = (await read(a.page)).workSession.entities[id]!;
      const editedStart = start + 3600000;
      await dispatch(a.page, {
        type: '[WorkSession] Update WorkSession',
        id,
        changes: { start: editedStart, end: editedStart + 2700000 },
        modified: Date.now(),
        legacySession: original,
        meta: {
          isPersistent: true,
          entityType: 'WORK_SESSION',
          entityId: id,
          opType: 'UPD',
        },
      });
      const edited = (await read(a.page)).workSession.entities[id]!;
      const completedAt = Date.now();
      await dispatch(a.page, {
        type: '[WorkSession] Complete WorkSession',
        id,
        completedAt,
        modified: completedAt,
        legacySession: edited,
        meta: {
          isPersistent: true,
          entityType: 'WORK_SESSION',
          entityId: id,
          opType: 'UPD',
        },
      });
      await a.sync.syncAndWait();
      await b.sync.syncAndWait();
      const expected = { ...edited, completedAt, modified: completedAt };
      expect((await read(b.page)).workSession.entities[id]).toEqual(expected);
      await b.page.reload();
      await expect
        .poll(async () => (await read(b!.page)).workSession.entities[id])
        .toEqual(expected);
      expect((await read(b.page)).tasks.entities[task.id]?.dueWithTime).toBe(start);
      await dispatch(a.page, {
        type: '[WorkSession] Remove WorkSession',
        id,
        meta: {
          isPersistent: true,
          entityType: 'WORK_SESSION',
          entityId: id,
          opType: 'DEL',
        },
      });
      await a.sync.syncAndWait();
      await b.sync.syncAndWait();
      await b.page.reload();
      await expect
        .poll(async () => (await read(b!.page)).workSession.dismissedLegacySessionIds)
        .toContain(id);
      expect((await read(b.page)).workSession.entities[id]).toBeUndefined();
    } finally {
      if (a) await closeClient(a);
      if (b) await closeClient(b);
    }
  });
});
