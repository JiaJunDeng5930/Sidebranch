"use client";

import React, { memo, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { AnchorInput, DocumentRevision } from "../../lib/domain/model";
import { isValidRenderedTextOffsets } from "../../lib/domain/text-offsets";
import {
  assertRendererAnchor,
  createRenderPlan,
  RendererMappingError,
} from "../../lib/reader/render-markdown";
import { DocumentBody } from "./document-virtualizer";
import { sourceRanges } from "../../lib/reader/render-dom";

export interface PassageMark {
  id: string;
  anchor: AnchorInput;
  color: string;
}

export interface PassageProps {
  doc: DocumentRevision;
  onSelect: (anchor: AnchorInput, rect: DOMRect) => void;
  focus?: AnchorInput | null;
  marks?: readonly PassageMark[];
  onActivateMark?: (id: string) => void;
  onGeometryChange?: () => void;
}

interface SpanPoint {
  span: HTMLElement;
  source: number;
  renderedIndex: number;
  renderedLength: number;
  nodeStart: number;
  nodeEnd: number;
}

function elementForNode(node: Node): HTMLElement | null {
  if (node.nodeType === Node.ELEMENT_NODE) return node as HTMLElement;
  return node.parentElement;
}

function closestSourceSpan(node: Node): HTMLElement | null {
  return (
    elementForNode(node)?.closest<HTMLElement>(
      "span[data-source-start][data-source-end]",
    ) ?? null
  );
}

function firstSourceSpan(node: Node, fromEnd: boolean): HTMLElement | null {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const spans = (node as Element).querySelectorAll<HTMLElement>(
      "span[data-source-start][data-source-end]",
    );
    return spans.length ? spans[fromEnd ? spans.length - 1 : 0] : null;
  }
  return closestSourceSpan(node);
}

function parseIntegerAttribute(span: HTMLElement, name: string): number {
  const value = Number(span.dataset[name]);
  if (!Number.isInteger(value) || value < 0)
    throw new RendererMappingError(`Missing integer ${name} on source span`);
  return value;
}

function sourceMap(span: HTMLElement, renderedLength: number): number[] {
  if (span.dataset.sourceMapState === "unmapped")
    throw new RendererMappingError(
      "This rendered Markdown text has no checked source mapping",
    );
  const encoded = span.dataset.sourceMap;
  if (!encoded) {
    const start = parseIntegerAttribute(span, "sourceStart");
    return Array.from(
      { length: renderedLength + 1 },
      (_, index) => index + start,
    );
  }
  let offsets: unknown;
  try {
    offsets = JSON.parse(encoded);
  } catch {
    throw new RendererMappingError("Malformed rendered-to-source map");
  }
  if (
    !Array.isArray(offsets) ||
    !isValidRenderedTextOffsets(
      offsets,
      renderedLength,
      parseIntegerAttribute(span, "sourceEnd") -
        parseIntegerAttribute(span, "sourceStart"),
    )
  )
    throw new RendererMappingError("Invalid rendered-to-source map");
  return offsets as number[];
}

function pointInSpan(span: HTMLElement, node: Node, offset: number): SpanPoint {
  const sourceStart = parseIntegerAttribute(span, "sourceStart");
  const sourceEnd = parseIntegerAttribute(span, "sourceEnd");
  const renderedLength = Number(span.dataset.sourceRenderedLength);
  if (!Number.isInteger(renderedLength) || renderedLength < 0)
    throw new RendererMappingError(
      "Missing rendered text length on source span",
    );
  const prefix = document.createRange();
  prefix.selectNodeContents(span);
  try {
    prefix.setEnd(node, Math.max(0, offset));
  } catch {
    throw new RendererMappingError(
      "Selection endpoint is outside its source span",
    );
  }
  const renderedIndex = prefix.toString().length;
  if (renderedIndex > renderedLength)
    throw new RendererMappingError("Rendered endpoint exceeds source span");
  const offsets = sourceMap(span, renderedLength);
  const relative = offsets[renderedIndex];
  if (!Number.isInteger(relative))
    throw new RendererMappingError("Rendered endpoint has no source boundary");
  const source = span.dataset.sourceMap ? sourceStart + relative : relative;
  if (source < sourceStart || source > sourceEnd)
    throw new RendererMappingError("Source endpoint exceeds source span");
  return {
    span,
    source,
    renderedIndex,
    renderedLength,
    nodeStart: Number.isInteger(Number(span.dataset.sourceNodeStart))
      ? Number(span.dataset.sourceNodeStart)
      : sourceStart,
    nodeEnd: Number.isInteger(Number(span.dataset.sourceNodeEnd))
      ? Number(span.dataset.sourceNodeEnd)
      : sourceEnd,
  };
}

