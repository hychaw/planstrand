import type { Page } from '@playwright/test';
import { buildSync } from 'esbuild';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  deleteTestUser,
  getLocalOpLogSummary,
  getSuperSyncConfig,
  SUPERSYNC_BASE_URL,
  withCurrentSuperSyncReader,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import type { RecurrenceSpec } from '../../../src/app/features/routines/recurrence/recurrence-candidates';
import type { OccurrenceException } from '../../../src/app/features/routines/occurrence-exception.model';
import type { WeeklyTemplate } from '../../../src/app/features/routines/weekly-template.model';
import type { EventOccurrenceDisplayItem } from '../../../src/app/features/schedule/calendar-display-item.model';

// These are real independent Angular clients, IndexedDB stores, encrypted provider
// requests and SuperSync HTTP endpoints. Domain actions use the existing dev-only
// store seam: this suite validates synchronization, not the already-tested dialogs.
// Serialized series view keeps browser-platform module dependencies out of the
// Node test runner's type graph. Runtime actions still pass production validation.
interface EventSeries {
  id: string;
  templateId?: string;
  title: string;
  created: number;
  modified: number;
  deletedAt?: number;
  segments: Array<{
    id: string;
    title?: string;
    logicalSlotOffset?: number;
    recurrence: RecurrenceSpec;
    timing:
      | { kind: 'allDay' }
      | {
          kind: 'timed';
          localTime: string;
          timeZone: string;
          durationMs: number;
        };
  }>;
}
interface Entities<T> {
  ids: string[];
  entities: Record<string, T>;
}
interface State {
  eventSeries: Entities<EventSeries>;
  occurrenceException: Entities<OccurrenceException>;
  weeklyTemplate: Entities<WeeklyTemplate>;
  tasks: unknown;
  workSession: unknown;
  planning: unknown;
  event: unknown;
}
const read = async (page: Page): Promise<State> => {
  await page.waitForFunction(
    () => !!(window as unknown as { __e2eTestHelpers?: unknown }).__e2eTestHelpers,
  );
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: { subscribe: (fn: (state: State) => void) => { unsubscribe(): void } };
        };
      }
    ).__e2eTestHelpers.store;
    let result: State | undefined;
    const subscription = store.subscribe((state) => {
      const {
        eventSeries,
        occurrenceException,
        weeklyTemplate,
        tasks,
        workSession,
        planning,
        event,
      } = state;
      result = {
        eventSeries,
        occurrenceException,
        weeklyTemplate,
        tasks,
        workSession,
        planning,
        event,
      };
    });
    subscription.unsubscribe();
    if (!result) throw new Error('Store unavailable');
    return result;
  });
};
type RoutineRecords = {
  eventSeries: Record<string, EventSeries>;
  occurrenceException: Record<string, OccurrenceException>;
  weeklyTemplate: Record<string, WeeklyTemplate>;
};
const routines = (state: State): RoutineRecords => ({
  eventSeries: state.eventSeries.entities,
  occurrenceException: state.occurrenceException.entities,
  weeklyTemplate: state.weeklyTemplate.entities,
});
// Run the unchanged production projection in the browser (its timezone utility
// imports browser platform constants). No recurrence implementation is copied.
const projectionScript = buildSync({
  entryPoints: [
    require.resolve('../../../src/app/features/schedule/project-event-occurrences.ts'),
  ],
  bundle: true,
  format: 'iife',
  globalName: '__routinesProjection',
  write: false,
  minify: true,
}).outputFiles[0].text;
const projected = async (page: Page): Promise<EventOccurrenceDisplayItem[]> => {
  if (!(await page.evaluate(() => '__routinesProjection' in window))) {
    await page.addScriptTag({ content: projectionScript });
  }
  return page.evaluate(
    (state) => {
      const api = (
        window as unknown as {
          __routinesProjection: {
            projectEventOccurrences: (...args: unknown[]) => EventOccurrenceDisplayItem[];
          };
        }
      ).__routinesProjection;
      return api.projectEventOccurrences(
        Object.values(state.eventSeries.entities),
        { fromDate: '2026-10-01', toDateExclusive: '2027-01-01' },
        'Europe/Berlin',
        Object.values(state.occurrenceException.entities),
        Object.values(state.weeklyTemplate.entities),
      );
    },
    await read(page),
  );
};
const unrelated = ({
  tasks,
  workSession,
  planning,
  event,
}: State): Pick<State, 'tasks' | 'workSession' | 'planning' | 'event'> => ({
  tasks,
  workSession,
  planning,
  event,
});
const dispatch = async (
  page: Page,
  type: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  opType = 'UPD',
): Promise<void> => {
  const before = (await getLocalOpLogSummary(page)).length;
  await page.evaluate(
    (action) => {
      (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch(value: unknown): void } };
        }
      ).__e2eTestHelpers.store.dispatch(action);
    },
    { type, ...payload, meta: { isPersistent: true, entityType, entityId, opType } },
  );
  await expect
    .poll(async () => (await getLocalOpLogSummary(page)).length)
    .toBeGreaterThan(before);
};
const series = (
  id: string,
  frequency: 'daily' | 'weekly' | 'monthly' = 'daily',
  templateId?: string,
): EventSeries => ({
  id,
  title: id,
  created: 1,
  modified: 1,
  ...(templateId ? { templateId } : {}),
  segments: [
    {
      id: `${id}-segment`,
      recurrence: {
        ...(frequency === 'weekly' ? { frequency, weekdays: [1, 3, 5] } : { frequency }),
        interval: 1,
        startDate: '2026-10-05',
        endDate: '2027-03-31',
      },
      timing:
        frequency === 'weekly'
          ? {
              kind: 'timed',
              localTime: '09:15',
              timeZone: 'Europe/Berlin',
              durationMs: 2700000,
            }
          : { kind: 'allDay' },
    },
  ],
});
const add = (page: Page, eventSeries: EventSeries): Promise<void> =>
  dispatch(
    page,
    '[EventSeries] Add Event Series',
    'EVENT_SERIES',
    eventSeries.id,
    { eventSeries },
    'CRT',
  );
