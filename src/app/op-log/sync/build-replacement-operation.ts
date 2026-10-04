import {
  EntityType,
  Operation,
  VectorClock,
  LwwUpdateMode,
  LwwUpdatePayload,
  OpType,
} from '../core/operation.types';
import {
  CURRENT_SCHEMA_VERSION,
  hasTaskFolderOwnership,
  TASK_FOLDER_OWNERSHIP_V1,
} from '@sp/shared-schema';
import { uuidv7 } from '../../util/uuid-v7';
import { isLwwPayloadIdCanonical, isSingletonEntityId } from '../core/entity-registry';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { clearedFieldsProps } from '../../util/cleared-update-fields';
export const buildReplacementOperation = (
  entityType: EntityType,
  entityId: string,
  entityState: unknown,
  clientId: string,
  vectorClock: VectorClock,
  timestamp: number,
  lwwUpdateMode: LwwUpdateMode = 'replace',
  entityIds?: string[],
  listClearedFields: boolean = false,
): Operation => {
  if (entityType === 'PLANNING')
    throw new Error('Planning registers cannot use conflict compensation');
  // NOTE: LWW Update action types (e.g., '[TASK] LWW Update') are intentionally
  // NOT in the ActionType enum. They are dynamically constructed here and matched
  // by regex in lwwUpdateMetaReducer. This is by design - LWW ops are synthetic,
  // created during conflict resolution to carry the winning local state to remote clients.

  // Force payload.id to the canonical entityId for adapter entities.
  // lwwUpdateMetaReducer bails with "Entity data has no id" when an adapter
  // payload lacks a top-level id; a malformed/partial entityState (e.g. an
  // NgRx selector returning a stripped shape) would silently lose the LWW
  // write on remote clients.
  //
  // v18.15.0/v18.15.1 also require a matching payload id whenever entityId is
  // not '*'. Keep that compatibility-only wire field; current receivers strip
  // it before replacing the singleton feature state. (#7330, #9256)
  //
  // This covers EVERY singleton, not just TIME_TRACKING: no shipped singleton
  // producer emits the '*' sentinel (GLOBAL_CONFIG addresses ops by section
  // key, MENU_TREE by tree name / folderId, TIME_TRACKING by a composite
  // TYPE:id:date key), so the else branch below is unreachable in practice and
  // kept only as a guard for a future whole-state '*' producer.
  //
  // SUNSET: this `id` is purely for shipped v18.15.0/v18.15.1 receivers, which
  // reject composite-id singleton ops that lack it. It rides inside the
  // AES-GCM payload (so those receivers see an authenticated, matching id) and
  // never touches the plaintext `op.entityIds`/vector-clock footprint. Remove
  // it (and the receiver-side strip in operation-converter.util.ts) once those
  // two versions are no longer in the active fleet — there is no schema bump to
  // gate on, so this is a manual, fleet-age-based cleanup, not automatic.
  const basePayload =
    entityState !== null && typeof entityState === 'object'
      ? (entityState as Record<string, unknown>)
      : {};
  const actionPayload = { ...basePayload };
  if (isLwwPayloadIdCanonical(entityType) || !isSingletonEntityId(entityId)) {
    actionPayload['id'] = entityId;
  } else {
    delete actionPayload['id'];
  }
  // Compute the move footprint once and carry it BOTH in the plaintext
  // envelope (op.entityIds — the server needs it for its indexed conflict
  // detection and cannot read the encrypted payload) AND inside the
  // authenticated payload (projectMoveFootprint). Remote clients trust only
  // the authenticated copy, closing the envelope-injection vector
  // (GHSA-8pxh-mgc7-gp3g).
  const moveFootprint =
    entityIds !== undefined ? Array.from(new Set([entityId, ...entityIds])) : undefined;
  const payload: LwwUpdatePayload = {
    actionPayload,
    entityChanges: [],
    lwwUpdateMode,
    ...(moveFootprint !== undefined && { projectMoveFootprint: moveFootprint }),
    // Disjoint-merge deltas can carry field CLEARS as undefined values (a
    // merge of a side that cleared a field, #9776). JSON drops those keys on
    // upload, so list them out-of-band; convertOpToAction restores them on
    // receivers. Replace snapshots don't need this (setOne makes an absent
    // key equivalent to a cleared one), and the OTHER patch producers must
    // NOT opt in: they build payloads from live state where an
    // undefined-valued key is an accident of the object literal, not a user
    // intent — e.g. taskRelationshipPatch always materializes `parentId`
    // (undefined for every root task), and broadcasting that as a clear
    // would force-detach concurrently-created subtask links on receivers.
    // Only the disjoint merge re-lists clears that an incoming op itself
    // declared.
    ...(lwwUpdateMode === 'patch' && listClearedFields
      ? clearedFieldsProps(actionPayload)
      : {}),
  };
  return {
    id: uuidv7(),
    actionType: toLwwUpdateActionType(entityType),
    opType: OpType.Update,
    entityType,
    entityId,
    ...(moveFootprint !== undefined && { entityIds: moveFootprint }),
    payload,
    clientId,
    vectorClock,
    timestamp,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...(entityType === 'TASK' && hasTaskFolderOwnership(entityState)
      ? {
          requiredEntityTypes: ['FOLDER'],
          requiredCapabilities: [TASK_FOLDER_OWNERSHIP_V1],
        }
      : {}),
  };
};
