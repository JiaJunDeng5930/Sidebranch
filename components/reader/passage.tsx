"use client";

import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./passage.css";
import type {
  AnchorInput,
  ConnectionRelation,
  DocumentRevision,
} from "../../lib/domain/model";
import type {
  ConnectionEndpoint,
  DocumentRenderContext,
  PassageHandle,
  ResolvedAnchor,
  SurfaceInstanceId,
} from "../../lib/reader/spatial-contract";
import { isValidRenderedTextOffsets } from "../../lib/domain/text-offsets";
import {
  assertRendererAnchor,
  createRenderPlan,
  RendererMappingError,
  type RenderPlan,
} from "../../lib/reader/render-markdown";
import { DocumentBody } from "./document-virtualizer";
import { sourceRanges } from "../../lib/reader/render-dom";
import { passageHighlightRuns } from "../../lib/reader/passage-highlights";
import {
  readerPalette,
  readerPaletteStyle,
  relationAppearance,
} from "../../lib/reader/semantic-palette";

export interface PassageMark {
  id: string;
  anchor: AnchorInput;
  endpoint?: ConnectionEndpoint;
  relation: ConnectionRelation;
  label?: string;
}

export interface PassageProps {
  doc: DocumentRevision;
  surfaceId?: SurfaceInstanceId;
  context?: DocumentRenderContext;
  onSelect: (anchor: AnchorInput, rect: DOMRect) => void;
  focus?: AnchorInput | null;
  marks?: readonly PassageMark[];
  onActivateMark?: (id: string, endpoint?: ConnectionEndpoint) => void;
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

function mergeMissingSpans(
  spans: readonly { start: number; end: number }[],
): readonly { start: number; end: number }[] {
  const ordered = spans
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: { start: number; end: number }[] = [];
  for (const span of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && span.start <= previous.end)
      previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

function sourceIntersection(
  start: number,
  end: number,
  anchor: AnchorInput,
): { start: number; end: number } | null {
  const from = Math.max(start, anchor.start);
  const to = Math.min(end, anchor.end);
  return to > from ? { start: from, end: to } : null;
}

function hasCheckedSourceMapping(span: HTMLElement): boolean {
  if (span.dataset.sourceMapState === "unmapped") return false;
  const start = Number(span.dataset.sourceStart);
  const end = Number(span.dataset.sourceEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start)
    return false;
  const renderedLength = span.textContent?.length ?? 0;
  const encoded = span.dataset.sourceMap;
  if (!encoded) return end - start === renderedLength;
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch {
    return false;
  }
  return (
    Array.isArray(decoded) &&
    isValidRenderedTextOffsets(decoded, renderedLength, end - start)
  );
}

/** Resolve DOM ranges and coverage from the same source projection as marks. */
function resolveAnchorAtRoot(
  root: HTMLElement,
  plan: RenderPlan,
  anchor: AnchorInput,
  revisionId: string,
): ResolvedAnchor {
  if (anchor.revisionId !== revisionId)
    return { ranges: [], coverage: "unmapped", missing: [] };
  const ranges = sourceRanges(root, {
    revisionId,
    start: anchor.start,
    end: anchor.end,
  });
  const missing: { start: number; end: number }[] = [];
  let unmapped = false;
  for (const gap of root.querySelectorAll<HTMLElement>(
    "[data-source-gap-start][data-source-gap-end]",
  )) {
    const start = Number(gap.dataset.sourceGapStart);
    const end = Number(gap.dataset.sourceGapEnd);
    const intersection = sourceIntersection(start, end, anchor);
    if (intersection) missing.push(intersection);
  }
  for (const span of root.querySelectorAll<HTMLElement>(
    "span[data-source-start][data-source-end]",
  )) {
    const start = Number(span.dataset.sourceStart);
    const end = Number(span.dataset.sourceEnd);
    const intersection = sourceIntersection(start, end, anchor);
    if (!intersection) continue;
    if (!hasCheckedSourceMapping(span)) {
      missing.push(intersection);
      unmapped = true;
    }
  }
  // Render plans contain all source chunks. A source gap is therefore the
  // authoritative indication of an unmounted chunk; a syntax-only anchor can
  // legitimately have no visible Range and is still complete.
  const normalized = mergeMissingSpans(missing);
  const coverage = unmapped
    ? "unmapped"
    : normalized.length
      ? ranges.length
        ? "partial"
        : "unmounted"
      : ranges.length || plan.sourceLength >= anchor.end
        ? "complete"
        : "unmapped";
  return { ranges, coverage, missing: normalized };
}

export function firstVisibleSourceOffset(
  root: HTMLElement,
  revisionId: string,
): number | null {
  const scroller =
    root.closest<HTMLElement>("[data-document-scroll]") ??
    root.closest<HTMLElement>(".reading-area");
  const viewport =
    scroller?.getBoundingClientRect() ?? root.getBoundingClientRect();
  let first: number | null = null;
  for (const span of root.querySelectorAll<HTMLElement>(
    "span[data-source-start][data-source-end]",
  )) {
    if (span.dataset.sourceMapState === "unmapped") continue;
    const start = Number(span.dataset.sourceStart);
    const end = Number(span.dataset.sourceEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    const ranges = sourceRanges(root, { revisionId, start, end });
    let firstMapped = start;
    try {
      firstMapped = sourceOffsetAt(span, span.textContent?.length ?? 0, 0);
    } catch {
      continue;
    }
    if (
      ranges.some((range) =>
        Array.from(range.getClientRects()).some(
          (rect) => rect.bottom >= viewport.top && rect.top <= viewport.bottom,
        ),
      )
    )
      first = first === null ? firstMapped : Math.min(first, firstMapped);
  }
  return first;
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
      mark.endpoint === other.endpoint &&
      mark.relation === other.relation &&
      mark.label === other.label &&
      sameAnchor(mark.anchor, other.anchor)
    );
  });
}