const plan = (page: Page, record: EventSeries): Promise<void> =>
  dispatch(page, '[EventSeries] Replace Schedule Plan', 'EVENT_SERIES', record.id, {
    id: record.id,
    plan: { title: record.title, segments: record.segments },
    modified: record.modified,
  });
const exceptionId = (id: string, slot: number): string =>
  `occurrenceException:${JSON.stringify([id, slot])}`;
const exception = (
  page: Page,
  id: string,
  slot: number,
  value: OccurrenceException['value'],
): Promise<void> =>
  dispatch(
    page,
    '[OccurrenceException] Set Occurrence Exception',
    'OCCURRENCE_EXCEPTION',
    exceptionId(id, slot),
    {
      occurrenceException: {
        id: exceptionId(id, slot),
        seriesId: id,
        slot,
        value,
        modified: Date.now(),
      },
    },
  );
const override = (title: string): OccurrenceException['value'] => ({
  kind: 'override',
  event: { title, isAllDay: true, date: '2026-10-15' },
});
const remove = (page: Page, record: EventSeries): Promise<void> =>
  dispatch(page, '[EventSeries] Delete Entire Series', 'EVENT_SERIES', record.id, {
    eventSeries: { ...record, deletedAt: Date.now(), modified: Date.now() },
  });
const template: WeeklyTemplate = {
  id: 'weekly-template',
  title: 'Bounded week',
  startDate: '2026-10-05',
  endDate: '2026-12-31',
  isActive: true,
  created: 1,
  modified: 1,
};
const addTemplate = (page: Page): Promise<void> =>
  dispatch(
    page,
    '[WeeklyTemplate] Add Weekly Template',
    'WEEKLY_TEMPLATE',
    template.id,
    { weeklyTemplate: template },
    'CRT',
  );
const active = (page: Page, isActive: boolean): Promise<void> =>
  dispatch(
    page,
    '[WeeklyTemplate] Update Weekly Template',
    'WEEKLY_TEMPLATE',
    template.id,
    {
      id: template.id,
      changes: {
        title: template.title,
        startDate: template.startDate,
        endDate: template.endDate,
        isActive,
      },
      modified: Date.now(),
    },
  );
const deleteTemplate = (page: Page): Promise<void> =>
  dispatch(
    page,
    '[WeeklyTemplate] Delete Weekly Template',
    'WEEKLY_TEMPLATE',
    template.id,
    { weeklyTemplate: { ...template, modified: Date.now(), deletedAt: Date.now() } },
  );
