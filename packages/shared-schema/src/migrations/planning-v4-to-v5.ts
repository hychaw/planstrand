import type { SchemaMigration } from '../migration.types';
import {
  isPlanningState,
  LegacyPlanningEvidence,
  projectLegacyPlanning,
} from '../planning';

const upgrade = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid state for planning migration');
  const state = value as Record<string, unknown>;
  if (Object.hasOwn(state, 'planning')) {
    if (!isPlanningState(state['planning'])) throw new Error('Invalid Planning state');
    return state;
  }
  const legacy = state as unknown as LegacyPlanningEvidence;
  if (!legacy.task || !Array.isArray(legacy.task.ids) || !legacy.task.entities)
    throw new Error('Missing Task state for planning migration');
  return { ...state, planning: projectLegacyPlanning(legacy).state };
};

export const PlanningMigration_v4v5: SchemaMigration = {
  fromVersion: 4,
  toVersion: 5,
  description: 'Create normalized date-addressable Planning placements',
  requiresOperationMigration: true,
  migrateState: upgrade,
  migrateOperation: (op) => {
    const fullState =
      ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'].includes(op.opType) ||
      (['MIGRATION', 'RECOVERY'].includes(op.entityType) &&
        !!op.payload &&
        typeof op.payload === 'object' &&
        ('task' in op.payload || 'appDataComplete' in op.payload));
    if (!fullState) return op;
    const payload = op.payload;
    if (payload && typeof payload === 'object' && 'appDataComplete' in payload)
      return {
        ...op,
        payload: { ...payload, appDataComplete: upgrade(payload.appDataComplete) },
      };
    return { ...op, payload: upgrade(payload) };
  },
};
