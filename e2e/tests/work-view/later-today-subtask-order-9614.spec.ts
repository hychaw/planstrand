import { expect, test } from '../../fixtures/test.fixture';

/**
 * Issue #9614: Sorting sub-tasks of a repeating task does not apply on Today.
 *
 * A repeating task with a time (e.g. "Every day, 22:00") creates a daily
 * instance scheduled for later today, which is rendered in the "Later Today"
 * panel of the Today view. Reordering its subtasks updates parent.subTaskIds
 * (visible in the task detail panel), but the "Later Today" panel kept
 * rendering the subtasks in store insertion order because
 * selectLaterTodayStructure derived the subtask order from snapshot iteration
 * order instead of parent.subTaskIds.
 *
 * This test schedules a parent for later today (same selector path as a
 * repeating instance), reorders its subtasks via the keyboard shortcut
 * (Ctrl+Shift+ArrowUp, same store action as drag & drop) and asserts the
 * panel reflects the new order.
 */

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

test.describe('Later Today: subtask order (#9614)', () => {
  test('reordering subtasks is reflected in the Later Today panel', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const parentName = `${testPrefix}-EndOfDay`;
    await workViewPage.addTask(parentName);
    const parent = taskPage.getTaskByText(parentName).first();
    await expect(parent).toBeVisible();

    await workViewPage.addSubTask(parent, `${testPrefix}-Sub1`);
    await workViewPage.addSubTask(parent, `${testPrefix}-Sub2`);
    await workViewPage.addSubTask(parent, `${testPrefix}-Sub3`);
    await expect(taskPage.getSubTasks(parent)).toHaveCount(3);

    // This selector serves legacy timed repeat instances. The normal schedule
    // dialog now creates independent WorkSessions, so seed the legacy action.
    const parentId = await parent.getAttribute('data-task-id');
    expect(parentId).toBeTruthy();
    await page.evaluate(
      ({ id, delta }) => {
        type Task = { id: string };
        type State = { tasks: { entities: Record<string, Task> } };
        const store = (
          window as unknown as {
            __e2eTestHelpers: {
              store: {
                subscribe: (fn: (state: State) => void) => { unsubscribe: () => void };
                dispatch: (action: unknown) => void;
              };
            };
          }
        ).__e2eTestHelpers.store;
        let state!: State;
        store
          .subscribe((s) => {
            state = s;
          })
          .unsubscribe();
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 0, 0);
        store.dispatch({
          type: '[Task Shared] scheduleTaskWithTime',
          task: state.tasks.entities[id!],
          dueWithTime: Math.min(Date.now() + delta, endOfToday.getTime()),
          isMoveToBacklog: false,
          meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
        });
      },
      { id: parentId, delta: TWO_HOURS_MS },
    );

    // The parent now lives in the "Later Today" panel.
    const laterTodayList = page.locator('task-list[listModelId="LATER_TODAY"]');
    await expect(laterTodayList).toBeVisible({ timeout: 10000 });
    const parentInPanel = laterTodayList
      .locator('task')
      .filter({ hasText: parentName })
      .first();
    await expect(parentInPanel).toBeVisible();

    const subTaskTitles = parentInPanel.locator('.sub-tasks task task-title');
    await expect(subTaskTitles).toHaveText(
      [`${testPrefix}-Sub1`, `${testPrefix}-Sub2`, `${testPrefix}-Sub3`],
      { timeout: 10000 },
    );

    // Move Sub3 to the top (2x Ctrl+Shift+ArrowUp) - dispatches moveSubTaskUp,
    // which mutates parent.subTaskIds exactly like drag & drop does.
    const sub3 = taskPage
      .getSubTasks(parentInPanel)
      .filter({ hasText: `${testPrefix}-Sub3` })
      .first();
    await sub3.focus();
    await expect(sub3).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowUp');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+Shift+ArrowUp');

    // The panel must reflect the new order. Before the fix it kept showing
    // the original creation order even though subTaskIds had changed.
    await expect(subTaskTitles).toHaveText(
      [`${testPrefix}-Sub3`, `${testPrefix}-Sub1`, `${testPrefix}-Sub2`],
      { timeout: 10000 },
    );
  });
});