function selectionPoint(
  node: Node,
  offset: number,
  end: boolean,
): SpanPoint | null {
  const direct = closestSourceSpan(node);
  if (direct) return pointInSpan(direct, node, offset);
  const element = elementForNode(node);
  if (!element) return null;
  const children = Array.from(element.childNodes);
  const child =
    children[
      end
        ? Math.max(0, Math.min(children.length - 1, offset - 1))
        : Math.max(0, Math.min(children.length - 1, offset))
    ];
  const span = child
    ? firstSourceSpan(child, end)
    : firstSourceSpan(element, end);
  if (!span) return null;
  const boundary = end ? span.childNodes.length : 0;
  return pointInSpan(span, span, boundary);
}

function sourceSpanBoundary(point: SpanPoint): number {
  // A visible selection maps to the exact text token.  Any Markdown syntax
  // between two tokens remains in the source quote when the range crosses
  // those tokens; a single token must not silently absorb a heading marker or
  // a link destination.
  return point.source;
}

/**
 * Return the exact source anchor represented by the browser's native range.
 * Markdown punctuation is taken from `doc.content`, while the browser's
 * rendered string remains available through `selectionPreview`.
 */
export function selectionAnchor(
  root: HTMLElement,
  doc: DocumentRevision,
): AnchorInput | null {
  const revision = root.dataset.revisionId;
  if (revision !== doc.revisionId)
    throw new RendererMappingError(
      "Selection root does not contain this revision",
    );
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const startPoint = selectionPoint(
    range.startContainer,
    range.startOffset,
    false,
  );
  const endPoint = selectionPoint(range.endContainer, range.endOffset, true);
  if (!startPoint || !endPoint)
    throw new RendererMappingError("Selection endpoint is outside mapped text");
  let start = sourceSpanBoundary(startPoint);
  let end = sourceSpanBoundary(endPoint);
  if (start > end) [start, end] = [end, start];
  if (start < 0 || start >= end || end > doc.content.length)
    throw new RendererMappingError(
      "Selection source range is outside revision",
    );
  const anchor: AnchorInput = {
    revisionId: doc.revisionId,
    start,
    end,
    quote: doc.content.slice(start, end),
  };
  assertRendererAnchor(doc.content, anchor, doc.revisionId);
  return anchor;
}

/** Rendered quotation for UI preview; never use this as the saved anchor quote. */
export function selectionPreview(root: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? range.toString() : "";
}

