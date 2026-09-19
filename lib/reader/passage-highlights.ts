/** A paint projection of checked anchors. It never replaces connection identity. */
export interface PassageHighlightRun {
  readonly start: number;
  readonly end: number;
  readonly color: string;
}

/**
 * Overlapping links share one background. A hundred links on one quotation
 * must not stack a hundred translucent overlays until the text turns black.
 * Hit testing keeps the original anchors independently of these paint runs.
 */
export function passageHighlightRuns(
  ranges: readonly PassageHighlightRun[],
): readonly PassageHighlightRun[] {
  const events = ranges
    .flatMap((range) => [
      { offset: range.start, color: range.color, delta: 1 },
      { offset: range.end, color: range.color, delta: -1 },
    ])
    .sort((a, b) => a.offset - b.offset);
  const active = new Map<string, number>();
  const result: PassageHighlightRun[] = [];
  let previous = events[0]?.offset ?? 0;
  for (let index = 0; index < events.length;) {
    const offset = events[index].offset;
    if (offset > previous && active.size) {
      const color = active.size === 1 ? active.keys().next().value! : "#62676c";
      const last = result.at(-1);
      if (last && last.end === previous && last.color === color)
        result[result.length - 1] = { ...last, end: offset };
      else result.push({ start: previous, end: offset, color });
    }
    while (events[index]?.offset === offset) {
      const event = events[index++];
      const count = (active.get(event.color) ?? 0) + event.delta;
      if (count > 0) active.set(event.color, count);
      else active.delete(event.color);
    }
    previous = offset;
  }
  return result;
}
