"use client";

import React, {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./passage.css";
import type { AnchorInput, DocumentRevision } from "../../lib/domain/model";
import { isValidRenderedTextOffsets } from "../../lib/domain/text-offsets";
import {
  assertRendererAnchor,
  createRenderPlan,
  RendererMappingError,
} from "../../lib/reader/render-markdown";
import { DocumentBody } from "./document-virtualizer";
import { sourceRanges } from "../../lib/reader/render-dom";
import { passageHighlightRuns } from "../../lib/reader/passage-highlights";

export interface PassageMark {
  id: string;
  anchor: AnchorInput;
  color: string;
  label?: string;
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

const sourceMapCache = new WeakMap<HTMLElement, readonly number[]>();

function sourceOffsetAt(
  span: HTMLElement,
  renderedLength: number,
  renderedIndex: number,
): number {
  if (span.dataset.sourceMapState === "unmapped")
    throw new RendererMappingError(
      "This rendered Markdown text has no checked source mapping",
    );
  const encoded = span.dataset.sourceMap;
  if (!encoded) {
    const start = parseIntegerAttribute(span, "sourceStart");
    return start + renderedIndex;
  }
  let offsets = sourceMapCache.get(span);
  if (!offsets) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded);
    } catch {
      throw new RendererMappingError("Malformed rendered-to-source map");
    }
    if (
      !Array.isArray(decoded) ||
      !isValidRenderedTextOffsets(
        decoded,
        renderedLength,
        parseIntegerAttribute(span, "sourceEnd") -
          parseIntegerAttribute(span, "sourceStart"),
      )
    )
      throw new RendererMappingError("Invalid rendered-to-source map");
    offsets = decoded;
    sourceMapCache.set(span, offsets);
  }
  const relative = offsets[renderedIndex];
  if (!Number.isInteger(relative))
    throw new RendererMappingError("Rendered endpoint has no source boundary");
  return parseIntegerAttribute(span, "sourceStart") + relative;
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
  const source = sourceOffsetAt(span, renderedLength, renderedIndex);
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
  // A native range can cross a virtual spacer (for example with Select All).
  // Its endpoints are valid individually, but the unseen middle was not
  // actually selected. Never turn that discontinuous range into a quotation.
  for (const gap of root.querySelectorAll<HTMLElement>(
    "[data-source-gap-start]",
  )) {
    if (
      Number(gap.dataset.sourceGapStart) < end &&
      Number(gap.dataset.sourceGapEnd) > start
    )
      throw new RendererMappingError(
        "Selection crosses text that is not displayed",
      );
  }
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
      mark.label === other.label &&
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
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [choices, setChoices] = useState<readonly PassageMark[]>([]);
  const [choiceQuery, setChoiceQuery] = useState("");
  const [choicePage, setChoicePage] = useState(0);
  const choiceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!choices.length) return;
    choiceRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !choiceRef.current?.contains(event.target)
      )
        setChoices([]);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setChoices([]);
        rootRef.current
          ?.closest<HTMLElement>("[data-document-scroll]")
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [choices]);
  useEffect(() => {
    if (!selectionError) return;
    const timeout = window.setTimeout(() => setSelectionError(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [selectionError]);
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
  const highlightRuns = useMemo(
    () =>
      passageHighlightRuns(
        checkedMarks.map((mark) => ({
          start: mark.anchor.start,
          end: mark.anchor.end,
          color: mark.color,
        })),
      ),
    [checkedMarks],
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
      const mapped = new Map<string, Range[]>();
      const rangesFor = (source: { start: number; end: number }) => {
        const key = `${source.start}:${source.end}`;
        let ranges = mapped.get(key);
        if (!ranges) {
          ranges = sourceRanges(root, {
            ...source,
            revisionId: doc.revisionId,
          });
          mapped.set(key, ranges);
        }
        return ranges;
      };
      const register = (
        suffix: string,
        ranges: Range[],
        color: string,
        ink?: string,
      ) => {
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
          // Highlight decorations are progressive enhancement. The color fill
          // remains visible in engines that only implement highlight colors.
          // https://www.w3.org/TR/css-pseudo-4/#highlight-styling
          `::highlight(${name}) { background-color: ${checkedColor}; ${ink && CSS.supports("color", ink) ? `text-decoration: underline 2px ${ink}; text-underline-offset: 3px;` : ""} }`,
        );
      };
      markRanges.current = checkedMarks.map((mark) => {
        const ranges = rangesFor(mark.anchor);
        return { id: mark.id, ranges };
      });
      highlightRuns.forEach((run, index) => {
        const ranges = rangesFor(run);
        register(
          `mark${index}`,
          ranges,
          `color-mix(in srgb, ${run.color} 12%, transparent)`,
          run.color,
        );
      });
      if (currentFocus) {
        const ranges = rangesFor(currentFocus);
        register("focus", ranges, "#d6b36a29");
        if (ranges[0] && navigatedFocus.current !== focusKey) {
          scrollRangeWithinDocument(root, ranges[0]);
          navigatedFocus.current = focusKey;
        }
      }
      style.textContent = rules.join("\n");
    };
    document.head.appendChild(style);
    annotate();
    let annotationFrame = 0;
    const scheduleAnnotation = () => {
      if (annotationFrame) return;
      annotationFrame = requestAnimationFrame(() => {
        annotationFrame = 0;
        annotate();
      });
    };
    const observer = new MutationObserver(scheduleAnnotation);
    observer.observe(root, { childList: true });
    return () => {
      observer.disconnect();
      if (annotationFrame) cancelAnimationFrame(annotationFrame);
      clear();
      style.remove();
    };
  }, [
    checkedMarks,
    highlightRuns,
    currentFocus,
    doc.revisionId,
    focusKey,
    highlightId,
  ]);

  function captureSelection(): void {
    const root = rootRef.current;
    if (!root) return;
    try {
      const anchor = selectionAnchor(root, doc);
      if (!anchor) return;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range) {
        setSelectionError(null);
        onSelectRef.current(anchor, range.getBoundingClientRect());
      }
    } catch (error) {
      // A malformed or virtualized endpoint is rejected instead of being
      // converted to an approximate saved anchor.
      if (!(error instanceof RendererMappingError)) throw error;
      setSelectionError(
        root.dataset.selectionLimit === "true"
          ? "长选区已到本次上限，可分段选择。"
          : "这次选区不能精确对应原文，请在连续显示的正文中分段选择。",
      );
    }
  }

  function activateMark(event: React.MouseEvent<HTMLDivElement>): void {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    if ((event.target as Element).closest("a,button,input,textarea")) return;
    const geometry = new Map<Range, DOMRect[]>();
    const hitRange = (range: Range) => {
      let rects = geometry.get(range);
      if (!rects) {
        rects = Array.from(range.getClientRects());
        geometry.set(range, rects);
      }
      return rects.some(
        (rect) =>
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      );
    };
    const hits = markRanges.current.filter((mark) =>
      mark.ranges.some((range) => hitRange(range)),
    );
    const unique = [...new Set(hits.map((mark) => mark.id))];
    if (unique.length && onActivateMarkRef.current) {
      event.preventDefault();
      if (unique.length === 1) onActivateMarkRef.current(unique[0]);
      else {
        setChoiceQuery("");
        setChoicePage(0);
        setChoices(
          unique.flatMap((id) => {
            const mark = checkedMarks.find((item) => item.id === id);
            return mark ? [mark] : [];
          }),
        );
      }
    }
  }

  const matchingChoices = choices.filter((mark) =>
    (mark.label ?? mark.anchor.quote)
      .toLocaleLowerCase()
      .includes(choiceQuery.toLocaleLowerCase()),
  );

  return (
    <div
      key={doc.revisionId}
      ref={rootRef}
      className="document-content"
      data-revision-id={doc.revisionId}
      data-hit-role="text"
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
      {selectionError &&
        createPortal(
          <p className="passage-selection-note" role="status">
            {selectionError}
          </p>,
          document.body,
        )}
      {choices.length > 0 &&
        createPortal(
          <div
            ref={choiceRef}
            className="passage-relation-choices"
            role="dialog"
            aria-label="选择这段文字的连接"
            data-hit-role="control"
          >
            <header>
              <span>这段文字的 {choices.length} 条连接</span>
              <button aria-label="收起连接选择" onClick={() => setChoices([])}>
                ×
              </button>
            </header>
            <input
              aria-label="筛选这段文字的连接"
              placeholder="找一个连接…"
              value={choiceQuery}
              onChange={(event) => {
                setChoiceQuery(event.target.value);
                setChoicePage(0);
              }}
            />
            <div className="passage-choice-items">
              {matchingChoices
                .slice(choicePage * 8, choicePage * 8 + 8)
                .map((mark) => (
                  <button
                    key={mark.id}
                    onClick={() => {
                      setChoices([]);
                      onActivateMarkRef.current?.(mark.id);
                    }}
                  >
                    {mark.label ?? mark.anchor.quote}
                  </button>
                ))}
              {!matchingChoices.length && <p>没有匹配的连接。</p>}
            </div>
            {matchingChoices.length > 8 && (
              <footer>
                <button
                  disabled={choicePage === 0}
                  onClick={() => setChoicePage((page) => page - 1)}
                >
                  上一组
                </button>
                <span>
                  {choicePage * 8 + 1}–
                  {Math.min(matchingChoices.length, choicePage * 8 + 8)} /{" "}
                  {matchingChoices.length}
                </span>
                <button
                  disabled={(choicePage + 1) * 8 >= matchingChoices.length}
                  onClick={() => setChoicePage((page) => page + 1)}
                >
                  下一组
                </button>
              </footer>
            )}
          </div>,
          document.body,
        )}
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
