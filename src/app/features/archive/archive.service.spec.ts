import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { ArchiveService } from './archive.service';
import { flushYoungToOld } from './store/archive.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TaskWithSubTasks } from '../tasks/task.model';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { of } from 'rxjs';
import { ArchiveModel } from './archive.model';

describe('ArchiveService', () => {
  let service: ArchiveService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockArchiveDbAdapter: jasmine.SpyObj<ArchiveDbAdapter>;

  const createEmptyArchive = (lastTimeTrackingFlush: number = 0): ArchiveModel => ({
    task: { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush,
  });

  const ONE_DAY_MS = 1000 * 60 * 60 * 24;

  const createMockTask = (
    id: string,
    overrides: Partial<TaskWithSubTasks> = {},
  ): TaskWithSubTasks =>
    ({
      id,
      title: `Task ${id}`,
      isDone: true,
      doneOn: Date.now() - ONE_DAY_MS,
      subTaskIds: [],
      tagIds: [],
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      ...overrides,
    }) as TaskWithSubTasks;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    // Mock store.select to return time tracking state
    mockStore.select.and.returnValue(of({ project: {}, tag: {} }));

    mockArchiveDbAdapter = jasmine.createSpyObj('ArchiveDbAdapter', [
      'loadArchiveYoung',
      'loadArchiveOld',
      'saveArchiveYoung',
      'saveArchiveOld',
      'saveArchivesAtomic',
    ]);

    TestBed.configureTestingModule({
      providers: [
        ArchiveService,
        { provide: Store, useValue: mockStore },
        { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
      ],
    });

    service = TestBed.inject(ArchiveService);

    // Default mock returns
    mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(
      Promise.resolve(createEmptyArchive()),
    );
    mockArchiveDbAdapter.loadArchiveOld.and.returnValue(
      Promise.resolve(createEmptyArchive()),
    );
    mockArchiveDbAdapter.saveArchiveYoung.and.returnValue(Promise.resolve());
    mockArchiveDbAdapter.saveArchiveOld.and.returnValue(Promise.resolve());
    mockArchiveDbAdapter.saveArchivesAtomic.and.resolveTo();
  });

  describe('moveTasksToArchiveAndFlushArchiveIfDue', () => {
    it('rejects Tasks with WorkSessions before writing storage', async () => {
      mockStore.select.and.returnValue(
        of({ ids: ['s'], entities: { s: { id: 's', taskId: 'task-1' } } }),
      );
      await expectAsync(
        service.moveTasksToArchiveAndFlushArchiveIfDue([createMockTask('task-1')]),
      ).toBeRejectedWithError(
        'Remove WorkSessions before deleting or archiving their Task',
      );
      expect(mockArchiveDbAdapter.saveArchivesAtomic).not.toHaveBeenCalled();
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    for (const due of [true, false])
      it(`atomically inserts and optionally flushes (due=${due}) before capturing one command`, async () => {
        mockArchiveDbAdapter.loadArchiveOld.and.resolveTo(
          createEmptyArchive(due ? 0 : Date.now()),
        );
        const order: string[] = [];
        mockArchiveDbAdapter.saveArchivesAtomic.and.callFake(async () => {
          order.push('persist');
        });
        mockStore.dispatch = jasmine.createSpy('dispatch').and.callFake(() => {
          order.push('dispatch');
        });
        await service.moveTasksToArchiveAndFlushArchiveIfDue([createMockTask('task-1')]);
        expect(order).toEqual(['persist', 'dispatch']);
        expect(mockArchiveDbAdapter.saveArchivesAtomic).toHaveBeenCalledTimes(1);
        const action = mockStore.dispatch.calls.mostRecent()
          .args[0] as unknown as ReturnType<typeof TaskSharedActions.moveToArchive>;
        expect(action.type).toBe(TaskSharedActions.moveToArchive.type);
        expect(action.archiveCommand?.version).toBe(1);
        expect(action.archiveCommand?.flushTimestamp !== undefined).toBe(due);
        expect(mockStore.dispatch).not.toHaveBeenCalledWith(
          jasmine.objectContaining({ type: flushYoungToOld.type }),
        );
      });

    it('does not dispatch or leave partial writes when the atomic save fails', async () => {
      mockArchiveDbAdapter.saveArchivesAtomic.and.rejectWith(
        new Error('atomic write failed'),
      );
      await expectAsync(
        service.moveTasksToArchiveAndFlushArchiveIfDue([createMockTask('task-1')]),
      ).toBeRejectedWithError('atomic write failed');
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it('rolls back both archives if command dispatch fails', async () => {
      mockStore.dispatch.and.throwError('command rejected');
      await expectAsync(
        service.moveTasksToArchiveAndFlushArchiveIfDue([createMockTask('task-1')]),
      ).toBeRejectedWithError('command rejected');
      expect(mockArchiveDbAdapter.saveArchivesAtomic).toHaveBeenCalledTimes(2);
      expect(mockArchiveDbAdapter.saveArchivesAtomic.calls.mostRecent().args).toEqual([
        createEmptyArchive(),
        createEmptyArchive(),
      ]);
    });

    it('serializes concurrent commands without dropping either Task', async () => {
      let young = createEmptyArchive();
      let old = createEmptyArchive(Date.now());
      mockArchiveDbAdapter.loadArchiveYoung.and.callFake(async () => young);
      mockArchiveDbAdapter.loadArchiveOld.and.callFake(async () => old);
      mockArchiveDbAdapter.saveArchivesAtomic.and.callFake(async (nextYoung, nextOld) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        young = nextYoung;
        old = nextOld;
      });
      await Promise.all(
        ['task-a', 'task-b'].map((id) =>
          service.moveTasksToArchiveAndFlushArchiveIfDue([createMockTask(id)]),
        ),
      );
      expect(young.task.ids).toEqual(['task-a', 'task-b']);
      expect(mockStore.dispatch).toHaveBeenCalledTimes(2);
    });

    it('does nothing for an empty or wholly malformed request', async () => {
      await service.moveTasksToArchiveAndFlushArchiveIfDue([]);
      await service.moveTasksToArchiveAndFlushArchiveIfDue([
        { subTasks: [] } as unknown as TaskWithSubTasks,
      ]);
      expect(mockArchiveDbAdapter.saveArchivesAtomic).not.toHaveBeenCalled();
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('writeTasksToArchiveForRemoteSync', () => {
    it('should replace a stale archived task on remote retry and keep ids deduped and sorted', async () => {
      const staleTask = createMockTask('task-b', {
        title: 'Stale remote title',
        timeSpent: 1,
      });
      const otherTask = createMockTask('task-a');
      mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(
        Promise.resolve({
          ...createEmptyArchive(),
          task: {
            ids: ['task-b', 'task-a', 'task-b'],
            entities: {
              [otherTask.id]: otherTask,
              [staleTask.id]: staleTask,
            },
          },
        }),
      );
      const retriedTask = createMockTask('task-b', {
        title: 'Newest remote title',
        timeSpent: 84,
      });

      await service.writeTasksToArchiveForRemoteSync([retriedTask]);

      const savedTaskState =
        mockArchiveDbAdapter.saveArchiveYoung.calls.mostRecent().args[0].task;
      expect(savedTaskState.ids).toEqual(['task-a', 'task-b']);
      expect(savedTaskState.entities['task-b']!.title).toBe('Newest remote title');
      expect(savedTaskState.entities['task-b']!.timeSpent).toBe(84);
    });

    it('should leave the archive unchanged when a duplicate archive op replays (#10102)', async () => {
      let archiveYoung = createEmptyArchive();
      mockArchiveDbAdapter.loadArchiveYoung.and.callFake(async () => archiveYoung);
      mockArchiveDbAdapter.saveArchiveYoung.and.callFake(async (next) => {
        archiveYoung = next;
      });
      const tasks = [createMockTask('task-a'), createMockTask('task-b')];

      await service.writeTasksToArchiveForRemoteSync(tasks);
      const afterFirstCopy = archiveYoung;
      await service.writeTasksToArchiveForRemoteSync(tasks);

      expect(archiveYoung).toEqual(afterFirstCopy);
      expect(archiveYoung.task.ids).toEqual(['task-a', 'task-b']);
    });

    it('should ignore malformed tasks without valid ids', async () => {
      const invalidTask = {
        title: 'Invalid task',
        subTasks: [],
      } as unknown as TaskWithSubTasks;

      await service.writeTasksToArchiveForRemoteSync([invalidTask]);

      expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
    });

    it('should drop malformed subtasks before persisting archive data', async () => {
      const invalidSubTask = { title: 'Invalid subtask' } as unknown as TaskWithSubTasks;
      const parentTask = createMockTask('task-1', {
        subTaskIds: ['sub-1'],
        subTasks: [invalidSubTask as any],
      });

      await service.writeTasksToArchiveForRemoteSync([parentTask]);

      expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalled();
      const savedData = mockArchiveDbAdapter.saveArchiveYoung.calls.mostRecent().args[0];
      expect(savedData.task.ids).toEqual(['task-1']);
      expect(Object.keys(savedData.task.entities)).toEqual(['task-1']);
      expect(savedData.task.entities['task-1']!.subTaskIds).toEqual([]);
    });

    it('should sync subTaskIds with surviving subtasks when some are dropped', async () => {
      // If a subtask is dropped because its id is invalid, the parent's subTaskIds
      // must drop the same reference so the archived parent doesn't carry a
      // dangling id that would re-surface on restore / remote sync.
      const validSubTask = createMockTask('sub-ok', { parentId: 'task-1' });
      const invalidSubTask = {
        title: 'broken',
        subTasks: [],
      } as unknown as TaskWithSubTasks;
      const parentTask = createMockTask('task-1', {
        subTaskIds: ['sub-ok', 'sub-broken'],
        subTasks: [validSubTask, invalidSubTask as any],
      });

      await service.writeTasksToArchiveForRemoteSync([parentTask]);

      expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalled();
      const savedData = mockArchiveDbAdapter.saveArchiveYoung.calls.mostRecent().args[0];
      const savedParent = savedData.task.entities['task-1'];
      expect(savedParent).toBeDefined();
      expect(savedParent!.subTaskIds).toEqual(['sub-ok']);
    });
  });
});
