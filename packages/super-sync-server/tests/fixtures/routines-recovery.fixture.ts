// Persisted V1.2 actionPayload envelopes, including complete compensation values.
export const recoverySeries = (
  id: string,
  frequency: 'daily' | 'weekly' | 'monthly' = 'daily',
  templateId?: string,
) => ({
  id,
  title: id,
  created: 1,
  modified: 1,
  ...(templateId ? { templateId } : {}),
  segments: [
    {
      id: `${id}-first`,
      recurrence: {
        frequency,
        interval: 1,
        startDate: '2026-01-01',
        ...(frequency === 'weekly' ? { weekdays: [1, 4] } : {}),
      },
      timing: { kind: 'allDay' },
    },
  ],
});
export const recoveryTemplate = (id: string) => ({
  id,
  title: id,
  isActive: true,
  startDate: '2026-01-01',
  created: 1,
  modified: 1,
});
export const recoveryException = (
  seriesId: string,
  slot: number,
  value: Record<string, unknown>,
  modified = 5,
) => ({
  id: `occurrenceException:${JSON.stringify([seriesId, slot])}`,
  seriesId,
  slot,
  value,
  modified,
});
export const recoveryBase = () => ({
  task: {
    ids: ['task'],
    entities: {
      task: { id: 'task', title: 'ordinary task', subTaskIds: [], tagIds: [] },
    },
  },
  folder: {
    ids: ['folder'],
    entities: { folder: { id: 'folder', title: 'ordinary folder', parentId: null } },
  },
  event: {
    ids: ['event'],
    entities: {
      event: {
        id: 'event',
        title: 'ordinary event',
        isAllDay: true,
        date: '2026-01-01',
        created: 1,
        modified: 1,
      },
    },
  },
  workSession: {
    ids: ['work'],
    entities: {
      work: {
        id: 'work',
        taskId: 'task',
        start: 100,
        end: 200,
        timeZone: 'UTC',
        created: 1,
        modified: 1,
      },
    },
  },
  planning: { ids: [], entities: {} },
  eventSeries: { ids: [] as string[], entities: {} },
  occurrenceException: { ids: [] as string[], entities: {} },
  weeklyTemplate: { ids: [] as string[], entities: {} },
});
export interface RecoveryFixtureOperation {
  actionType: string;
  entityType: string;
  entityId: string;
  opType: string;
  payload: Record<string, unknown>;
  repairBaseServerSeq?: number;
}
export const recoveryOperation = (
  actionType: string,
  entityType: string,
  entityId: string,
  actionPayload: Record<string, unknown>,
  opType = 'UPD',
): RecoveryFixtureOperation => ({
  actionType,
  entityType,
  entityId,
  opType,
  payload: { actionPayload, entityChanges: [] },
});
export const routinesRecoveryFixture = () => {
  const daily = recoverySeries('daily'),
    weekly = recoverySeries('weekly', 'weekly'),
    monthly = recoverySeries('monthly', 'monthly');
  const parent = recoveryTemplate('parent'),
    active = recoveryTemplate('active');
  const ownedOne = recoverySeries('entry-one', 'weekly', parent.id),
    ownedTwo = recoverySeries('entry-two', 'weekly', parent.id),
    late = recoverySeries('late-entry', 'weekly', parent.id);
  const predeleted = { ...recoverySeries('predeleted'), modified: 40, deletedAt: 40 };
  const split = {
    title: 'Split daily',
    segments: [
      daily.segments[0],
      {
        id: 'daily-future',
        logicalSlotOffset: 10,
        title: 'Future',
        recurrence: {
          frequency: 'weekly',
          interval: 2,
          startDate: '2026-01-11',
          weekdays: [2, 5],
        },
        timing: {
          kind: 'timed',
          localTime: '09:30',
          timeZone: 'America/Vancouver',
          durationMs: 3600000,
        },
      },
    ],
  };
  const editedWeekly = {
    ...weekly,
    title: 'Weekly edited',
    modified: 3,
    segments: [
      {
        ...weekly.segments[0],
        recurrence: {
          frequency: 'weekly',
          interval: 2,
          startDate: '2026-01-05',
          weekdays: [1, 4],
        },
        timing: { kind: 'allDay' },
      },
    ],
  };
  const deletedDaily = { ...daily, ...split, modified: 30, deletedAt: 30 };
  const deletedEntry = { ...ownedOne, modified: 22, deletedAt: 22 };
  const changedParent = {
    ...parent,
    title: 'Renamed week',
    isActive: false,
    startDate: '2026-02-01',
    endDate: '2026-03-01',
    modified: 15,
  };
  const deletedParent = { ...changedParent, modified: 24, deletedAt: 24 };
  const changedActive = {
    ...active,
    title: 'Active renamed',
    startDate: '2026-02-02',
    modified: 18,
  };
  const override = recoveryException('daily', 12, {
    kind: 'override',
    event: { title: 'Moved', isAllDay: true, date: '2026-03-01' },
  });
  const cancelled = recoveryException('monthly', 1, { kind: 'cancelled' });
  const restored = recoveryException('weekly', 2, { kind: 'inherit' }, 9);
  const compensation = recoveryException(
    'daily',
    3,
    {
      kind: 'override',
      event: {
        title: 'Compensated',
        isAllDay: false,
        start: 1000,
        end: 2000,
        timeZone: 'UTC',
      },
    },
    35,
  );
  const ops: RecoveryFixtureOperation[] = [];
  const createSeries = (value: ReturnType<typeof recoverySeries>) =>
    ops.push(
      recoveryOperation(
        '[EventSeries] Add Event Series',
        'EVENT_SERIES',
        value.id,
        { eventSeries: value },
        'CRT',
      ),
    );
  const createTemplate = (value: ReturnType<typeof recoveryTemplate>) =>
    ops.push(
      recoveryOperation(
        '[WeeklyTemplate] Add Weekly Template',
        'WEEKLY_TEMPLATE',
        value.id,
        { weeklyTemplate: value },
        'CRT',
      ),
    );
  const setException = (value: ReturnType<typeof recoveryException>) =>
    ops.push(
      recoveryOperation(
        '[OccurrenceException] Set Occurrence Exception',
        'OCCURRENCE_EXCEPTION',
        value.id,
        { occurrenceException: value },
      ),
    );
  createSeries(daily);
  createSeries(weekly);
  createSeries(monthly);
  ops.push(
    recoveryOperation('[EventSeries] Update Event Series', 'EVENT_SERIES', weekly.id, {
      id: weekly.id,
      changes: {
        title: editedWeekly.title,
        recurrence: editedWeekly.segments[0].recurrence,
        timing: editedWeekly.segments[0].timing,
      },
      modified: 3,
    }),
  );
  ops.push(
    recoveryOperation('[EventSeries] Replace Schedule Plan', 'EVENT_SERIES', daily.id, {
      id: daily.id,
      plan: split,
      modified: 4,
    }),
  );
  setException(override);
  setException(cancelled);
  setException(recoveryException('weekly', 2, { kind: 'cancelled' }, 8));
  setException(restored);
  createTemplate(parent);
  createTemplate(active);
  createSeries(ownedOne);
  createSeries(ownedTwo);
  ops.push(
    recoveryOperation(
      '[WeeklyTemplate] Update Weekly Template',
      'WEEKLY_TEMPLATE',
      parent.id,
      {
        id: parent.id,
        changes: {
          title: changedParent.title,
          isActive: false,
          startDate: changedParent.startDate,
          endDate: changedParent.endDate,
        },
        modified: 15,
      },
    ),
  );
  ops.push(
    recoveryOperation(
      '[WeeklyTemplate] Update Weekly Template',
      'WEEKLY_TEMPLATE',
      active.id,
      {
        id: active.id,
        changes: {
          title: 'Disabled',
          isActive: false,
          startDate: '2026-01-02',
          endDate: '2026-04-01',
        },
        modified: 16,
      },
    ),
  );
  ops.push(
    recoveryOperation(
      '[WeeklyTemplate] Update Weekly Template',
      'WEEKLY_TEMPLATE',
      active.id,
      {
        id: active.id,
        changes: {
          title: changedActive.title,
          isActive: true,
          startDate: changedActive.startDate,
        },
        modified: 18,
      },
    ),
  );
  ops.push(
    recoveryOperation('[EventSeries] Delete Entire Series', 'EVENT_SERIES', ownedOne.id, {
      eventSeries: deletedEntry,
    }),
  );
  ops.push(
    recoveryOperation(
      '[WeeklyTemplate] Delete Weekly Template',
      'WEEKLY_TEMPLATE',
      parent.id,
      { weeklyTemplate: deletedParent },
    ),
  );
  createSeries(late);
  createTemplate(parent); // late creation cannot resurrect a parent
  ops.push(
    recoveryOperation(
      '[WeeklyTemplate] Update Weekly Template',
      'WEEKLY_TEMPLATE',
      parent.id,
      {
        id: parent.id,
        changes: { title: 'Late', isActive: true, startDate: '2026-03-01' },
        modified: 25,
      },
    ),
  );
  ops.push(
    recoveryOperation('[EventSeries] Delete Entire Series', 'EVENT_SERIES', daily.id, {
      eventSeries: deletedDaily,
    }),
  );
  ops.push(
    recoveryOperation('[EventSeries] Replace Schedule Plan', 'EVENT_SERIES', daily.id, {
      id: daily.id,
      plan: split,
      modified: 31,
    }),
  );
  for (const [type, value] of [
    ['EVENT_SERIES', { ...deletedDaily, deletedAt: undefined, modified: 32 }],
    ['WEEKLY_TEMPLATE', { ...parent, modified: 32 }],
    ['EVENT_SERIES', recoverySeries('absent')],
    ['OCCURRENCE_EXCEPTION', compensation],
  ] as const) {
    const op = recoveryOperation(`[${type}] LWW Update`, type, value.id, value);
    op.payload['lwwUpdateMode'] = 'replace';
    ops.push(op);
  }
  ops.push(
    recoveryOperation(
      '[EventSeries] Delete Entire Series',
      'EVENT_SERIES',
      predeleted.id,
      { eventSeries: predeleted },
    ),
  );
  createSeries(recoverySeries('predeleted'));
  createSeries(weekly);
  setException(compensation); // duplicate delivery
  const expected = {
    ...recoveryBase(),
    eventSeries: {
      ids: [
        'daily',
        'weekly',
        'monthly',
        'entry-one',
        'entry-two',
        'late-entry',
        'predeleted',
      ],
      entities: {
        daily: deletedDaily,
        weekly: editedWeekly,
        monthly,
        'entry-one': deletedEntry,
        'entry-two': ownedTwo,
        'late-entry': late,
        predeleted,
      },
    },
    occurrenceException: {
      ids: [override.id, cancelled.id, restored.id, compensation.id],
      entities: {
        [override.id]: override,
        [cancelled.id]: cancelled,
        [restored.id]: restored,
        [compensation.id]: compensation,
      },
    },
    weeklyTemplate: {
      ids: ['parent', 'active'],
      entities: { parent: deletedParent, active: changedActive },
    },
  };
  return { base: recoveryBase(), ops, expected };
};
