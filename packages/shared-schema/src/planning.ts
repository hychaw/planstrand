/** Host semantic family; the deployed generic baseline remains immutable. */
export const PLANNING_V1 = 'PLANNING_V1' as const;

export interface PlanningPlacement {
  id: string;
  target: { type: 'WEEK' | 'DAY'; key: string };
  orderKey: string;
}
export interface PlanningRevision {
  counter: number;
  clientId: string;
  opId: string;
}
export interface PlanningRecord {
  id: string;
  placement: Omit<PlanningPlacement, 'id'> | null;
  revision: PlanningRevision;
}
export interface PlanningState {
  ids: string[];
  entities: Record<string, PlanningRecord | undefined>;
}
export const comparePlanningStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
export const comparePlacements = (a: PlanningPlacement, b: PlanningPlacement): number =>
  comparePlanningStrings(a.orderKey, b.orderKey) || comparePlanningStrings(a.id, b.id);
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const isPlanningOrderKey = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9A-Za-z]+$/.test(v) && !v.endsWith('0');
/** Arbitrary precision fractional strings. Terminal zero is excluded to keep gaps dense. */
export const planningOrderBetween = (
  lower: string | null,
  upper: string | null,
): string => {
  if (
    (lower !== null && !isPlanningOrderKey(lower)) ||
    (upper !== null && !isPlanningOrderKey(upper)) ||
    (lower !== null && upper !== null && lower >= upper)
  )
    throw new Error('Invalid planning order bounds');
  let prefix = '',
    a = lower ?? '',
    b = upper;
  for (;;) {
    const lo = a.length ? DIGITS.indexOf(a[0]) : 0;
    const hi = b === null ? DIGITS.length : DIGITS.indexOf(b[0]);
    if (hi - lo > 1) return prefix + DIGITS[Math.floor((hi + lo) / 2)];
    prefix += DIGITS[lo];
    a = a.slice(1);
    b = hi === lo ? b!.slice(1) : null;
  }
};
export const isPlanningDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
export const isPlanningPlacement = (v: unknown): v is PlanningPlacement => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>,
    t = p['target'] as Record<string, unknown>;
  return (
    Object.keys(p).length === 3 &&
    typeof p['id'] === 'string' &&
    p['id'].trim().length > 0 &&
    !Object.hasOwn(Object.prototype, p['id']) &&
    !!t &&
    typeof t === 'object' &&
    !Array.isArray(t) &&
    Object.keys(t).length === 2 &&
    (t['type'] === 'DAY' || t['type'] === 'WEEK') &&
    isPlanningDate(t['key']) &&
    isPlanningOrderKey(p['orderKey'])
  );
};
export const isPlanningRevision = (v: unknown): v is PlanningRevision => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    Object.keys(r).length === 3 &&
    Number.isSafeInteger(r['counter']) &&
    (r['counter'] as number) >= 0 &&
    typeof r['clientId'] === 'string' &&
    r['clientId'].trim().length > 0 &&
    typeof r['opId'] === 'string' &&
    r['opId'].trim().length > 0
  );
};
export const isPlanningRecord = (v: unknown): v is PlanningRecord => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    Object.keys(r).length === 3 &&
    typeof r['id'] === 'string' &&
    r['id'].trim().length > 0 &&
    !Object.hasOwn(Object.prototype, r['id']) &&
    isPlanningRevision(r['revision']) &&
    (r['placement'] === null ||
      (!!r['placement'] &&
        typeof r['placement'] === 'object' &&
        Object.keys(r['placement']).length === 2 &&
        isPlanningPlacement({ ...r['placement'], id: r['id'] })))
  );
};
export const validatePlanningRecord = (v: unknown): PlanningRecord => {
  if (!isPlanningRecord(v)) throw new Error('Invalid Planning record');
  return v;
};
export const comparePlanningRevision = (
  a: PlanningRevision,
  b: PlanningRevision,
): number => {
  if (!isPlanningRevision(a) || !isPlanningRevision(b))
    throw new Error('Invalid Planning revision');
  return (
    (a.counter < b.counter ? -1 : a.counter > b.counter ? 1 : 0) ||
    comparePlanningStrings(a.clientId, b.clientId) ||
    comparePlanningStrings(a.opId, b.opId)
  );
};
export const mergePlanningRecord = (
  current: PlanningRecord | undefined,
  incoming: PlanningRecord,
): PlanningRecord => {
  validatePlanningRecord(incoming);
  if (!current) return incoming;
  validatePlanningRecord(current);
  if (current.id !== incoming.id) throw new Error('Planning record ID mismatch');
  const comparison = comparePlanningRevision(incoming.revision, current.revision);
  if (comparison === 0) {
    const a = current.placement,
      b = incoming.placement;
    if (
      (a === null) !== (b === null) ||
      (a &&
        b &&
        (a.target.type !== b.target.type ||
          a.target.key !== b.target.key ||
          a.orderKey !== b.orderKey))
    )
      throw new Error('Conflicting payloads for the same Planning revision');
    return current;
  }
  return comparison > 0 ? incoming : current;
};
export const planningPlacementView = (
  record: PlanningRecord | undefined,
): PlanningPlacement | undefined =>
  record?.placement ? { id: record.id, ...record.placement } : undefined;
