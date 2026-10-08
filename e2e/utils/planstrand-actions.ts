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