const converge = async (a: SimulatedE2EClient, b: SimulatedE2EClient): Promise<void> => {
  await a.sync.syncAndWait();
  await b.sync.syncAndWait();
  await a.sync.syncAndWait();
  await expect
    .poll(async () => routines(await read(b.page)))
    .toEqual(routines(await read(a.page)));
  expect(await projected(b.page)).toEqual(await projected(a.page));
  for (const client of [a, b]) {
    const state = await read(client.page);
    const occurrences = await projected(client.page);
    expect(new Set(occurrences.map((item) => item.id)).size).toBe(occurrences.length);
    for (const item of occurrences) {
      expect(item.id).toBe(
        `eventOccurrence:${JSON.stringify([item.sourceId, item.occurrence.slot])}`,
      );
      expect(state.eventSeries.entities[item.sourceId].deletedAt).toBeUndefined();
      const owner = state.eventSeries.entities[item.sourceId].templateId;
      if (owner) {
        expect(state.weeklyTemplate.entities[owner].isActive).toBe(true);
        expect(state.weeklyTemplate.entities[owner].deletedAt).toBeUndefined();
      }
    }
    for (const slice of [
      state.eventSeries,
      state.occurrenceException,
      state.weeklyTemplate,
    ]) {
      expect(new Set(slice.ids).size).toBe(slice.ids.length);
      expect([...slice.ids].sort()).toEqual(Object.keys(slice.entities).sort());
    }
    for (const record of Object.values(state.occurrenceException.entities)) {
      expect(record.id).toBe(exceptionId(record.seriesId, record.slot));
    }
  }
};
const block = async (client: SimulatedE2EClient): Promise<void> => {
  await client.context.setOffline(true);
};
const online = async (client: SimulatedE2EClient): Promise<void> =>
  client.context.setOffline(false);

const persistence = async (
  page: Page,
): Promise<{
  tailCount: number;
  requiredCapabilities: string[];
  snapshotCapabilities: string[];
}> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(['ops', 'state_cache', 'meta']);
      const get = <T>(request: IDBRequest<T>): Promise<T> =>
        new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const [cache, entries, capabilities] = await Promise.all([
        get(tx.objectStore('state_cache').get('current')),
        get(tx.objectStore('ops').getAll()),
        get(tx.objectStore('meta').get('semanticRequirements')),
      ]);
      return {
        tailCount: entries.filter(
          (entry: { seq: number }) => entry.seq > (cache?.lastAppliedOpSeq ?? 0),
        ).length,
        requiredCapabilities: capabilities ?? [],
        snapshotCapabilities: cache?.state?.requiredCapabilities ?? [],
      };
    } finally {
      db.close();
    }
  });

