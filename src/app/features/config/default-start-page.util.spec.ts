import { getStartPageUrlPath } from './default-start-page.util';
import { DefaultStartPage } from './default-start-page.const';
import { AppFeaturesConfig } from './global-config.model';
import { Project } from '../project/project.model';
import { TODAY_TAG } from '../tag/tag.const';
import { INBOX_PROJECT } from '../project/project.const';

const TODAY_URL = '/today';

const features = (over: Partial<AppFeaturesConfig> = {}): AppFeaturesConfig =>
  ({
    isPlannerEnabled: true,
    isSchedulerEnabled: true,
    isBoardsEnabled: true,
    ...over,
  }) as AppFeaturesConfig;

const project = (over: Partial<Project> = {}): Project =>
  ({
    id: 'p1',
    isArchived: false,
    isHiddenFromMenu: false,
    ...over,
  }) as Project;

describe('getStartPageUrlPath', () => {
  describe('built-in start pages', () => {
    it('resolves undefined → Today', () => {
      expect(getStartPageUrlPath(undefined, features(), undefined)).toBe(TODAY_URL);
    });

    it('preserves explicitly configured legacy Today', () => {
      expect(getStartPageUrlPath(DefaultStartPage.Today, features(), undefined)).toBe(
        `/tag/${TODAY_TAG.id}/tasks`,
      );
    });

    it('resolves legacy Inbox → inbox project', () => {
      expect(getStartPageUrlPath(DefaultStartPage.Inbox, features(), undefined)).toBe(
        `/project/${INBOX_PROJECT.id}/tasks`,
      );
    });

    it('resolves Planner when enabled', () => {
      expect(getStartPageUrlPath(DefaultStartPage.Planner, features(), undefined)).toBe(
        '/planner',
      );
    });

    it('falls back to Today when Planner is disabled', () => {
      expect(
        getStartPageUrlPath(
          DefaultStartPage.Planner,
          features({ isPlannerEnabled: false }),
          undefined,
        ),
      ).toBe(TODAY_URL);
    });

    it('resolves Schedule when enabled, Today when disabled', () => {
      expect(getStartPageUrlPath(DefaultStartPage.Schedule, features(), undefined)).toBe(
        '/schedule',
      );
      expect(
        getStartPageUrlPath(
          DefaultStartPage.Schedule,
          features({ isSchedulerEnabled: false }),
          undefined,
        ),
      ).toBe(TODAY_URL);
    });

    it('resolves Boards when enabled, Today when disabled', () => {
      expect(getStartPageUrlPath(DefaultStartPage.Boards, features(), undefined)).toBe(
        '/boards',
      );
      expect(
        getStartPageUrlPath(
          DefaultStartPage.Boards,
          features({ isBoardsEnabled: false }),
          undefined,
        ),
      ).toBe(TODAY_URL);
    });

    it('treats an empty string as Today', () => {
      expect(getStartPageUrlPath('', features(), undefined)).toBe(TODAY_URL);
    });
  });

  it('resolves all Planstrand destinations without depending on legacy feature toggles', () => {
    const disabled = features({
      isPlannerEnabled: false,
      isSchedulerEnabled: false,
      isBoardsEnabled: false,
    });
    for (const [page, route] of [
      [DefaultStartPage.PlanstrandToday, '/today'],
      [DefaultStartPage.PlanstrandInbox, '/inbox'],
      [DefaultStartPage.MasterTasks, '/master-tasks'],
      [DefaultStartPage.ThisWeek, '/this-week'],
    ] as const) {
      expect(getStartPageUrlPath(page, disabled, undefined)).toBe(route);
    }
    expect(getStartPageUrlPath(999, disabled, undefined)).toBe('/today');
  });

  describe('project start pages', () => {
    it('resolves to the project task list when valid', () => {
      expect(getStartPageUrlPath('p1', features(), project({ id: 'p1' }))).toBe(
        '/project/p1/tasks',
      );
    });

    it('builds the path from the validated project id, not the raw config string', () => {
      expect(getStartPageUrlPath('anything', features(), project({ id: 'p2' }))).toBe(
        '/project/p2/tasks',
      );
    });

    it('falls back to Today when the project is missing', () => {
      expect(getStartPageUrlPath('p1', features(), undefined)).toBe(TODAY_URL);
    });

    it('falls back to Today when the project is archived', () => {
      expect(
        getStartPageUrlPath('p1', features(), project({ id: 'p1', isArchived: true })),
      ).toBe(TODAY_URL);
    });

    it('falls back to Today when the project is hidden from the menu', () => {
      expect(
        getStartPageUrlPath(
          'p1',
          features(),
          project({ id: 'p1', isHiddenFromMenu: true }),
        ),
      ).toBe(TODAY_URL);
    });
  });
});