export const legacyPlanningRecord = (p: PlanningPlacement): PlanningRecord => ({
  id: p.id,
  placement: { target: p.target, orderKey: p.orderKey },
  revision: {
    counter: 0,
    clientId: 'planstrand-migration',
    opId: 'planning-migration:' + p.id,
  },
});
export const mergePlanningState = (
  local: PlanningState,
  remote: PlanningState,
): PlanningState => {
  if (!isPlanningState(local) || !isPlanningState(remote))
    throw new Error('Invalid Planning state');
  const entities = { ...local.entities };
  for (const id of remote.ids)
    entities[id] = mergePlanningRecord(entities[id], remote.entities[id]!);
  return { ids: Object.keys(entities).sort(comparePlanningStrings), entities };
};
export const isPlanningState = (
  v: unknown,
  _live?: ReadonlySet<string>,
): v is PlanningState => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as PlanningState;
  return (
    Object.keys(s).every((k) => k === 'ids' || k === 'entities') &&
    Array.isArray(s.ids) &&
    new Set(s.ids).size === s.ids.length &&
    !!s.entities &&
    typeof s.entities === 'object' &&
    !Array.isArray(s.entities) &&
    Object.keys(s.entities).length === s.ids.length &&
    s.ids.every(
      (id) =>
        typeof id === 'string' &&
        Object.hasOwn(s.entities, id) &&
        isPlanningRecord(s.entities[id]) &&
        s.entities[id]!.id === id,
    )
  );
};
export interface LegacyPlanningEvidence {
  task: {
    ids: readonly string[];
    entities: Record<string, { id: string; dueDay?: unknown } | undefined>;
  };
  planner?: { days?: Record<string, readonly string[]> };
  tag?: { entities?: Record<string, { taskIds?: readonly string[] } | undefined> };
}
/** Snapshot-only projection. Legacy fields never regain authority over schema-5 state. */
export const projectLegacyPlanning = (
  legacy: LegacyPlanningEvidence,
): {
  state: PlanningState;
  diagnostics: {
    ambiguousToday: number;
    invalidReferences: number;
    duplicateMemberships: number;
  };
} => {
  const entities: PlanningState['entities'] = {};
  const diagnostics = {
    ambiguousToday: 0,
    invalidReferences: 0,
    duplicateMemberships: 0,
  };
  const live = new Set(
    legacy.task.ids.filter((id) => legacy.task.entities[id]?.id === id),
  );
  const last = new Map<string, string>();
  const append = (id: string, day: string, tier: string): void => {
    if (!live.has(id)) {
      diagnostics.invalidReferences++;
      return;
    }
    if (Object.hasOwn(entities, id)) {
      diagnostics.duplicateMemberships++;
      return;
    }
    const scope = tier + day,
      key = planningOrderBetween(last.get(scope) ?? null, null);
    last.set(scope, key);
    entities[id] = legacyPlanningRecord({
      id,
      target: { type: 'DAY', key: day },
      orderKey: tier + key,
    });
  };
  // Earliest valid day wins duplicate memberships; retain that day's list order.
  for (const day of Object.keys(legacy.planner?.days ?? {}).sort(
    comparePlanningStrings,
  )) {
    if (!isPlanningDate(day)) continue;
    for (const id of legacy.planner!.days![day]) append(id, day, 'F');
  }
  for (const id of legacy.tag?.entities?.['TODAY']?.taskIds ?? []) {
    if (!live.has(id)) {
      diagnostics.invalidReferences++;
      continue;
    }
    if (Object.hasOwn(entities, id)) continue;
    const day = legacy.task.entities[id]?.dueDay;
    if (isPlanningDate(day)) append(id, day, 'T');
    else diagnostics.ambiguousToday++;
  }
  for (const id of [...live].sort(comparePlanningStrings)) {
    if (Object.hasOwn(entities, id)) continue;
    const day = legacy.task.entities[id]?.dueDay;
    if (isPlanningDate(day)) append(id, day, 'd');
  }
  return {
    state: { ids: Object.keys(entities).sort(comparePlanningStrings), entities },
    diagnostics,
  };
};
