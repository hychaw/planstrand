import { isValidEntityId } from '../../op-log/validation/is-valid-entity-id';

export interface OccurrenceKey {
  readonly seriesId: string;
  readonly slot: number;
}
export const isLogicalSlot = (slot: unknown): slot is number =>
  typeof slot === 'number' &&
  Number.isSafeInteger(slot) &&
  slot >= 0 &&
  !Object.is(slot, -0);
export const isValidOccurrenceKey = (key: unknown): key is OccurrenceKey => {
  if (!key || typeof key !== 'object' || Array.isArray(key)) return false;
  const v = key as Record<string, unknown>;
  return (
    Object.keys(v).every((k) => ['seriesId', 'slot'].includes(k)) &&
    isValidEntityId(v['seriesId']) &&
    !Object.hasOwn(Object.prototype, v['seriesId']) &&
    isLogicalSlot(v['slot'])
  );
};
/** JSON tuple encoding is injective even for delimiters, quotes and Unicode IDs. */
export const occurrenceKey = (key: OccurrenceKey): string => {
  if (!isValidOccurrenceKey(key)) throw new Error('Invalid occurrence key');
  return JSON.stringify([key.seriesId, key.slot]);
};
/** Segment-local engine slots are translated to lineage-global slots here. */
export const logicalOccurrenceSlot = (localSlot: number, offset = 0): number => {
  const slot = localSlot + offset;
  if (!isLogicalSlot(localSlot) || !isLogicalSlot(offset) || !isLogicalSlot(slot))
    throw new Error('Invalid logical occurrence slot');
  return slot;
};
