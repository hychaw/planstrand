import { expect, test } from '../../fixtures/test.fixture';

test('schedules an unestimated Task without changing its Task dates or Planning', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  const title = `${testPrefix}-unestimated session`;
  await workViewPage.addTask(title);
  const task = taskPage.getTaskByText(title).first();
  const taskId = await task.getAttribute('data-task-id');
  expect(taskId).toBeTruthy();

  const readState = async (): Promise<{
    task: { timeEstimate: number; dueDay?: string; dueWithTime?: number };
    planning: string;
    sessions: Array<{ id: string; taskId: string; start: number; end: number }>;
  }> =>
    page.evaluate((id) => {
      type Session = { id: string; taskId: string; start: number; end: number };
      type State = {
        tasks: {
          entities: Record<
            string,
            { timeEstimate: number; dueDay?: string; dueWithTime?: number }
          >;
        };
        planning: unknown;
        workSession: { entities: Record<string, Session> };
      };
      const store = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (fn: (state: State) => void) => { unsubscribe: () => void };
            };
          };
        }
      ).__e2eTestHelpers.store;
      let state!: State;
      store
        .subscribe((value) => {
          state = value;
        })
        .unsubscribe();
      return {
        task: state.tasks.entities[id!],
        planning: JSON.stringify(state.planning),
        sessions: Object.values(state.workSession.entities).filter(
          (s) => s.taskId === id,
        ),
      };
    }, taskId);

  const before = await readState();
  expect(before.task.timeEstimate).toBe(0);
  expect(before.sessions).toHaveLength(0);
  await task.focus();
  await page.keyboard.press('s');
  const dialog = page.locator('dialog-schedule-task');
  await expect(dialog).toBeVisible();
  await dialog.locator('.mat-calendar-body-today').click();
  await dialog.locator('input[type="time"]').fill('23:00');
  await dialog.locator('[data-test-id="schedule-submit-btn"]').click();
  await expect(dialog).toBeHidden();

  const after = await readState();
  expect(after.task).toEqual(before.task);
  expect(after.planning).toBe(before.planning);
  expect(after.sessions).toHaveLength(1);
  expect(after.sessions[0].end - after.sessions[0].start).toBe(600001);
  await page.reload();
  await workViewPage.waitForTaskList();
  const reloaded = await readState();
  expect(reloaded.sessions).toEqual(after.sessions);
  expect(reloaded.task).toEqual(before.task);
  expect(reloaded.planning).toBe(before.planning);
});
