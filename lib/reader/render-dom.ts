import { checkedEndpointMaps } from "../domain/text-offsets";

export interface SourceSelectionRange {
  revisionId: string;
  start: number;
  end: number;
}

/** The same checked projection supplies highlights, hit testing and connection geometry. */
export function sourceRanges(
  root: HTMLElement,
  source: SourceSelectionRange,
): Range[] {
  const revisionRoot =
    root.dataset.revisionId === source.revisionId
      ? root
      : Array.from(
          root.querySelectorAll<HTMLElement>("[data-revision-id]"),
        ).find((node) => node.dataset.revisionId === source.revisionId);
  if (!revisionRoot) return [];
  const ranges: Range[] = [];
  for (const span of revisionRoot.querySelectorAll<HTMLElement>(
    "span[data-source-start][data-source-end]",
  )) {
    const start = Number(span.dataset.sourceStart),
      end = Number(span.dataset.sourceEnd);
    if (
      start >= source.end ||
      end <= source.start ||
      span.dataset.sourceMapState === "unmapped"
    )
      continue;
    const length = span.textContent?.length ?? 0;
    const encodedMap = span.dataset.sourceStartMap || span.dataset.sourceEndMap;
    const maps = encodedMap ? checkedEndpointMaps(span.dataset.sourceStartMap, span.dataset.sourceEndMap, length, end - start) : null;
    if (encodedMap && !maps) continue;
    if (!encodedMap && end - start !== length) continue;
    const lowerBound = (map: readonly number[], offset: number, strict = false) => {
      let low = 0, high = map.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (map[middle] < offset || (strict && map[middle] === offset)) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    let from = maps ? Math.min(length, lowerBound(maps.ends, source.start - start, true) - 1) : Math.max(0, source.start - start);
    if (maps) while (from > 0 && maps.starts[from - 1] === maps.starts[from]) from--;
    const to = maps ? Math.min(length, lowerBound(maps.starts, source.end - start)) : Math.min(length, source.end - start);
    if (from >= to) continue;
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      if (textNode instanceof Text) textNodes.push(textNode);
    }
    const point = (offset: number): { node: Text; offset: number } | null => {
      for (const node of textNodes) {
        if (offset <= node.length) return { node, offset };
        offset -= node.length;
      }
      return null;
    };
    const a = point(from),
      b = point(to);
    if (!a || !b) continue;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    ranges.push(range);
  }
  return ranges;
}

/** Layout coordinates, intentionally unaffected by a CSS3D camera transform. */
export function layoutTop(element: HTMLElement): number {
  let top = 0,
    current: HTMLElement | null = element;
  while (current) {
    top += current.offsetTop;
    current =
      current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
  }
  return top;
}
