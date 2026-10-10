import { EventSeries, EventSeriesSegment } from './event-series.model';
import { isLogicalSlot } from './occurrence-key';

/** The next offset is the exclusive upper bound, including reserved gap slots. */
export const segmentOwnsSlot = (
  series: EventSeries,
  index: number,
  slot: number,
): boolean =>
  isLogicalSlot(slot) &&
  slot >= (series.segments[index].logicalSlotOffset ?? 0) &&
  (index + 1 === series.segments.length ||
    slot < series.segments[index + 1].logicalSlotOffset!);

export const segmentForSlot = (
  series: EventSeries,
  slot: number,
): EventSeriesSegment | undefined =>
  series.segments.find((_segment, index) => segmentOwnsSlot(series, index, slot));