function findOwnerScroller(root: HTMLElement): HTMLElement | null {
  const explicit = root.closest<HTMLElement>("[data-document-scroll]");
  if (explicit) return explicit;
  let parent = root.parentElement;
  while (parent && parent !== document.body) {
    if (parent.classList.contains("reading-area")) {
      parent.dataset.documentScroll = "";
      return parent;
    }
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) {
      parent.dataset.documentScroll = "";
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function scrollRangeWithinDocument(root: HTMLElement, range: Range): void {
  const scroller = findOwnerScroller(root);
  if (!scroller) return;
  const rect = range.getBoundingClientRect(),
    container = scroller.getBoundingClientRect();
  const scale = container.height / scroller.offsetHeight || 1;
  const delta =
    (rect.top - container.top) / scale -
    (scroller.clientHeight - rect.height / scale) / 2;
  scroller.scrollTop = Math.max(
    0,
    Math.min(
      scroller.scrollHeight - scroller.clientHeight,
      scroller.scrollTop + delta,
    ),
  );
}

function validateMarks(
  content: string,
  revisionId: string,
  marks: readonly PassageMark[] | undefined,
): readonly PassageMark[] {
  if (!marks?.length) return [];
  // A parent may pass the connection catalogue to both panes.  Anchors from a
  // different immutable revision have no legal DOM mapping in this pane and
  // are therefore ignored rather than projected onto a similarly shaped text.
  const localMarks = marks.filter(
    (mark) => mark.anchor.revisionId === revisionId,
  );
  for (const mark of localMarks) {
    if (!mark.id) throw new RendererMappingError("A mark must have an id");
    assertRendererAnchor(content, mark.anchor, revisionId);
  }
  return localMarks;
}

function sameAnchor(
  a: AnchorInput | null | undefined,
  b: AnchorInput | null | undefined,
): boolean {
  return (
    Boolean(a) === Boolean(b) &&
    (!a ||
      !b ||
      (a.revisionId === b.revisionId &&
        a.start === b.start &&
        a.end === b.end &&
        a.quote === b.quote))
  );
}

function sameMarks(
  a: readonly PassageMark[] | undefined,
  b: readonly PassageMark[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((mark, index) => {
    const other = b[index];
    return (
      mark.id === other.id &&
      mark.color === other.color &&
      sameAnchor(mark.anchor, other.anchor)
    );
  });
}

function PassageImpl({
  doc,
  onSelect,
  focus,
  marks,
  onActivateMark,
  onGeometryChange,
}: PassageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  const onActivateMarkRef = useRef(onActivateMark);
  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
    onActivateMarkRef.current = onActivateMark;
  }, [onActivateMark, onSelect]);
  const currentFocus = focus?.revisionId === doc.revisionId ? focus : null;
  const plan = useMemo(
    () => createRenderPlan(doc.content, doc.format),
    [doc.content, doc.format],
  );
  const checkedMarks = useMemo(
    () => validateMarks(doc.content, doc.revisionId, marks),
    [doc.content, doc.revisionId, marks],
  );
  if (currentFocus)
    assertRendererAnchor(doc.content, currentFocus, doc.revisionId);

  const highlightId = `xanadu-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const markRanges = useRef<Array<{ id: string; ranges: Range[] }>>([]);
  const focusKey = currentFocus
    ? `${doc.revisionId}:${currentFocus.start}:${currentFocus.end}`
    : null;
  const navigatedFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!focusKey) navigatedFocus.current = null;
    const style = document.createElement("style");
    const names: string[] = [];
    const clear = () => {
      for (const name of names) CSS.highlights?.delete(name);
      names.length = 0;
    };
    const annotate = () => {
      clear();
      const rules: string[] = [];
      const register = (suffix: string, ranges: Range[], color: string) => {
        if (
          !ranges.length ||
          typeof Highlight === "undefined" ||
          !CSS.highlights
        )
          return;
        const name = `${highlightId}-${suffix}`;
        CSS.highlights.set(name, new Highlight(...ranges));
        names.push(name);
        const checkedColor = CSS.supports("background-color", color)
          ? color
          : "#bd9c6666";
        rules.push(
          `::highlight(${name}) { background-color: ${checkedColor}; }`,
        );
      };
      markRanges.current = checkedMarks.map((mark, index) => {
        const ranges = sourceRanges(root, mark.anchor);
        register(`mark${index}`, ranges, `color-mix(in srgb, ${mark.color} 35%, transparent)`);
        return { id: mark.id, ranges };
      });
      if (currentFocus) {
        const ranges = sourceRanges(root, currentFocus);
        register("focus", ranges, "#d49e6955");
        if (ranges[0] && navigatedFocus.current !== focusKey) {
          scrollRangeWithinDocument(root, ranges[0]);
          navigatedFocus.current = focusKey;
        }
      }
      style.textContent = rules.join("\n");
    };
    document.head.appendChild(style);
    annotate();
    const observer = new MutationObserver(annotate);
    observer.observe(root, { childList: true });
    return () => {
      observer.disconnect();
      clear();
      style.remove();
    };
  }, [checkedMarks, currentFocus, doc.revisionId, focusKey, highlightId]);

  function captureSelection(): void {
    const root = rootRef.current;
    if (!root) return;
    try {
      const anchor = selectionAnchor(root, doc);
      if (!anchor) return;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range) onSelectRef.current(anchor, range.getBoundingClientRect());
    } catch (error) {
      // A malformed or virtualized endpoint is rejected instead of being
      // converted to an approximate saved anchor.
      if (!(error instanceof RendererMappingError)) throw error;
    }
  }

  function activateMark(event: React.MouseEvent<HTMLDivElement>): void {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const hit = markRanges.current.find((mark) =>
      mark.ranges.some((range) =>
        Array.from(range.getClientRects()).some(
          (rect) =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        ),
      ),
    );
    if (hit && onActivateMarkRef.current) {
      event.preventDefault();
      onActivateMarkRef.current(hit.id);
    }
  }

  return (
    <div
      key={doc.revisionId}
      ref={rootRef}
      className="document-content"
      data-revision-id={doc.revisionId}
      onPointerUp={captureSelection}
      onKeyUp={(event) => {
        if (
          event.key === "Shift" ||
          event.shiftKey ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown"
        )
          captureSelection();
      }}
      onClick={activateMark}
    >
      <DocumentBody
        doc={doc}
        plan={plan}
        rootRef={rootRef}
        focus={currentFocus}
        onGeometryChange={onGeometryChange}
      />
    </div>
  );
}

/** Native-selectable renderer for one immutable document revision. */
export const Passage = memo(
  PassageImpl,
  (previous, next) =>
    previous.doc === next.doc &&
    sameAnchor(previous.focus, next.focus) &&
    sameMarks(previous.marks, next.marks) &&
    previous.onSelect === next.onSelect &&
    previous.onActivateMark === next.onActivateMark &&
    previous.onGeometryChange === next.onGeometryChange,
);
