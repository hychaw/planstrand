import { TestBed } from '@angular/core/testing';
import { provideStore, Store } from '@ngrx/store';
import {
  CURRENT_SCHEMA_VERSION,
  ENTITY_TYPES,
  CLIENT_SYNC_READER_CAPABILITIES,
  ROUTINES_V1,
  getFullStateRequiredCapabilities,
  getFullStateRequiredEntityTypes,
} from '@sp/shared-schema';
import {
  WeeklyTemplate,
  WeeklyTemplateInput,
  WeeklyTemplateState,
} from './weekly-template.model';
import {
  isValidWeeklyTemplate,
  isValidWeeklyTemplateInput,
  isValidWeeklyTemplateState,
} from './weekly-template.validation';
import { WeeklyTemplateService } from './weekly-template.service';
import {
  weeklyTemplateReducer,
  initialWeeklyTemplateState,
} from './store/weekly-template.reducer';
import {
  addWeeklyTemplate,
  updateWeeklyTemplate,
  deleteWeeklyTemplate,
} from './store/weekly-template.actions';
import {
  selectTemplateEntries,
  selectWeeklyTemplateFeatureState,
} from './store/weekly-template.selectors';
import { eventSeriesReducer } from './store/event-series.reducer';
import { EventSeriesService } from './event-series.service';
import { EventSeriesInput } from './event-series.model';
import { addEventSeries, deleteEventSeries } from './store/event-series.actions';
import { selectEventSeriesFeatureState } from './store/event-series.selectors';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { createValidAppData } from '../../op-log/validation/state-validity-test-utils';
import { withDefaultModelSlices } from '../../op-log/model/model-config';
import {
  validateFull,
  validateAllData,
  appDataValidators,
} from '../../op-log/validation/validation-fn';
import { hasRecoverableData } from '../../op-log/backup/has-recoverable-data.util';
import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';
import { extractEntityKeysFromState } from '../../op-log/persistence/extract-entity-keys';
import {
  protectFullStateBackup,
  readFullStateBackup,
} from '../../op-log/backup/full-state-backup-envelope';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { TestClient } from '../../op-log/testing/integration/helpers/test-client.helper';
import { Operation, OpType } from '../../op-log/core/operation.types';
import { validateOperationPayload } from '../../op-log/validation/validate-operation-payload';
import {
  getOperationCapabilityRequirement,
  getOperationRequiredCapabilities,
} from '../../op-log/sync/sync-capability.util';
import { getRemoteOpBlockReason } from '../../op-log/sync/remote-op-block.util';
import { buildReplacementOperation } from '../../op-log/sync/build-replacement-operation';

const definition: WeeklyTemplateInput = {
  title: 'Fall Semester',
  isActive: true,
  startDate: '2026-10-01',
  endDate: '2026-12-31',
};
const template: WeeklyTemplate = { ...definition, id: 'fall', created: 1, modified: 1 };
const entry: EventSeriesInput = {
  title: 'Class',
  recurrence: {
    frequency: 'weekly',
    startDate: '2026-09-01',
    interval: 1,
    weekdays: [1, 3],
  },
  timing: { kind: 'allDay' },
};
const state = (): WeeklyTemplateState =>
  weeklyTemplateReducer(undefined, addWeeklyTemplate({ weeklyTemplate: template }));
const operation = (
  action:
    | ReturnType<typeof addWeeklyTemplate>
    | ReturnType<typeof updateWeeklyTemplate>
    | ReturnType<typeof deleteWeeklyTemplate>,
): Operation => {
  const { type, meta, ...actionPayload } = action;
  return new TestClient('sender').createOperation({
    actionType: type,
    entityType: meta.entityType,
    entityId: meta.entityId,
    opType: meta.opType,
    payload: { actionPayload, entityChanges: [] },
  });
};

