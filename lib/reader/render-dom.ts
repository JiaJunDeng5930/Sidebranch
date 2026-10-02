import type { ReaderSelector } from "../domain/model";
import {
  validateReaderSelector,
  type ReaderDocumentModel,
  type ReaderModelNode,
} from "./document-model";

const models = new WeakMap<Element, ReaderDocumentModel>();
export function bindReaderModel(
  root: Element,
  model: ReaderDocumentModel,
): void {
  models.set(root, model);
}
export function unbindReaderModel(root: Element): void {
  models.delete(root);
}
export function readerModelForRoot(root: Element): ReaderDocumentModel {
  let current: Element | null = root;
  while (current) {
    const model = models.get(current);
    if (model) return model;
    current = current.parentElement;
  }
  throw new Error("Reader body has no registered immutable model");
}
export function checkedReaderElement(
  element: Element,
  node: ReaderModelNode,
): void {
  if (
    element.getAttribute("data-reader-node-kind") !== node.kind ||
    (node.kind === "text" && element.textContent !== node.value) ||
    (node.kind === "atom" && !["BR", "HR", "INPUT"].includes(element.tagName))
  )
    throw new Error(`Reader DOM differs from immutable model: ${node.id}`);
}
function textPoint(
  element: Element,
  offset: number,
): { node: Node; offset: number } {
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent!.length;
    if (offset <= length) return { node, offset };
    offset -= length;
  }
  throw new Error("Reader text offset has no DOM boundary");
}
export function readerRanges(
  root: Element,
  reader: ReaderSelector,
  model?: ReaderDocumentModel,
): Range[] {
  const authority = model ?? readerModelForRoot(root);
  const checked = validateReaderSelector(authority, reader);
  const entries = new Map(
    Array.from(root.querySelectorAll<Element>("[data-reader-node-id]")).map(
      (element) => [element.getAttribute("data-reader-node-id")!, element],
    ),
  );
  return checked.fragments.flatMap((fragment) => {
    const element = entries.get(fragment.nodeId);
    const node = authority.getNode(fragment.nodeId);
    if (!element) {
      if (
        root.querySelector(`[data-document-chunk-index="${node.chunkIndex}"]`)
      )
        throw new Error(
          `Mounted reader node is missing its DOM binding: ${node.id}`,
        );
      return [];
    }
    checkedReaderElement(element, node);
    const range = element.ownerDocument.createRange();
    if (node.kind === "atom") range.selectNode(element);
    else {
      const start = textPoint(element, fragment.start),
        end = textPoint(element, fragment.end);
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    }
    return [range];
  });
}
export interface SourceSelectionRange {
  revisionId: string;
  start: number;
  end: number;
  reader?: ReaderSelector;
}
export function sourceRanges(
  root: Element,
  source: SourceSelectionRange,
  model?: ReaderDocumentModel,
): Range[] {
  const revisionRoot =
    root.getAttribute("data-revision-id") === source.revisionId
      ? root
      : (Array.from(root.querySelectorAll<Element>("[data-revision-id]")).find(
          (element) =>
            element.getAttribute("data-revision-id") === source.revisionId,
        ) ?? root.closest(`[data-revision-id="${source.revisionId}"]`));
  if (!revisionRoot) return [];
  if (source.reader) return readerRanges(revisionRoot, source.reader, model);
  const authority = model ?? readerModelForRoot(revisionRoot);
  const ranges: Range[] = [];
  for (const element of revisionRoot.querySelectorAll<Element>(
    "[data-reader-node-id]",
  )) {
    const node = authority.getNode(
      element.getAttribute("data-reader-node-id")!,
    );
    if (node.origin.start >= source.end || node.origin.end <= source.start)
      continue;
    checkedReaderElement(element, node);
    // Transformed and generated nodes have atomic provenance; only direct text
    // has a character-for-character projection into the canonical source.
    const start =
      node.origin.kind === "direct"
        ? Math.max(0, source.start - node.origin.start)
        : 0;
    const end =
      node.origin.kind === "direct"
        ? Math.min(node.length, source.end - node.origin.start)
        : node.length;
    ranges.push(
      ...readerRanges(
        revisionRoot,
        {
          version: "reader-v1",
          fragments: [{ nodeId: node.id, start, end }],
          preview: "",
        },
        authority,
      ),
    );
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
