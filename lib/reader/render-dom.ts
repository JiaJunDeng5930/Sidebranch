import { isValidRenderedTextOffsets } from "../domain/text-offsets";

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
    let map: number[];
    if (span.dataset.sourceMap) {
      let raw: unknown;
      try {
        raw = JSON.parse(span.dataset.sourceMap);
      } catch {
        continue;
      }
      if (
        !Array.isArray(raw) ||
        !isValidRenderedTextOffsets(raw, length, end - start)
      )
        continue;
      map = raw;
    } else {
      if (end - start !== length) continue;
      map = Array.from({ length: length + 1 }, (_, index) => index);
    }
    const boundary = (offset: number) => {
      let low = 0,
        high = map.length - 1;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (map[middle] < offset) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    const from = boundary(Math.max(0, source.start - start));
    const to = boundary(Math.min(end, source.end) - start);
    if (from >= to) continue;
    const point = (offset: number): { node: Text; offset: number } | null => {
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!(node instanceof Text)) continue;
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