describe('WeeklyTemplate validation, replay and compatibility', () => {
  it('validates dates, metadata, exact shapes and immutable identity', () => {
    expect(isValidWeeklyTemplate(template)).toBeTrue();
    for (const changes of [
      { title: ' ' },
      { isActive: 1 },
      { startDate: '2026-02-30' },
      { startDate: '2027-01-01' },
      { endDate: undefined },
      { seriesIds: [] },
    ]) {
      expect(isValidWeeklyTemplateInput({ ...definition, ...changes })).toBeFalse();
    }
    for (const changes of [
      { id: '__proto__' },
      { created: 2 },
      { deletedAt: 2 },
      { modified: Infinity },
      { future: true },
    ]) {
      expect(isValidWeeklyTemplate({ ...template, ...changes })).toBeFalse();
    }
    const renamed = weeklyTemplateReducer(
      state(),
      updateWeeklyTemplate({
        id: 'fall',
        changes: { ...definition, title: 'Work Schedule' },
        modified: 2,
      }),
    );
    expect(renamed.entities['fall']).toEqual({
      ...template,
      title: 'Work Schedule',
      modified: 2,
    });
    expect(
      weeklyTemplateReducer(renamed, addWeeklyTemplate({ weeklyTemplate: template })),
    ).toBe(renamed);
    expect(() =>
      weeklyTemplateReducer(renamed, {
        type: '[WEEKLY_TEMPLATE] LWW Update',
        ...template,
        created: 0,
      } as never),
    ).toThrow();
    expect(isValidWeeklyTemplateState({ ...state(), ids: ['wrong'] })).toBeFalse();
  });
  it('retains terminal tombstones before creation and rejects resurrection or metadata changes', () => {
    const deleted = deleteWeeklyTemplate({
      weeklyTemplate: { ...template, deletedAt: 2, modified: 2 },
    });
    const dead = weeklyTemplateReducer(undefined, convertOpToAction(operation(deleted)));
    expect(
      weeklyTemplateReducer(dead, addWeeklyTemplate({ weeklyTemplate: template })),
    ).toBe(dead);
    expect(
      weeklyTemplateReducer(
        dead,
        updateWeeklyTemplate({ id: 'fall', changes: definition, modified: 100 }),
      ),
    ).toBe(dead);
    expect(
      weeklyTemplateReducer(dead, {
        type: '[WEEKLY_TEMPLATE] LWW Update',
        ...template,
        modified: 100,
      } as never),
    ).toBe(dead);
    expect(
      weeklyTemplateReducer(undefined, {
        type: '[WEEKLY_TEMPLATE] LWW Update',
        ...template,
      } as never),
    ).toEqual(initialWeeklyTemplateState);
    expect(() =>
      weeklyTemplateReducer(
        state(),
        deleteWeeklyTemplate({
          weeklyTemplate: { ...template, created: 0, deletedAt: 2, modified: 2 },
        }),
      ),
    ).toThrow();
  });
  it('supports old snapshots, strict validation and protected backup/recovery without generated records', () => {
    const old = createValidAppData();
    delete old.weeklyTemplate;
    expect(validateFull(old).isValid).toBeTrue();
    expect(withDefaultModelSlices(old).weeklyTemplate).toEqual(
      initialWeeklyTemplateState,
    );
    expect(weeklyTemplateReducer(state(), loadAllData({ appDataComplete: old }))).toEqual(
      initialWeeklyTemplateState,
    );
    const data = { ...old, weeklyTemplate: state() };
    expect(validateFull(data).isValid).toBeTrue();
    expect(hasRecoverableData({ weeklyTemplate: state() })).toBeTrue();
    expect(hasMeaningfulStateData({ weeklyTemplate: state() })).toBeTrue();
    expect(extractEntityKeysFromState(data)).toContain('WEEKLY_TEMPLATE:fall');
    const restored = readFullStateBackup(
      JSON.parse(JSON.stringify(protectFullStateBackup(data))),
    );
    expect(restored).toEqual(
      JSON.parse(JSON.stringify({ ...data, requiredCapabilities: [ROUTINES_V1] })),
    );
    const bad = {
      ids: ['fall'],
      entities: { fall: { ...template, startDate: 'invalid' } },
    };
    expect(validateAllData({ ...data, weeklyTemplate: bad }).success).toBeFalse();
    expect(appDataValidators.weeklyTemplate(bad).success).toBeFalse();
    expect(() =>
      weeklyTemplateReducer(
        undefined,
        loadAllData({ appDataComplete: { ...data, weeklyTemplate: bad } as never }),
      ),
    ).toThrow();
    expect(data.task).toBe(old.task);
    expect(data.workSession).toBe(old.workSession);
    expect(data.planning).toBe(old.planning);
    expect(data.event).toBe(old.event);
  });
  it('activates the Routines fence for the first empty template but keeps never-activated V1.1 compatible', () => {
    const full = (payload: unknown): Operation =>
      new TestClient('sender').createOperation({
        actionType: '[SP_ALL] Load(import) all data',
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: '*',
        payload,
      });
    const plain = { weeklyTemplate: initialWeeklyTemplateState };
    const oldEntities = ENTITY_TYPES.filter((type) => type !== 'WEEKLY_TEMPLATE');
    const oldCapabilities = CLIENT_SYNC_READER_CAPABILITIES.filter(
      (cap) => cap !== ROUTINES_V1,
    );
    expect(getFullStateRequiredCapabilities(plain)).toEqual([]);
    expect(getFullStateRequiredEntityTypes(plain)).not.toContain('WEEKLY_TEMPLATE');
    expect(getOperationCapabilityRequirement(full(plain)).entityTypes).not.toContain(
      'WEEKLY_TEMPLATE',
    );
    expect(
      getRemoteOpBlockReason(
        full(plain),
        CURRENT_SCHEMA_VERSION,
        oldEntities,
        oldCapabilities,
      ),
    ).toBeNull();
    const active = { weeklyTemplate: state() };
    expect(getFullStateRequiredCapabilities(active)).toEqual([ROUTINES_V1]);
    expect(
      getRemoteOpBlockReason(
        full(active),
        CURRENT_SCHEMA_VERSION,
        oldEntities,
        oldCapabilities,
      ),
    ).toBe('ENTITY_SUPPORT_REQUIRED');
    const op = operation(addWeeklyTemplate({ weeklyTemplate: template }));
    expect(getOperationRequiredCapabilities(op)).toEqual([ROUTINES_V1]);
    expect(validateOperationPayload(op).success).toBeTrue();
    expect(validateOperationPayload({ ...op, entityId: 'wrong' }).success).toBeFalse();
    expect(
      validateOperationPayload({
        ...op,
        payload: { weeklyTemplate: { ...template, seriesIds: [] } },
      }).success,
    ).toBeFalse();
    expect(
      buildReplacementOperation(
        'WEEKLY_TEMPLATE',
        'fall',
        template,
        'sender',
        { sender: 1 },
        2,
      ).requiredCapabilities,
    ).toEqual([ROUTINES_V1]);
  });
});

