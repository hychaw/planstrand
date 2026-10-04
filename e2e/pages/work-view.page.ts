import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { waitForAngularStability, waitForAppReady } from '../utils/waits';

export class WorkViewPage extends BasePage {
  readonly addTaskGlobalInput: Locator;
  readonly addBtn: Locator;
  readonly taskList: Locator;
  readonly backdrop: Locator;
  readonly routerWrapper: Locator;

  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);

    this.addTaskGlobalInput = page.locator('add-task-bar.global .main-input');
    // The add-task submit button's stable e2e hook (`.switch-add-to-btn` now
    // belongs to the add-to-backlog toggle, a different control).
    this.addBtn = page.locator('.e2e-add-task-submit');
    this.taskList = page.locator('task-list').first();
    this.backdrop = page.locator('.backdrop');
    this.routerWrapper = page.locator('.route-wrapper, main, [role="main"]').first();
  }

  async waitForTaskList(): Promise<void> {
    await this._ensureLegacyWorkView();
    // Wait for the loading screen to disappear first (if visible).
    // The app shows `.loading-full-page-wrapper` while syncing/importing data.
    const loadingWrapper = this.page.locator('.loading-full-page-wrapper');
    try {
      const isLoadingVisible = await loadingWrapper.isVisible().catch(() => false);
      if (isLoadingVisible) {
        await loadingWrapper.waitFor({ state: 'hidden', timeout: 30000 });
      }
    } catch {
      // Loading screen might not appear at all - that's fine
    }

    // Wait for task list to be visible
    await this.page.waitForSelector('task-list', {
      state: 'visible',
      timeout: 15000,
    });

    // Ensure route wrapper is fully loaded
    await this.routerWrapper.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for Angular to stabilize using shared helper
    await waitForAngularStability(this.page);
  }

  override async addTask(
    taskName: string,
    skipClose = false,
    expectedVisibleTitle: string | null = taskName,
  ): Promise<void> {
    await this._ensureLegacyWorkView();
    await super.addTask(taskName, skipClose, expectedVisibleTitle);
  }

  private async _ensureLegacyWorkView(): Promise<void> {
    // This page object exercises legacy Task lists, rather than independent V1
    // Planning. Preserve explicit startup tests until they request this view.
    if (!new URL(this.page.url()).hash || new URL(this.page.url()).hash === '#/') {
      await waitForAppReady(this.page);
    }
    if (/#\/(today|this-week|inbox|master-tasks)(?:$|[?])/.test(this.page.url())) {
      await this.page.goto('/#/tag/TODAY/tasks');
    }
  }

  async addSubTask(task: Locator, subTaskName: string): Promise<void> {
    await task.waitFor({ state: 'visible' });

    // Focus the task element directly (avoids opening edit mode on task-title)
    await task.focus();
    await this.page.waitForTimeout(200);

    // Verify focus is on the task, retry with task.focus() if needed
    const isFocused = await task.evaluate(
      (el) => el === document.activeElement || el.contains(document.activeElement),
    );
    if (!isFocused) {
      await task.focus();
      await this.page.waitForTimeout(200);
    }

    await task.press('a');

    // 'a' opens the inline subtask draft input (a local-only draft that is not
    // persisted until committed with Enter).
    const draftInput = this.page.locator('.e2e-add-subtask-input');
    await draftInput.waitFor({ state: 'visible', timeout: 3000 });
    await draftInput.fill(subTaskName);
    await this.page.keyboard.press('Enter');

    // The draft stays open for rapid entry; close it so callers get a clean
    // state (focus returns to the originating task).
    await this.page.keyboard.press('Escape');
    await draftInput.waitFor({ state: 'detached', timeout: 3000 });
  }
}