test.describe('@supersync Routines real two-client synchronization', () => {
  test('series, scoped plans, exceptions, templates and persisted replay retain identity without generated records', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const user = await createTestUser(testRunId);
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(user);
      const a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(a);
      await a.sync.setupSuperSync(config);
      const b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(b);
      await b.sync.setupSuperSync(config);
      await converge(a, b);
      const baseline = unrelated(await read(a.page));
      for (const frequency of ['daily', 'weekly', 'monthly'] as const)
        await add(a.page, series(frequency, frequency));
      await converge(a, b);
      expect((await read(b.page)).eventSeries.entities).toEqual(
        Object.fromEntries(
          ['daily', 'weekly', 'monthly'].map((id) => [
            id,
            series(id, id as 'daily' | 'weekly' | 'monthly'),
          ]),
        ),
      );
      await exception(a.page, 'daily', 1, override('Moved occurrence'));
      await converge(a, b);
      expect(
        (await read(b.page)).occurrenceException.entities[exceptionId('daily', 1)].value,
      ).toEqual(override('Moved occurrence'));
      await exception(b.page, 'daily', 2, { kind: 'cancelled' });
      await converge(a, b);
      expect(
        (await read(a.page)).occurrenceException.entities[exceptionId('daily', 2)].value
          .kind,
      ).toBe('cancelled');
      expect(
        (await projected(a.page)).some(
          (item) => item.id === 'eventOccurrence:["daily",2]',
        ),
      ).toBe(false);
      await exception(a.page, 'daily', 2, { kind: 'inherit' });
      await converge(a, b);
      expect(
        (await read(b.page)).occurrenceException.entities[exceptionId('daily', 2)].value
          .kind,
      ).toBe('inherit');
      expect(
        (await projected(b.page)).some(
          (item) => item.id === 'eventOccurrence:["daily",2]',
        ),
      ).toBe(true);
      const split = series('daily');
      split.segments.push({
        ...split.segments[0],
        id: 'daily-future',
        logicalSlotOffset: 4,
        title: 'Future schedule',
        recurrence: {
          frequency: 'weekly',
          interval: 2,
          weekdays: [2, 4],
          startDate: '2026-10-09',
        },
      });
      split.modified = Date.now();
      await plan(a.page, split);
      await converge(a, b);
      expect((await read(b.page)).eventSeries.entities.daily).toEqual(split);
      const entire = {
        ...split,
        title: 'Entire title',
        modified: Date.now(),
        segments: split.segments.map(({ title: _title, ...segment }) => segment),
      };
      await plan(b.page, entire);
      await converge(a, b);
      expect((await read(a.page)).eventSeries.entities.daily).toEqual(entire);
      await remove(a.page, series('monthly', 'monthly'));
      await converge(a, b);
      expect((await read(b.page)).eventSeries.entities.monthly.deletedAt).toBeDefined();
      await addTemplate(a.page);
      await add(a.page, series('entry-one', 'weekly', template.id));
      await add(a.page, series('entry-two', 'weekly', template.id));
      await converge(a, b);
      expect((await read(b.page)).weeklyTemplate.entities[template.id]).toEqual(template);
      expect(
        Object.values((await read(b.page)).eventSeries.entities).filter(
          (s) => s.templateId === template.id,
        ),
      ).toHaveLength(2);
      await active(b.page, false);
      await converge(a, b);
      expect((await read(a.page)).weeklyTemplate.entities[template.id].isActive).toBe(
        false,
      );
      expect(
        (await projected(a.page)).some((item) => item.sourceId === 'entry-one'),
      ).toBe(false);
      await active(a.page, true);
      await converge(a, b);
      expect((await read(b.page)).weeklyTemplate.entities[template.id].isActive).toBe(
        true,
      );
      expect(
        (await projected(b.page)).some((item) => item.sourceId === 'entry-one'),
      ).toBe(true);
      await deleteTemplate(a.page);
      await converge(a, b);
      expect(
        (await read(b.page)).weeklyTemplate.entities[template.id].deletedAt,
      ).toBeDefined();
      const expected = routines(await read(a.page));
      // New renderer instances retain their independent IndexedDB profiles.
      for (const client of clients) {
        const oldPage = client.page;
        client.page = await client.context.newPage();
        await oldPage.close();
        await client.page.goto(baseURL!);
        await expect
          .poll(async () => routines(await read(client.page)))
          .toEqual(expected);
        expect(unrelated(await read(client.page))).toEqual(baseline);
      }
    } finally {
      for (const client of clients) await closeClient(client);
      await deleteTestUser(user.userId);
    }
  });

  for (const firstUpload of ['A', 'B'] as const) {
    test(`offline conflicts, terminal deletion and missing parents converge (${firstUpload} uploads first)`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      const user = await createTestUser(testRunId);
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(user);
        const a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        clients.push(a);
        await a.sync.setupSuperSync(config);
        await add(a.page, series('race'));
        await add(a.page, series('deleted'));
        await addTemplate(a.page);
        await add(a.page, series('entry', 'weekly', template.id));
        await a.sync.syncAndWait();
        const b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        clients.push(b);
        await b.sync.setupSuperSync(config);
        await converge(a, b);
        const baseline = unrelated(await read(a.page));
        await block(a);
        await block(b);
        await exception(a.page, 'race', 1, override('Independent A'));
        await exception(b.page, 'race', 2, override('Independent B'));
        await exception(a.page, 'race', 3, { kind: 'cancelled' });
        await exception(b.page, 'race', 3, override('Later B'));
        await plan(a.page, {
          ...series('race', 'monthly'),
          title: 'Earlier A schedule',
          modified: Date.now(),
        });
        const winner = series('race', 'weekly');
        winner.modified = Date.now();
        winner.title = 'Later B schedule';
        await plan(b.page, winner);
        await remove(a.page, series('deleted'));
        await plan(b.page, {
          ...series('deleted'),
          title: 'Late update',
          modified: Date.now(),
        });
        await exception(b.page, 'deleted', 4, override('Late exception'));
        await deleteTemplate(a.page);
        await plan(b.page, {
          ...series('entry', 'weekly', template.id),
          title: 'Independent entry edit',
          modified: Date.now(),
        });
        const first = firstUpload === 'A' ? a : b;
        const second = firstUpload === 'A' ? b : a;
        await online(first);
        await first.sync.syncAndWait();
        await online(second);
        await converge(a, b);
        const result = await read(a.page);
        expect(result.occurrenceException.entities[exceptionId('race', 1)].value).toEqual(
          override('Independent A'),
        );
        expect(result.occurrenceException.entities[exceptionId('race', 2)].value).toEqual(
          override('Independent B'),
        );
        expect(result.occurrenceException.entities[exceptionId('race', 3)].value).toEqual(
          override('Later B'),
        );
        expect(result.eventSeries.entities.race).toEqual(winner);
        expect(result.eventSeries.entities.deleted.deletedAt).toBeDefined();
        expect(
          result.occurrenceException.entities[exceptionId('deleted', 4)].value,
        ).toEqual(override('Late exception'));
        expect(result.weeklyTemplate.entities[template.id].deletedAt).toBeDefined();
        expect(result.eventSeries.entities.entry.title).toBe('Independent entry edit');
        // Genuine operation ordering through the server: child records arrive on
        // B before their parents exist, rather than faking a parentless snapshot.
        await exception(a.page, 'late-parent', 0, override('Before parent'));
        await add(a.page, series('late-entry', 'weekly', 'late-template'));
        await converge(a, b);
        expect((await read(b.page)).eventSeries.entities['late-parent']).toBeUndefined();
        expect(
          (await read(b.page)).weeklyTemplate.entities['late-template'],
        ).toBeUndefined();
        await add(a.page, series('late-parent'));
        await dispatch(
          a.page,
          '[WeeklyTemplate] Add Weekly Template',
          'WEEKLY_TEMPLATE',
          'late-template',
          { weeklyTemplate: { ...template, id: 'late-template' } },
          'CRT',
        );
        await converge(a, b);
        expect(
          (await read(b.page)).occurrenceException.entities[exceptionId('late-parent', 0)]
            .value,
        ).toEqual(override('Before parent'));
        // Fault injection is limited to delivery: the response is fetched from
        // the real server, then duplicated. This is simulated duplicate download
        // evidence, distinct from the real provider/conflict scenarios above.
        let duplicated = false;
        await b.page.route('**/api/sync/ops*', async (route) => {
          const response = await route.fetch();
          if (route.request().method() === 'GET' && response.ok()) {
            const body = await response.json();
            if (!duplicated && body.ops?.length) {
              duplicated = true;
              await route.fulfill({
                response,
                json: { ...body, ops: [...body.ops, ...body.ops] },
              });
              return;
            }
          }
          await route.fulfill({ response });
        });
        await exception(a.page, 'late-parent', 1, { kind: 'cancelled' });
        await converge(a, b);
        expect(duplicated).toBe(true);
        await b.page.unroute('**/api/sync/ops*');
        const expected = routines(await read(a.page));
        await b.page.reload();
        await expect.poll(async () => routines(await read(b.page))).toEqual(expected);
        expect(unrelated(await read(b.page))).toEqual(baseline);
      } finally {
        for (const client of clients) {
          await online(client);
          await closeClient(client);
        }
        await deleteTestUser(user.userId);
      }
    });
  }

  test('real full-state replacement and fresh-client recovery retain Routines and the account capability floor', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);
    const user = await createTestUser(testRunId);
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(user);
      const a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(a);
      await a.sync.setupSuperSync(config);
      await add(a.page, series('snapshot-series'));
      await exception(a.page, 'snapshot-series', 1, override('Snapshot override'));
      await exception(a.page, 'snapshot-series', 2, { kind: 'cancelled' });
      await addTemplate(a.page);
      await add(a.page, series('snapshot-entry', 'weekly', template.id));
      await active(a.page, false);
      await add(a.page, series('snapshot-deleted'));
      await remove(a.page, series('snapshot-deleted'));
      await a.sync.syncAndWait();
      const expected = routines(await read(a.page));
      const baseline = unrelated(await read(a.page));
      // Existing provider path replaces server history with an encrypted
      // SYNC_IMPORT snapshot; no encrypted operator-recovery tooling is used.
      const password = `disposable-after-boundary-${testRunId}`;
      await a.sync.changeEncryptionPassword(password);
      const inspect = await fetch(
        `${SUPERSYNC_BASE_URL}/api/test/user/${user.userId}/ops?limit=100`,
      );
      expect(inspect.ok).toBe(true);
      const boundary = await inspect.json();
      expect(boundary.ops).toHaveLength(1);
      expect(boundary.ops[0].opType).toBe('SYNC_IMPORT');
      const b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(b);
      await b.sync.setupSuperSync({ ...config, password });
      await converge(a, b);
      expect(routines(await read(b.page))).toEqual(expected);
      expect(unrelated(await read(b.page))).toEqual(baseline);
      // Cross the production threshold with actual persisted operations. This
      // exercises the real compactor without lowering constants, seeding a
      // fake snapshot or mocking IndexedDB. Recent operations are retained.
      const beforeCompaction = Date.now();
      const countBefore = (await getLocalOpLogSummary(a.page)).length;
      await block(a);
      await a.page.evaluate((source) => {
        const store = (
          window as unknown as {
            __e2eTestHelpers: { store: { dispatch(value: unknown): void } };
          }
        ).__e2eTestHelpers.store;
        for (let index = 0; index < 501; index++) {
          store.dispatch({
            type: '[EventSeries] Replace Schedule Plan',
            id: source.id,
            plan: { title: `Compaction edit ${index}`, segments: source.segments },
            modified: Date.now(),
            meta: {
              isPersistent: true,
              entityType: 'EVENT_SERIES',
              entityId: source.id,
              opType: 'UPD',
            },
          });
        }
      }, series('snapshot-series'));
      await expect
        .poll(async () => (await getLocalOpLogSummary(a.page)).length, { timeout: 60000 })
        .toBeGreaterThanOrEqual(countBefore + 501);
      await expect
        .poll(
          () =>
            a.page.evaluate(async () => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open('SUP_OPS');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              try {
                return await new Promise<number>((resolve, reject) => {
                  const request = db
                    .transaction('state_cache')
                    .objectStore('state_cache')
                    .get('current');
                  request.onsuccess = () => resolve(request.result?.compactedAt ?? 0);
                  request.onerror = () => reject(request.error);
                });
              } finally {
                db.close();
              }
            }),
          { timeout: 60000 },
        )
        .toBeGreaterThanOrEqual(beforeCompaction);
      await online(a);
      await converge(a, b);
      expect((await read(b.page)).eventSeries.entities['snapshot-series'].title).toBe(
        'Compaction edit 500',
      );
      await exception(b.page, 'snapshot-series', 3, { kind: 'inherit' });
      await converge(a, b);
      const after = routines(await read(a.page));
      const persisted = await persistence(a.page);
      expect(persisted.tailCount).toBeGreaterThan(0);
      expect(persisted.requiredCapabilities).toContain('ROUTINES_V1');
      expect(persisted.snapshotCapabilities).toContain('ROUTINES_V1');
      await a.page.reload();
      await b.page.reload();
      for (const client of clients)
        await expect.poll(async () => routines(await read(client.page))).toEqual(after);
      for (const client of clients) {
        expect((await persistence(client.page)).requiredCapabilities).toContain(
          'ROUTINES_V1',
        );
        expect(unrelated(await read(client.page))).toEqual(baseline);
      }
      const response = await fetch(
        withCurrentSuperSyncReader(`${SUPERSYNC_BASE_URL}/api/sync/ops?sinceSeq=0`),
        { headers: { authorization: `Bearer ${user.token}` } },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).requiredCapabilities).toContain('ROUTINES_V1');
      const unsupported = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops?sinceSeq=0`, {
        headers: { authorization: `Bearer ${user.token}` },
      });
      expect(unsupported.status).toBe(409);
    } finally {
      for (const client of clients) {
        await online(client);
        await closeClient(client);
      }
      await deleteTestUser(user.userId);
    }
  });
});
