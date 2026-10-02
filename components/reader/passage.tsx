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
import { AnchorInput as AnchorInputSchema } from "../../lib/domain/model";
import {
  createReaderDocumentModel,
  validateReaderSelector,
  sourceEnvelopeForReaderSelector,
} from "../../lib/reader/document-model";
import { checkedEndpointMaps } from "../../lib/domain/text-offsets";
import {
  assertRendererAnchor,
  RendererMappingError,
  type RenderPlan,
} from "../../lib/reader/render-markdown";
import { DocumentBody } from "./document-virtualizer";
import {
  sourceRanges,
  readerRanges,
  readerModelForRoot,
  bindReaderModel,
  unbindReaderModel,
  checkedReaderElement,
} from "../../lib/reader/render-dom";
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

/** Capture exact model fragments from the mounted native selection. */
export function selectionAnchor(
  root: HTMLElement,
  doc: DocumentRevision,
  model = createReaderDocumentModel(doc.content, doc.format),
): AnchorInput | null {
  if (root.dataset.revisionId !== doc.revisionId)
    throw new RendererMappingError(
      "Selection root does not contain this revision",
      "revision",
    );
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const native = selection.getRangeAt(0);
  const body = root.querySelector<HTMLElement>("[data-reader-body]") ?? root;
  const clipped = native.cloneRange();
  const bounds = root.ownerDocument.createRange();
  bounds.selectNodeContents(body);
  if (
    native.compareBoundaryPoints(3, bounds) >= 0 ||
    native.compareBoundaryPoints(1, bounds) <= 0
  )
    return null;
  if (clipped.compareBoundaryPoints(0, bounds) < 0)
    clipped.setStart(bounds.startContainer, bounds.startOffset);
  if (clipped.compareBoundaryPoints(2, bounds) > 0)
    clipped.setEnd(bounds.endContainer, bounds.endOffset);
  const fragments: { nodeId: string; start: number; end: number }[] = [];
  for (const element of body.querySelectorAll<HTMLElement>(
    "[data-reader-node-id]",
  )) {
    const node = model.getNode(element.dataset.readerNodeId!);
    checkedReaderElement(element, node);
    const full = root.ownerDocument.createRange();
    if (node.kind === "atom") full.selectNode(element);
    else full.selectNodeContents(element);
    if (
      clipped.compareBoundaryPoints(3, full) >= 0 ||
      clipped.compareBoundaryPoints(1, full) <= 0
    )
      continue;
    if (node.kind === "atom") {
      fragments.push({ nodeId: node.id, start: 0, end: 1 });
      continue;
    }
    const overlap = full.cloneRange();
    if (clipped.compareBoundaryPoints(0, full) > 0)
      overlap.setStart(clipped.startContainer, clipped.startOffset);
    if (clipped.compareBoundaryPoints(2, full) < 0)
      overlap.setEnd(clipped.endContainer, clipped.endOffset);
    const prefix = full.cloneRange();
    prefix.setEnd(overlap.startContainer, overlap.startOffset);
    const start = prefix.toString().length,
      end = start + overlap.toString().length;
    if (end > start) fragments.push({ nodeId: node.id, start, end });
  }
  if (!fragments.length) return null;
  const reader = validateReaderSelector(model, {
    version: "reader-v1",
    fragments,
    preview: clipped.toString(),
  });
  return AnchorInputSchema.parse({
    revisionId: doc.revisionId,
    ...sourceEnvelopeForReaderSelector(model, reader),
    reader,
  });
}

export function selectionPreview(root: HTMLElement): string {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
  const body = root.querySelector<HTMLElement>("[data-reader-body]") ?? root;
  const range = selection.getRangeAt(0);
  return body.contains(range.commonAncestorContainer) ? range.toString() : "";
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
  if (!span.dataset.sourceStartMap && !span.dataset.sourceEndMap)
    return end - start === renderedLength;
  return !!checkedEndpointMaps(
    span.dataset.sourceStartMap,
    span.dataset.sourceEndMap,
    renderedLength,
    end - start,
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
  if (anchor.reader) {
    const model = readerModelForRoot(root);
    const reader = validateReaderSelector(model, anchor.reader);
    const ranges = readerRanges(root, reader, model);
    const mounted = new Set(
      Array.from(
        root.querySelectorAll<HTMLElement>("[data-reader-node-id]"),
      ).map((element) => element.dataset.readerNodeId),
    );
    const absent = reader.fragments.filter(
      (fragment) => !mounted.has(fragment.nodeId),
    );
    const missing = absent.map(
      (fragment) => model.getNode(fragment.nodeId).origin,
    );
    return {
      ranges,
      coverage: absent.length
        ? ranges.length
          ? "partial"
          : "unmounted"
        : "complete",
      missing: mergeMissingSpans(missing),
    };
  }
  const ranges = sourceRanges(root, anchor);
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
    if (!span.dataset.readerNodeId && !hasCheckedSourceMapping(span)) {
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
    const firstMapped = start;
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
        a.quote === b.quote &&
        JSON.stringify(a.reader) === JSON.stringify(b.reader)))
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
  const onSelectRef = useRef(onSelect);
  const onActivateMarkRef = useRef(onActivateMark);
  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
    onActivateMarkRef.current = onActivateMark;
  }, [onActivateMark, onSelect]);
  const currentFocus = focus?.revisionId === doc.revisionId ? focus : null;
  const model = useMemo(
    () => createReaderDocumentModel(doc.content, doc.format),
    [doc.content, doc.format],
  );
  const plan = model.plan;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    bindReaderModel(root, model);
    return () => unbindReaderModel(root);
  }, [model]);
  const checkedMarks = useMemo(
    () => validateMarks(doc.content, doc.revisionId, marks),
    [doc.content, doc.revisionId, marks],
  );
  const highlightRuns = useMemo(
    () =>
      passageHighlightRuns(
        checkedMarks
          .filter((mark) => !mark.anchor.reader)
          .map((mark) => ({
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
      const rangesFor = (source: {
        start: number;
        end: number;
        reader?: AnchorInput["reader"];
      }) => {
        const key = `${source.start}:${source.end}:${JSON.stringify(source.reader)}`;
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
      checkedMarks
        .filter((mark) => mark.anchor.reader)
        .forEach((mark, index) => {
          const appearance = relationAppearance(mark.relation);
          register(
            `reader-mark${index}`,
            rangesFor(mark.anchor),
            `color-mix(in srgb, ${appearance.signal} ${readerPalette.state.signal.range * 100}%, transparent)`,
            appearance.ink,
          );
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
    observer.observe(root, { childList: true, subtree: true });
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
    highlightId,
    model,
  ]);

  function captureSelection(): void {
    const root = rootRef.current;
    if (!root) return;
    const anchor = selectionAnchor(root, doc, model);
    if (!anchor) return;
    const range = window.getSelection()?.getRangeAt(0);
    if (range) onSelectRef.current(anchor, range.getBoundingClientRect());
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
    (mark.label ?? mark.anchor.reader?.preview ?? mark.anchor.quote)
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
        model={model}
        rootRef={rootRef}
        focus={currentFocus}
        onGeometryChange={geometryChanged}
      />
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
                    {mark.label ??
                      mark.anchor.reader?.preview ??
                      mark.anchor.quote}
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
