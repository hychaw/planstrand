import { Locator } from '@playwright/test';

/** Open the explicit touch/keyboard action affordance before interacting. */
export const openPlanstrandActions = async (
  scope: Locator,
  kind: 'task' | 'folder' = 'task',
): Promise<void> => {
  const details = scope.locator(`.${kind}-actions`).first();
  if (!(await details.getAttribute('open'))) {
    // Boolean attributes serialize as an empty string when open.
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await details.locator('summary').click();
    }
  }
};

/** Task commands live in the context menu; touch rows have a separate button. */
export const openPlanstrandTaskContextMenu = async (scope: Locator): Promise<void> => {
  const touchTrigger = scope.locator('.task-context-trigger');
  if (await touchTrigger.isVisible()) await touchTrigger.click();
  else
    await scope
      .locator('task')
      .first()
      .click({ button: 'right', position: { x: 30, y: 20 } });
};
