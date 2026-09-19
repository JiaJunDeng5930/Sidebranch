import type { ConnectionRelation } from "../domain/model";
import { readerPalette } from "./semantic-palette";

export type PassageHighlightRelation = ConnectionRelation | "overlap";

export interface PassageHighlightRange {
  readonly start: number;
  readonly end: number;
  readonly relation: ConnectionRelation;
}

/** A paint projection of checked anchors. It never replaces connection identity. */
export interface PassageHighlightRun {
  readonly start: number;
  readonly end: number;
  readonly relation: PassageHighlightRelation;
}

/**
 * Overlapping links share one background. A hundred links on one quotation
 * must not stack a hundred translucent overlays until the text turns black.
 * Hit testing keeps the original anchors independently of these paint runs.
 */
export function passageHighlightRuns(
  ranges: readonly PassageHighlightRange[],
): readonly PassageHighlightRun[] {
  const events = ranges
    .flatMap((range) => [
      { offset: range.start, relation: range.relation, delta: 1 },
      { offset: range.end, relation: range.relation, delta: -1 },
    ])
    .sort((a, b) => a.offset - b.offset);
  const active = new Map<ConnectionRelation, number>();
  const result: PassageHighlightRun[] = [];
  let previous = events[0]?.offset ?? 0;
  for (let index = 0; index < events.length;) {
    const offset = events[index].offset;
    if (offset > previous && active.size) {
      const relation =
        active.size === 1
          ? active.keys().next().value!
          : ("overlap" as const);
      const last = result.at(-1);
      if (last && last.end === previous && last.relation === relation)
        result[result.length - 1] = { ...last, end: offset };
      else result.push({ start: previous, end: offset, relation });
    }
    while (events[index]?.offset === offset) {
      const event = events[index++];
      const count = (active.get(event.relation) ?? 0) + event.delta;
      if (count > 0) active.set(event.relation, count);
      else active.delete(event.relation);
    }
    previous = offset;
  }
  return result;
}

export const passageOverlapColor = readerPalette.overlap;
