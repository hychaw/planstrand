import { expect, test } from '../../fixtures/test.fixture';

const storageKey = 'planstrand_local_schedule_reminders_v1';
test.use({ contextOptions: { timezoneId: 'Asia/Singapore' } });

test('Event reminder choices persist, remain keyboard accessible and fit both themes on narrow screens', async ({
  page,
}) => {
  await page.goto('/#/schedule');
  await page.locator('.e2e-new-event').click();
  const editor = page.locator('dialog-event');
  await editor.locator('input[name=title]').fill('Reminder meeting');
  const reminder = editor.getByRole('combobox', { name: 'Reminder', exact: true });
  await expect(reminder.locator('option:checked')).toHaveText('Never');
  await expect(reminder.locator('option')).toHaveCount(7);
  await expect(editor.locator('#event-reminder-hint')).toContainText('fully closed');
  await reminder.selectOption({ label: '15 minutes before it starts' });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          Object.values(JSON.parse(localStorage.getItem(key) ?? '{}')).some(
            (p) => (p as { offset: number }).offset === 15,
          ),
        storageKey,
      ),
    )
    .toBe(true);
  await page.reload();
  const block = page
    .locator('schedule-event:not(.custom-drag-preview)')
    .filter({ hasText: 'Reminder meeting' })
    .first();
  await block.click();
  await expect(reminder.locator('option:checked')).toHaveText(
    '15 minutes before it starts',
  );
  await reminder.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(reminder.locator('option:checked')).toHaveText('when it starts');
  await page.keyboard.press('Escape');
  for (const theme of ['Light', 'Dark']) {
    await page.goto('/#/config');
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page
      .locator('theme-selector')
      .getByRole('radio', { name: theme, exact: true })
      .click();
    await page.goto('/#/schedule');
    await block.click();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await reminder.scrollIntoViewIfNeeded();
      await expect(reminder).toBeInViewport();
      expect(
        await editor
          .locator('mat-dialog-content')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: `.tmp/phase5a-event-${theme}-${width}.png` });
    }
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await block.click();
  await editor.locator('input[name=allDay]').check();
  await expect(reminder).toHaveCount(0);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          Object.values(JSON.parse(localStorage.getItem(key) ?? '{}')).every(
            (p) => (p as { offset: number | null }).offset === null,
          ),
        storageKey,
      ),
    )
    .toBe(true);
});

test('WorkSession calendar menu sets, persists and disables only the chosen session reminder', async ({
  page,
}) => {
  await page.goto('/#/inbox');
  await page
    .locator('planstrand-page section')
    .getByRole('button', { name: 'Add Task', exact: true })
    .click();
  const prompt = page.locator('dialog-prompt');
  await prompt.locator('input').fill('Reminder focus');
  await prompt.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(prompt).toBeHidden();
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __e2eTestHelpers?: { store?: unknown } }).__e2eTestHelpers
        ?.store,
  );
  await page.evaluate(() => {
    type Snapshot = {
      tasks: { entities: Record<string, { id: string; title: string }> };
    };
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (next: (state: Snapshot) => void) => { unsubscribe: () => void };
            dispatch: (action: unknown) => void;
          };
        };
      }
    ).__e2eTestHelpers.store;
    let taskId = '';
    const subscription = store.subscribe((state) => {
      taskId = Object.values(state.tasks.entities).find((task) =>
        task.title.includes('Reminder focus'),
      )!.id;
    });
    subscription.unsubscribe();
    const start = new Date();
    start.setHours(15, 0, 0, 0);
    store.dispatch({
      type: '[WorkSession] Add WorkSession',
      workSession: {
        id: 'reminder-session',
        taskId,
        start: start.getTime(),
        end: start.getTime() + 3600000,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        created: Date.now(),
        modified: Date.now(),
      },
      meta: {
        isPersistent: true,
        entityType: 'WORK_SESSION',
        entityId: 'reminder-session',
        opType: 'CRT',
      },
    });
  });
  await page.goto('/#/schedule');
  const block = page
    .locator('schedule-event:not(.custom-drag-preview)')
    .filter({ hasText: 'Reminder focus' })
    .first();
  const actions = block.getByRole('button', { name: 'Actions: Reminder focus' });
  await actions.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
  await page
    .getByRole('menuitemradio', { name: '10 minutes before it starts', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) ?? '{}')['workSession:reminder-session']
            ?.offset,
        storageKey,
      ),
    )
    .toBe(10);
  await page.reload();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
  await expect(page.locator('.schedule-reminder-hint')).toContainText(
    'On this device only',
  );
  await expect(
    page
      .getByRole('menuitemradio', { name: '10 minutes before it starts', exact: true })
      .locator('mat-icon'),
  ).toHaveText('radio_button_checked');
  await page.getByRole('menuitemradio', { name: 'Never', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) ?? '{}')['workSession:reminder-session']
            ?.offset,
        storageKey,
      ),
    )
    .toBeNull();
  for (const theme of ['Light', 'Dark']) {
    await page.goto('/#/config');
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page
      .locator('theme-selector')
      .getByRole('radio', { name: theme, exact: true })
      .click();
    await page.goto('/#/schedule');
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await actions.scrollIntoViewIfNeeded();
      await expect(actions).toBeInViewport();
      await actions.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Reminder', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(
        page.getByRole('menuitemradio', { name: 'Never', exact: true }),
      ).toBeInViewport();
      await expect
        .poll(() =>
          page
            .getByRole('menu')
            .last()
            .evaluate((el) => getComputedStyle(el).opacity),
        )
        .toBe('1');
      await expect(
        page.getByRole('menuitemradio', { name: '1 hour before it starts', exact: true }),
      ).toBeInViewport();
      await page.screenshot({ path: `.tmp/phase5a-session-${theme}-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitemradio')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('menuitem', { name: 'Reminder', exact: true }),
      ).toBeHidden();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});
