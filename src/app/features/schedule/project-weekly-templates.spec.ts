import { WeeklyTemplate } from '../routines/weekly-template.model';
import { EventSeries } from '../routines/event-series.model';
import { OccurrenceException } from '../routines/occurrence-exception.model';
import { occurrenceExceptionId } from '../routines/occurrence-exception.validation';
import { projectEventOccurrences } from './project-event-occurrences';
import { eventSeriesReducer } from '../routines/store/event-series.reducer';
import {
  addEventSeries,
  replaceEventSeriesPlan,
} from '../routines/store/event-series.actions';
import { weeklyTemplateReducer } from '../routines/store/weekly-template.reducer';
import {
  addWeeklyTemplate,
  deleteWeeklyTemplate,
  updateWeeklyTemplate,
} from '../routines/store/weekly-template.actions';

const owner: WeeklyTemplate = {
  id: 'fall',
  title: 'Fall Semester',
  isActive: true,
  startDate: '2026-10-05',
  endDate: '2026-10-19',
  created: 1,
  modified: 1,
};
const series: EventSeries = {
  id: 'class',
  templateId: owner.id,
  title: 'Class',
  created: 1,
  modified: 1,
  segments: [
    {
      id: 'segment',
      recurrence: {
        frequency: 'weekly',
        interval: 1,
        weekdays: [1],
        startDate: '2026-09-28',
        endDate: '2026-10-12',
      },
      timing: { kind: 'allDay' },
    },
  ],
};
const range = { fromDate: '2026-09-01', toDateExclusive: '2026-11-01' };
const exception = (
  slot: number,
  value: OccurrenceException['value'],
): OccurrenceException => ({
  id: occurrenceExceptionId({ seriesId: series.id, slot }),
  seriesId: series.id,
  slot,
  value,
  modified: 2,
});
const project = (
  parents: WeeklyTemplate[] = [owner],
  exceptions: OccurrenceException[] = [],
  sources = [series],
  window = range,
): ReturnType<typeof projectEventOccurrences> =>
  projectEventOccurrences(sources, window, 'UTC', exceptions, parents);

