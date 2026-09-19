import { isValidRenderedTextOffsets } from "../domain/text-offsets";

export interface SourceSelectionRange {
  revisionId: string;
  start: number;
  end: number;
}

const sourceMapCache = new WeakMap<HTMLElement, readonly number[]>();

function checkedSourceMap(
  span: HTMLElement,
  renderedLength: number,
  sourceLength: number,
): readonly number[] | null {
  const encoded = span.dataset.sourceMap;
  if (!encoded) return null;
  const cached = sourceMapCache.get(span);
  if (cached) return cached;
  let raw: unknown;
  try {
    raw = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (
    !Array.isArray(raw) ||
    !isValidRenderedTextOffsets(raw, renderedLength, sourceLength)
  )
    return null;
  sourceMapCache.set(span, raw);
  return raw;
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
    const encodedMap = span.dataset.sourceMap;
    const map = encodedMap ? checkedSourceMap(span, length, end - start) : null;
    if (encodedMap && !map) continue;
    if (!encodedMap && end - start !== length) continue;
    const boundary = (offset: number) => {
      if (!map) return Math.max(0, Math.min(length, offset));
      let low = 0;
      let high = map.length - 1;
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
