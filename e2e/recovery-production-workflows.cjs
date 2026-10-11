// Generate a production-captured oracle for the narrowly supported recovery workflows.
// Usage: node e2e/recovery-production-workflows.cjs [source|roundtrip]
// Requires an ordinary development renderer at RECOVERY_TEST_URL (default loopback).
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = '.tmp/recovery-production-gaps';
const fixturePath =
  'packages/super-sync-server/tests/fixtures/production-workflow-recovery.json';
const url = process.env.RECOVERY_TEST_URL || 'http://127.0.0.1:4263';
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const digest = (v) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
async function init(page) {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__e2eTestHelpers);
  await page.evaluate(() => {
    window.svc = (name) => {
      let injector = ng.getInjector(document.querySelector('app-root'))._lView[9]
        .parentInjector;
      for (; injector; injector = injector.parent) {
        const token = [...(injector.records?.keys() || [])].find(
          (k) => k?.name?.replace(/\d+$/, '') === name,
        );
        if (token) return injector.get(token);
      }
      throw Error('Missing service ' + name);
    };
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        svc('DataInitStateService').isAllDataLoadedInitially$.subscribe(resolve),
      ),
  );
}
async function source(browser) {
  await require('esbuild').build({
    stdin: {
      contents:
        "import {TaskSharedActions} from './src/app/root-store/meta/task-shared.actions';import {addWorkSession} from './src/app/features/work-session/store/work-session.actions';window.workflowActions=TaskSharedActions;window.addSession=addWorkSession;",
      resolveDir: process.cwd(),
    },
    outfile: root + '/actions.js',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.base.json',
    logLevel: 'silent',
  });
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  await init(page);
  await page.addScriptTag({ path: root + '/actions.js', type: 'module' });
  const base = JSON.parse(
    fs.readFileSync(
      'packages/super-sync-server/tests/fixtures/task-event-recovery.json',
      'utf8',
    ),
  ).operations[0].payload;
  await page.evaluate(async (base) => {
    await svc('BackupService').importCompleteBackup(
      { appDataComplete: base },
      true,
      true,
    );
    await svc('OperationWriteFlushService').flushPendingWrites();
  }, base);
  const entries = () =>
    page.evaluate(() => svc('OperationLogStoreService').getOpsAfterSeq(0));
  const initial = await entries();
  const first = initial.findLastIndex((e) =>
    ['BACKUP_IMPORT', 'SYNC_IMPORT'].includes(e.op.opType),
  );
  assert.ok(first >= 0);
  const captured = new Map(initial.slice(first).map((e) => [e.op.id, e.op]));
  const checks = [];
  async function checkpoint(name) {
    await page.evaluate(() => svc('OperationWriteFlushService').flushPendingWrites());
    const rows = await entries();
    for (const { op } of rows) if (!captured.has(op.id)) captured.set(op.id, op);
    const state = await page.evaluate(() =>
      svc('StateSnapshotService').getStateSnapshotAsync(),
    );
    checks.push({
      name,
      count: captured.size,
      state,
      stateSha256: digest(state),
      requiredCapabilities: state.requiredCapabilities || [],
    });
  }
  const projectId = await page.evaluate(() =>
    svc('ProjectService').add({
      title: 'Recovery workflow project',
      isEnableBacklog: true,
    }),
  );
  await checkpoint('project-create');
  await page.evaluate(
    (id) =>
      svc('ProjectService').update(
        id,
        { title: 'Updated recovery project', notes: 'Persist complete project state' },
        true,
      ),
    projectId,
  );
  await checkpoint('project-update');
  const ids = await page.evaluate(() => {
    const service = svc('TaskService');
    return [
      service.add('Recovery parent', false, {}, false, true),
      service.add('Recovery child', false, {}, false, true),
    ];
  });
  await page.evaluate(([parent, child]) => {
    __e2eTestHelpers.store.dispatch(
      addSession({
        workSession: {
          id: 'recovery-workflow-session',
          taskId: child,
          start: 1791633600000,
          end: 1791637200000,
          timeZone: 'America/Los_Angeles',
          created: 100,
          modified: 100,
        },
      }),
    );
  }, ids);
  await checkpoint('workflow-base');
  await page.evaluate(async (id) => {
    const service = svc('TaskService');
    const task = await service.getByIdOnce$(id).toPromise();
    service.scheduleTask(task, Date.now() + 3600000, 'DoNotRemind', false);
  }, ids[1]);
  await checkpoint('task-schedule');
  await page.evaluate(async (id) => {
    const service = svc('TaskService');
    const task = await service.getByIdOnce$(id).toPromise();
    service.reScheduleTask({
      task,
      due: Date.now() + 172800000,
      remindCfg: 'DoNotRemind',
      isMoveToBacklog: false,
    });
  }, ids[1]);
  await checkpoint('task-reschedule');
  await page.evaluate(
    (id) =>
      __e2eTestHelpers.store.dispatch(
        workflowActions.unscheduleTask({ id, isLeaveInToday: true }),
      ),
    ids[1],
  );
  await checkpoint('task-unschedule-today');
  await page.evaluate(
    (id) =>
      __e2eTestHelpers.store.dispatch(
        workflowActions.unscheduleTask({ id, isLeaveInToday: false }),
      ),
    ids[1],
  );
  await checkpoint('task-unschedule-clear');
  await page.evaluate(
    ([parent, child]) =>
      __e2eTestHelpers.store.dispatch(
        workflowActions.convertToSubTask({
          taskId: child,
          targetParentId: parent,
          afterTaskId: null,
        }),
      ),
    ids,
  );
  await checkpoint('task-convert-sub');
  await page.evaluate(async (id) => {
    const service = svc('TaskService');
    await service.convertToMainTask(await service.getByIdOnce$(id).toPromise());
  }, ids[1]);
  await checkpoint('task-convert-main');
  // An explicit source snapshot boundary, then a mixed Project/Task/Planning/WorkSession tail.
  const boundary = checks.at(-1).state;
  await page.evaluate(
    async (state) =>
      svc('BackupService').importCompleteBackup({ appDataComplete: state }, true, true),
    boundary,
  );
  await page.evaluate(([parent, child]) => {
    __e2eTestHelpers.store.dispatch(
      workflowActions.convertToSubTask({
        taskId: child,
        targetParentId: parent,
        afterTaskId: null,
      }),
    );
  }, ids);
  await page.evaluate(
    async ({ id, projectId }) => {
      const service = svc('TaskService');
      const task = await service.getByIdOnce$(id).toPromise();
      __e2eTestHelpers.store.dispatch(
        workflowActions.convertToMainTask({ task, isDone: true, isPlanForToday: true }),
      );
      svc('ProjectService').update(projectId, { title: 'Mixed recovered project' }, true);
    },
    { id: ids[1], projectId },
  );
  await checkpoint('mixed-snapshot-tail');
  const operations = [...captured.values()].map((op, i) => ({ ...op, serverSeq: i + 1 }));
  for (const type of [
    '[Project] Add Project',
    '[Project] Update Project',
    ...[
      'scheduleTaskWithTime',
      'reScheduleTaskWithTime',
      'unscheduleTask',
      'convertToSubTask',
      'convertToMainTask',
    ].map((a) => '[Task Shared] ' + a),
  ])
    assert.ok(
      operations.some((op) => op.actionType === type),
      'Missing production operation: ' + type,
    );
  const last = checks.at(-1).state;
  assert.equal(last.workSession.entities['recovery-workflow-session'].taskId, ids[1]);
  assert.equal(last.task.entities[ids[1]].isDone, true);
  assert.ok(!last.task.entities[ids[1]].parentId);
  assert.equal(last.project.entities[projectId].title, 'Mixed recovered project');
  const full = { operations, checks, ids, projectId };
  fs.writeFileSync(root + '/source-oracle.json', JSON.stringify(full, null, 2));
  fs.writeFileSync(
    fixturePath,
    JSON.stringify(
      { operations, checks: checks.map(({ state, ...check }) => check) },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Captured ${operations.length} production operations and ${checks.length} complete checkpoints`,
  );
  await context.close();
}
async function roundtrip(browser) {
  const source = JSON.parse(fs.readFileSync(root + '/source-oracle.json', 'utf8'));
  const recovered = JSON.parse(
    fs.readFileSync(root + '/recovered-mixed-snapshot-tail.json', 'utf8'),
  );
  const expected = {
    ...source.checks.at(-1).state,
    requiredCapabilities: [...recovered.requiredCapabilities].sort(),
  };
  const profile = root + '/mixed-profile';
  for (let launch = 0; launch < 2; launch++) {
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: true,
      timezoneId: 'Pacific/Auckland',
    });
    try {
      const page = context.pages()[0];
      // Keep the source logical day during persistence comparison. Normal
      // next-day startup deliberately prunes yesterday's Today ordering.
      const day = source.operations.find((op) => op.payload.taskReplayContext)?.payload
        .taskReplayContext.today;
      await page.clock.install({ time: new Date(day + 'T08:00:00Z') });
      await init(page);
      if (!launch)
        await page.evaluate(async (backup) => {
          await svc('BackupService').importCompleteBackup(backup, true, true);
          await svc('OperationWriteFlushService').flushPendingWrites();
        }, recovered);
      assert.deepEqual(
        await page.evaluate(() => svc('StateSnapshotService').getStateSnapshotAsync()),
        expected,
      );
      assert.deepEqual(
        (await page.evaluate(() => svc('BackupService').loadCompleteBackup(true))).data,
        expected,
      );
    } finally {
      await context.close();
    }
  }
  console.log('PASS mixed browser import/export/full-process-restart');
}
(async () => {
  fs.mkdirSync(root, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await (process.argv[2] === 'roundtrip' ? roundtrip : source)(browser);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