describe('WeeklyTemplate bounded Calendar projection', () => {
  it('intersects inclusive template/entry bounds without reanchoring slots, and preserves identities on rename and reactivation', () => {
    const original = project();
    expect(original.map((item) => item.occurrence.scheduledDate)).toEqual([
      '2026-10-05',
      '2026-10-12',
    ]);
    expect(original.map((item) => item.occurrence.slot)).toEqual([1, 2]);
    expect(project([{ ...owner, isActive: false }])).toEqual([]);
    expect(project([{ ...owner, title: 'Renamed', modified: 2 }])).toEqual(original);
    expect(project()).toEqual(original);
    expect(
      project([{ ...owner, startDate: '2026-10-12', endDate: '2026-10-12' }]),
    ).toEqual([original[1]]);
    expect(project([{ ...owner, startDate: '2026-11-01', endDate: undefined }])).toEqual(
      [],
    );
  });
  it('uses original scheduled dates for moved overrides in and out of the window', () => {
    const movedOut = exception(1, {
      kind: 'override',
      event: { title: 'Moved', isAllDay: true, date: '2026-12-01' },
    });
    const movedInFromOutside = exception(0, {
      kind: 'override',
      event: { title: 'Out of template', isAllDay: true, date: '2026-10-06' },
    });
    expect(
      project([owner], [movedOut, movedInFromOutside]).map(
        (item) => item.occurrence.slot,
      ),
    ).toEqual([2]);
    const december = project([owner], [movedOut], [series], {
      fromDate: '2026-12-01',
      toDateExclusive: '2026-12-02',
    });
    expect(december.length).toBe(1);
    expect(december[0].occurrence.slot).toBe(1);
    expect(december[0].occurrence.scheduledDate).toBe('2026-10-05');
    expect(
      project([{ ...owner, isActive: false }], [movedOut], [series], {
        fromDate: '2026-12-01',
        toDateExclusive: '2026-12-02',
      }),
    ).toEqual([]);
    const timed = exception(2, {
      kind: 'override',
      event: {
        title: 'Timed override',
        isAllDay: false,
        start: Date.parse('2026-12-01T09:00Z'),
        end: Date.parse('2026-12-01T10:00Z'),
        timeZone: 'UTC',
      },
    });
    expect(
      project([owner], [timed], [series], {
        fromDate: '2026-12-01',
        toDateExclusive: '2026-12-02',
      })[0].occurrence.slot,
    ).toBe(2);
  });
  it('preserves cancellations, overrides and inherit restorations across lifecycle changes', () => {
    const cancellation = exception(1, { kind: 'cancelled' });
    expect(project([owner], [cancellation]).map((item) => item.occurrence.slot)).toEqual([
      2,
    ]);
    expect(project([{ ...owner, isActive: false }], [cancellation])).toEqual([]);
    expect(project([owner], [cancellation]).length).toBe(1);
    expect(project([owner], [exception(1, { kind: 'inherit' })])).toEqual(project());
  });
  it('suppresses missing/deleted parents, retains orphan entries on reordered replay, and never resurrects after late edits', () => {
    let children = eventSeriesReducer(undefined, addEventSeries({ eventSeries: series }));
    let parents = weeklyTemplateReducer(undefined, { type: 'init' });
    expect(project([], [], [children.entities[series.id]!])).toEqual([]);
    parents = weeklyTemplateReducer(
      parents,
      addWeeklyTemplate({ weeklyTemplate: owner }),
    );
    expect(
      project([parents.entities[owner.id]!], [], [children.entities[series.id]!]),
    ).toEqual(project());
    parents = weeklyTemplateReducer(
      parents,
      deleteWeeklyTemplate({ weeklyTemplate: { ...owner, deletedAt: 2, modified: 2 } }),
    );
    children = eventSeriesReducer(
      children,
      replaceEventSeriesPlan({
        id: series.id,
        plan: { title: 'Late edit', segments: series.segments },
        modified: 3,
      }),
    );
    parents = weeklyTemplateReducer(
      parents,
      updateWeeklyTemplate({
        id: owner.id,
        changes: { title: 'Resurrect', isActive: true, startDate: owner.startDate },
        modified: 100,
      }),
    );
    expect(
      project([parents.entities[owner.id]!], [], [children.entities[series.id]!]),
    ).toEqual([]);
    expect(children.entities[series.id]!.templateId).toBe(owner.id);
    expect(children.ids).toEqual([series.id]);
    expect(project([{ ...owner, deletedAt: 2, modified: 2 }])).toEqual([]);
  });
  it('projects overlapping templates and multiple entries independently while leaving standalone recurrences unchanged', () => {
    const second = { ...owner, id: 'work', title: 'Work Schedule' };
    const sources = [
      series,
      { ...series, id: 'lab' },
      { ...series, id: 'work-entry', templateId: second.id },
    ];
    const items = project([owner, second], [], sources);
    expect(items.length).toBe(6);
    expect(new Set(items.map((item) => item.id)).size).toBe(6);
    const standalone = { ...series };
    delete (standalone as { templateId?: string }).templateId;
    expect(project([], [], [standalone])).toEqual(
      projectEventOccurrences([standalone], range, 'UTC'),
    );
    expect(project([], [], [standalone]).length).toBe(3);
    const daily = {
      ...series,
      segments: [
        {
          ...series.segments[0],
          recurrence: {
            frequency: 'daily' as const,
            interval: 1,
            startDate: '2026-10-05',
            endDate: '2026-10-06',
          },
        },
      ],
    };
    expect(project([owner], [], [daily]).length).toBe(2);
  });
  for (const [view, window] of [
    ['Day', { fromDate: '2026-10-05', toDateExclusive: '2026-10-06' }],
    ['Week', { fromDate: '2026-10-05', toDateExclusive: '2026-10-12' }],
    ['Month', { fromDate: '2026-10-01', toDateExclusive: '2026-11-01' }],
    ['Year', { fromDate: '2026-01-01', toDateExclusive: '2027-01-01' }],
  ] as const) {
    it(`uses the same canonical identities and ownership policy for ${view}`, () => {
      const before = JSON.stringify({ owner, series });
      const items = project([owner], [], [series], window);
      expect(items[0]).toEqual(project()[0]);
      expect(project([{ ...owner, isActive: false }], [], [series], window)).toEqual([]);
      expect(JSON.stringify({ owner, series })).toBe(before);
    });
  }
  it('uses civil scheduled dates for overnight timed entries in different display zones', () => {
    const timed: EventSeries = {
      ...series,
      segments: [
        {
          ...series.segments[0],
          timing: {
            kind: 'timed',
            localTime: '23:30',
            timeZone: 'America/Vancouver',
            durationMs: 7200000,
          },
        },
      ],
    };
    const oneDay = { ...owner, startDate: '2026-10-05', endDate: '2026-10-05' };
    const items = projectEventOccurrences(
      [timed],
      { fromDate: '2026-10-06', toDateExclusive: '2026-10-07' },
      'Asia/Tokyo',
      [],
      [oneDay],
    );
    expect(items.length).toBe(1);
    expect(items[0].occurrence.scheduledDate).toBe('2026-10-05');
  });
});
