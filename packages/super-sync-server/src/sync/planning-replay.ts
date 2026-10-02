import {
  PLANNING_V1,
  isPlanningRecord,
  mergePlanningRecord,
  isPlanningState,
  comparePlanningStrings,
  type PlanningState,
} from '@sp/shared-schema';
const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
/** Server reconstruction of the host semantic family, preserving normalized Task presence. */
export const applyPlanningReplay = (
  state: Record<string, unknown>,
  opType: string,
  entityType: string,
  entityId: string | null,
  payload: unknown,
  entityIds: readonly string[] = [],
): boolean => {
  const outer = record(payload),
    body = record(outer?.['actionPayload']) ?? outer;
  const task = record(state['task']),
    taskEntities = record(task?.['entities']);
  if (entityType === 'TASK' && opType === 'CRT') {
    const created = record(body?.['task']);
    if (
      created &&
      typeof created['id'] === 'string' &&
      Array.isArray(created['subTaskIds']) &&
      Array.isArray(created['tagIds'])
    ) {
      const id = created['id'];
      if (!Object.prototype.hasOwnProperty.call(Object.prototype, id))
        state['task'] = {
          ...(task ?? {}),
          ids: [
            ...new Set([
              ...(Array.isArray(task?.['ids']) ? (task['ids'] as string[]) : []),
              id,
            ]),
          ].sort(comparePlanningStrings),
          entities: { ...(taskEntities ?? {}), [id]: created },
        };
    }
  }
  if (entityType === 'TASK' && opType === 'DEL' && task && taskEntities) {
    const removed = new Set(entityIds.length ? entityIds : entityId ? [entityId] : []);
    for (const id of removed) {
      const current = record(taskEntities[id]);
      for (const child of Array.isArray(current?.['subTaskIds'])
        ? current['subTaskIds']
        : [])
        if (typeof child === 'string') removed.add(child);
    }
    const entities = { ...taskEntities };
    for (const id of removed) delete entities[id];
    state['task'] = {
      ...task,
      ids: (Array.isArray(task['ids']) ? (task['ids'] as string[]) : []).filter(
        (id) => !removed.has(id),
      ),
      entities,
    };
  }
  if (opType !== PLANNING_V1) return false;
  if (
    entityType !== 'PLANNING' ||
    !entityId ||
    !body ||
    Object.prototype.hasOwnProperty.call(Object.prototype, entityId)
  )
    throw new Error('Invalid Planning replay');
  const existing = state['planning'];
  if (existing !== undefined && !isPlanningState(existing))
    throw new Error('Invalid Planning replay state');
  const planning: PlanningState = (existing as PlanningState | undefined) ?? {
    ids: [],
    entities: {},
  };
  const entities = { ...planning.entities };
  const incoming = body['record'];
  if (!isPlanningRecord(incoming) || incoming.id !== entityId)
    throw new Error('Invalid Planning replay record');
  entities[entityId] = mergePlanningRecord(entities[entityId], incoming);
  state['planning'] = {
    ids: Object.keys(entities).sort(comparePlanningStrings),
    entities,
  };
  return true;
};