describe('WeeklyTemplate commands and durable storage', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideStore({
          weeklyTemplate: weeklyTemplateReducer,
          eventSeries: eventSeriesReducer,
        }),
      ],
    }),
  );
  it('creates independent templates and entries, retains identities on edits, and writes only domain entities', () => {
    const commands = TestBed.inject(WeeklyTemplateService);
    const series = TestBed.inject(EventSeriesService);
    const store = TestBed.inject(Store);
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    expect(commands.create({ ...definition, title: '' })).toBeNull();
    expect(commands.createEntry('missing', entry)).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    const id = commands.create(definition)!;
    const other = commands.create({ ...definition, title: 'Work Schedule' })!;
    expect(other).not.toBe(id);
    const first = commands.createEntry(id, entry)!;
    const second = commands.createEntry(id, { ...entry, title: 'Lab' })!;
    expect(second).not.toBe(first);
    const before = structuredClone(series.entities()[first]!);
    expect(
      commands.createEntry(id, {
        ...entry,
        recurrence: { frequency: 'daily', interval: 1, startDate: '2026-10-01' },
      }),
    ).toBeNull();
    expect(commands.rename(id, 'Renamed')).toBeTrue();
    expect(commands.setActive(id, false)).toBeTrue();
    expect(commands.setActive(id, true)).toBeTrue();
    expect(commands.updateDateWindow(id, 'bad')).toBeFalse();
    expect(commands.updateDateWindow(id, '2026-11-01')).toBeTrue();
    expect(commands.entities()[id]!.endDate).toBeUndefined();
    expect(series.entities()[first]).toEqual(before);
    expect(series.editEntire(first, { title: 'Edited' }).ok).toBeTrue();
    expect(series.entities()[first]!.templateId).toBe(id);
    expect(series.entities()[first]!.segments[0].id).toBe(before.segments[0].id);
    const slice = store.selectSignal(selectEventSeriesFeatureState)();
    expect(
      selectTemplateEntries({ eventSeries: slice }, { id }).map((e) => e.id),
    ).toEqual([first, second]);
    expect(commands.delete(id)).toBeTrue();
    expect(commands.rename(id, 'Resurrect')).toBeFalse();
    expect(commands.setActive(id, true)).toBeFalse();
    expect(commands.createEntry(id, entry)).toBeNull();
    expect(series.editEntire(first, { title: 'Late edit' }).ok).toBeTrue();
    expect(commands.entities()[id]!.deletedAt).toBeDefined();
    const current = series.entities()[first]!;
    expect(() =>
      eventSeriesReducer(slice, {
        type: '[EVENT_SERIES] LWW Update',
        ...before,
        templateId: other,
      } as never),
    ).toThrow();
    expect(() =>
      eventSeriesReducer(
        slice,
        deleteEventSeries({
          eventSeries: { ...current, templateId: other, deletedAt: current.modified },
        }),
      ),
    ).toThrow();
    for (const [action] of dispatch.calls.allArgs())
      expect(['WEEKLY_TEMPLATE', 'EVENT_SERIES']).toContain(
        (action as unknown as ReturnType<typeof addEventSeries>).meta.entityType,
      );
  });
  it('reopens IndexedDB and retains activation through history removal and destructive state replacement', async () => {
    let log = TestBed.inject(OperationLogStoreService);
    await log.init();
    await log._clearAllDataForTesting();
    try {
      expect(await log.getRequiredCapabilities()).toEqual([]);
      const op = operation(addWeeklyTemplate({ weeklyTemplate: template }));
      await log.append(op, 'local');
      await log.appendBatchSkipDuplicates([op], 'remote');
      expect((await log.getOpsAfterSeq(0)).length).toBe(1);
      expect(await log.getRequiredCapabilities()).toEqual([ROUTINES_V1]);
      const commands = TestBed.inject(WeeklyTemplateService);
      const id = commands.create(definition)!;
      const child = commands.createEntry(id, entry)!;
      const store = TestBed.inject(Store);
      const data = createValidAppData({
        weeklyTemplate: store.selectSignal(selectWeeklyTemplateFeatureState)(),
        eventSeries: store.selectSignal(selectEventSeriesFeatureState)(),
      });
      const backedUp = readFullStateBackup(
        JSON.parse(JSON.stringify(protectFullStateBackup(data))),
      );
      expect(backedUp.eventSeries).toEqual(data.eventSeries);
      expect(backedUp.weeklyTemplate).toEqual(data.weeklyTemplate!);
      await log.saveStateCache({
        state: data,
        lastAppliedOpSeq: 1,
        vectorClock: { sender: 1 },
        compactedAt: 100,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideStore({
            weeklyTemplate: weeklyTemplateReducer,
            eventSeries: eventSeriesReducer,
          }),
        ],
      });
      log = TestBed.inject(OperationLogStoreService);
      await log.init();
      const cached = (await log.loadStateCache())!;
      const loaded = loadAllData({ appDataComplete: cached.state as typeof data });
      expect(weeklyTemplateReducer(undefined, loaded)).toEqual(data.weeklyTemplate!);
      expect(eventSeriesReducer(undefined, loaded).entities[child]!.templateId).toBe(id);
      expect(
        weeklyTemplateReducer(
          undefined,
          convertOpToAction((await log.getOpsAfterSeq(0))[0].op),
        ),
      ).toEqual(state());
      await log.deleteOpsWhere(() => true);
      expect(await log.getRequiredCapabilities()).toEqual([ROUTINES_V1]);
      const replacement = new TestClient('sender').createOperation({
        actionType: '[SP_ALL] Load(import) all data',
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: '*',
        payload: createValidAppData(),
      });
      await log.runDestructiveStateReplacement({
        syncImportOp: replacement,
        snapshotEntityKeys: [],
      });
      expect((await log.getOpsAfterSeq(0))[0].op.requiredCapabilities).toEqual([
        ROUTINES_V1,
      ]);
      await log.clearAllOperations();
      await log.clearImportBackup();
      expect(await log.getRequiredCapabilities()).toEqual([ROUTINES_V1]);
    } finally {
      await log._clearAllDataForTesting();
    }
  });
});