function PassageImpl({
  doc,
  surfaceId,
  context,
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
          relation: mark.relation,
        })),
      ),
    [checkedMarks],
  );
  if (currentFocus)
    assertRendererAnchor(doc.content, currentFocus, doc.revisionId);

  const highlightId = `xanadu-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const markRanges = useRef<
    Array<{ id: string; endpoint?: ConnectionEndpoint; ranges: Range[] }>
  >([]);
  const geometryChanged = useCallback(() => {
    onGeometryChange?.();
    context?.onGeometryChange();
  }, [context, onGeometryChange]);

  useLayoutEffect(() => {
    context?.registerAnchors(checkedMarks.map((mark) => mark.anchor));
    return () => context?.registerAnchors([]);
  }, [context, checkedMarks]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!context || !root) return;
    const handle: PassageHandle = {
      resolveAnchor: (anchor) =>
        resolveAnchorAtRoot(root, plan, anchor, doc.revisionId),
      firstVisibleSourceOffset: () =>
        firstVisibleSourceOffset(root, doc.revisionId),
    };
    context.registerPassage(handle);
    return () => context.registerPassage(null);
  }, [context, doc.revisionId, plan]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
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
          : readerPalette.overlap;
        rules.push(
          // Highlight decorations are progressive enhancement. The color fill
          // remains visible in engines that only implement highlight colors.
          // https://www.w3.org/TR/css-pseudo-4/#highlight-styling
          `::highlight(${name}) { background-color: ${checkedColor}; ${ink && CSS.supports("color", ink) ? `text-decoration: underline 2px ${ink}; text-underline-offset: 3px;` : ""} }`,
        );
      };
      markRanges.current = checkedMarks.map((mark) => {
        const ranges = rangesFor(mark.anchor);
        return { id: mark.id, endpoint: mark.endpoint, ranges };
      });
      highlightRuns.forEach((run, index) => {
        const ranges = rangesFor(run);
        const appearance =
          run.relation === "overlap" ? null : relationAppearance(run.relation);
        const signal = appearance?.signal ?? readerPalette.overlap;
        const ink = appearance?.ink;
        register(
          `mark${index}`,
          ranges,
          `color-mix(in srgb, ${signal} ${readerPalette.state.signal.range * 100}%, transparent)`,
          ink,
        );
      });
      if (currentFocus) {
        const ranges = rangesFor(currentFocus);
        register(
          "focus",
          ranges,
          `color-mix(in srgb, ${readerPalette.focus.paper} ${readerPalette.state.focus * 100}%, transparent)`,
          readerPalette.focus.paper,
        );
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
  }, [checkedMarks, highlightRuns, currentFocus, doc.revisionId, highlightId]);

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
    const hits = context
      ? checkedMarks.filter((mark) =>
          context.hitTestAnchor(mark.anchor, {
            x: event.clientX,
            y: event.clientY,
          }),
        )
      : markRanges.current.filter((mark) => mark.ranges.some(hitRange));
    const unique = [
      ...new Set(hits.map((mark) => `${mark.id}:${mark.endpoint ?? ""}`)),
    ];
    if (unique.length && onActivateMarkRef.current) {
      event.preventDefault();
      event.stopPropagation();
      const markFor = (key: string) => {
        const separator = key.lastIndexOf(":");
        const id = separator < 0 ? key : key.slice(0, separator);
        const endpoint = separator < 0 ? undefined : key.slice(separator + 1);
        return checkedMarks.find(
          (mark) =>
            mark.id === id && (mark.endpoint ?? "") === (endpoint ?? ""),
        );
      };
      if (unique.length === 1) {
        const mark = markFor(unique[0]);
        if (mark) onActivateMarkRef.current(mark.id, mark.endpoint);
      } else {
        setChoiceQuery("");
        setChoicePage(0);
        setChoices(
          unique.flatMap((key) => (markFor(key) ? [markFor(key)!] : [])),
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
      data-surface-id={surfaceId}
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
        onGeometryChange={geometryChanged}
      />
      {selectionError &&
        createPortal(
          <p
            className="reader-palette passage-selection-note"
            style={readerPaletteStyle}
            role="status"
          >
            {selectionError}
          </p>,
          document.body,
        )}
      {choices.length > 0 &&
        createPortal(
          <div
            ref={choiceRef}
            className="reader-palette passage-relation-choices"
            style={readerPaletteStyle}
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
                    key={`${mark.id}:${mark.endpoint ?? ""}`}
                    onClick={() => {
                      setChoices([]);
                      onActivateMarkRef.current?.(mark.id, mark.endpoint);
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
    previous.surfaceId === next.surfaceId &&
    previous.context === next.context &&
    sameAnchor(previous.focus, next.focus) &&
    sameMarks(previous.marks, next.marks) &&
    previous.onSelect === next.onSelect &&
    previous.onActivateMark === next.onActivateMark &&
    previous.onGeometryChange === next.onGeometryChange,
);
