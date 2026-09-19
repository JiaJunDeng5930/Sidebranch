"use client";
import React, {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AnchorInput, DocumentRevision } from "../../lib/domain/model";
import {
  assertRendererAnchor,
  type RenderChunk,
  type RenderPlan,
} from "../../lib/reader/render-markdown";
import { layoutTop } from "../../lib/reader/render-dom";
import { DocumentMarkdownChunk, DocumentTextChunk } from "./document-markdown";

export const VIRTUALIZATION_THRESHOLD = 16_384;
export const MAX_VIEWPORT_CHUNKS = 7;
export const MAX_SELECTION_CHUNKS = 12;
function scrollerFor(root: HTMLElement) {
  return (
    root.closest<HTMLElement>("[data-document-scroll]") ??
    root.closest<HTMLElement>(".reading-area")
  );
}
function estimatedHeight(
  chunk: RenderChunk,
  measured: number | undefined,
): number {
  if (measured !== undefined) return measured;
  // Keep the fallback cheap and allocation-free. This runs for every source
  // chunk when a measured spacer changes; splitting each chunk here used to
  // recreate one short-lived array per chunk on every scroll correction.
  let height = 0;
  let lineStart = 0;
  for (let index = 0; index <= chunk.source.length; index += 1) {
    if (index !== chunk.source.length && chunk.source.charCodeAt(index) !== 10)
      continue;
    const length = index - lineStart;
    height += length ? Math.ceil(length / 35) * 30 : 14;
    lineStart = index + 1;
  }
  return Math.max(60, height);
}
function indexAt(prefix: readonly number[], offset: number): number {
  let low = 0,
    high = prefix.length - 2;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (prefix[middle + 1] <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function firstChunkEndingAfter(
  chunks: readonly RenderChunk[],
  offset: number,
): number {
  let low = 0;
  let high = chunks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (chunks[middle].range.end <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function firstChunkStartingAtOrAfter(
  chunks: readonly RenderChunk[],
  offset: number,
): number {
  let low = 0;
  let high = chunks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (chunks[middle].range.start < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Return the source chunks touched by an anchor without scanning the plan. */
export function focusChunkIndexes(
  chunks: readonly RenderChunk[],
  focus: AnchorInput,
): readonly number[] {
  const first = firstChunkEndingAfter(chunks, focus.start);
  const exclusiveEnd = firstChunkStartingAtOrAfter(chunks, focus.end);
  if (first >= exclusiveEnd || first >= chunks.length) return [];
  return Array.from(
    { length: exclusiveEnd - first },
    (_, index) => first + index,
  );
}

export interface SelectionCorridor {
  readonly indexes: readonly number[];
  readonly exceeded: boolean;
}

/** Keep one contiguous, bounded native-selection corridor in source order. */
export function selectionCorridor(
  anchorChunk: number | null,
  focusChunk: number | null,
  maxChunks = MAX_SELECTION_CHUNKS,
): SelectionCorridor {
  if (anchorChunk === null && focusChunk === null)
    return { indexes: [], exceeded: false };
  const anchor = anchorChunk ?? focusChunk!;
  const focus = focusChunk ?? anchor;
  const direction = focus < anchor ? -1 : 1;
  const distance = Math.abs(focus - anchor) + 1;
  const length = Math.min(distance, Math.max(1, maxChunks));
  const indexes = Array.from(
    { length },
    (_, index) => anchor + index * direction,
  ).sort((a, b) => a - b);
  return { indexes, exceeded: distance > length };
}
export interface DocumentBodyProps {
  doc: DocumentRevision;
  plan: RenderPlan;
  rootRef: React.RefObject<HTMLDivElement | null>;
  focus: AnchorInput | null;
  onGeometryChange?: () => void;
}

/** Only visible source chunks, an explicit focus, and a native selection own DOM nodes. */
export const DocumentBody = memo(function DocumentBody({
  doc,
  plan,
  rootRef,
  focus,
  onGeometryChange,
}: DocumentBodyProps) {
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(
    () => new Map(),
  );
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [selectionPins, setSelectionPins] = useState<readonly number[]>([]);
  const measured = useRef(new Map<number, number>());
  const geometryCallback = useRef(onGeometryChange);
  geometryCallback.current = onGeometryChange;
  const virtual =
    plan.sourceLength > VIRTUALIZATION_THRESHOLD && plan.chunks.length > 1;
  const estimates = useMemo(
    () => plan.chunks.map((chunk) => estimatedHeight(chunk, undefined)),
    [plan],
  );
  const prefix = useMemo(() => {
    const result = [0];
    for (const chunk of plan.chunks)
      result.push(
        result[result.length - 1] +
          (heights.get(chunk.index) ?? estimates[chunk.index]),
      );
    return result;
  }, [estimates, heights, plan.chunks]);
  const visibleFirst = virtual ? indexAt(prefix, Math.max(0, viewport.top)) : 0;
  const visibleLast = virtual
    ? indexAt(prefix, viewport.top + viewport.height)
    : plan.chunks.length - 1;
  const indexes = new Set<number>();
  // Visible chunks and explicit destinations get the budget before overscan.
  // A very small measured chunk must not create an unbounded render window.
  for (
    let index = visibleFirst;
    index <= visibleLast &&
    (!virtual || indexes.size < MAX_VIEWPORT_CHUNKS - 2);
    index++
  )
    indexes.add(index);
  if (focus && virtual) {
    const focused = focusChunkIndexes(plan.chunks, focus);
    // A small focus range owns a complete contiguous render corridor so its
    // DOM Range, native selection, and Scene geometry agree. Large ranges are
    // bounded by the existing budget and expose explicit gaps as partial.
    if (focused.length <= MAX_VIEWPORT_CHUNKS) {
      for (const index of focused) indexes.add(index);
    } else {
      if (focused[0] !== undefined) indexes.add(focused[0]);
      if (focused.length > 1) indexes.add(focused[focused.length - 1]);
    }
  }
  if (virtual) {
    for (const index of [visibleFirst - 1, visibleLast + 1])
      if (
        index >= 0 &&
        index < plan.chunks.length &&
        indexes.size < MAX_VIEWPORT_CHUNKS
      )
        indexes.add(index);
  }
  for (const index of selectionPins) indexes.add(index);
  const mounted = [...indexes].sort((a, b) => a - b);
  const mountedKey = mounted.join(",");

  useLayoutEffect(() => {
    // Scene must read the committed spacer heights, not the DOM preceding
    // setHeights. Mounted chunks and spacer-only changes both move anchors.
    geometryCallback.current?.();
  }, [heights, mountedKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const parent = scrollerFor(root);
    if (!parent) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = Math.max(
        0,
        parent.scrollTop - (layoutTop(root) - layoutTop(parent)),
      );
      const height = parent.clientHeight || 800;
      setViewport((old) =>
        old.top === top && old.height === height ? old : { top, height },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    parent.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(parent);
    return () => {
      parent.removeEventListener("scroll", schedule);
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rootRef, doc.revisionId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = [
      ...root.querySelectorAll<HTMLElement>("[data-document-chunk-index]"),
    ];
    const measure = () => {
      let changed = false;
      for (const node of nodes) {
        const index = Number(node.dataset.documentChunkIndex),
          height = node.offsetHeight;
        if (height > 0 && measured.current.get(index) !== height) {
          measured.current.set(index, height);
          changed = true;
        }
      }
      if (changed) setHeights(new Map(measured.current));
      geometryCallback.current?.();
    };
    measure();
    const observer = new ResizeObserver(measure);
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [rootRef, doc.revisionId, mountedKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let dragging = false;
    let origin: number | null = null;
    let releaseIdle: number | null = null;
    let releaseTimer = 0;
    const chunkAt = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement;
      const chunk = element?.closest<HTMLElement>(
        "[data-document-chunk-index]",
      );
      return chunk && root.contains(chunk)
        ? Number(chunk.dataset.documentChunkIndex)
        : null;
    };
    const selectionChanged = () => {
      const selection = window.getSelection();
      const from =
        selection && !selection.isCollapsed
          ? chunkAt(selection.anchorNode)
          : null;
      const to =
        selection && !selection.isCollapsed
          ? chunkAt(selection.focusNode)
          : null;
      // Keep a continuous corridor while the native Range grows. Pinning only
      // the two endpoints would silently omit copied text between them. When
      // the browser tries to cross the cap, keep the last precise corridor and
      // let selectionAnchor reject the missing spacer instead of inventing an
      // anchor for text that is not mounted.
      const corridor = selectionCorridor(
        from ?? (dragging ? origin : null),
        to ?? (dragging ? origin : null),
      );
      const next = corridor.indexes;
      root.dataset.selectionLimit = corridor.exceeded ? "true" : "false";
      setSelectionPins((old) =>
        old.join(",") === next.join(",") ? old : next,
      );
    };
    const down = (event: PointerEvent) => {
      dragging = true;
      origin = chunkAt(event.target instanceof Node ? event.target : null);
      selectionChanged();
    };
    const up = () => {
      dragging = false;
      origin = null;
      if (releaseIdle !== null) {
        const cancelIdle = (
          window as Window & { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback;
        cancelIdle?.(releaseIdle);
        releaseIdle = null;
      }
      if (releaseTimer) window.clearTimeout(releaseTimer);
      // Let the browser finish its Range before releasing extra DOM chunks.
      // Idle cleanup avoids doing a synchronous unmount in the selection frame.
      const requestIdle = (
        window as Window & {
          requestIdleCallback?: (
            callback: () => void,
            options?: { timeout: number },
          ) => number;
        }
      ).requestIdleCallback;
      if (requestIdle) {
        releaseIdle = requestIdle(
          () => {
            releaseIdle = null;
            selectionChanged();
          },
          { timeout: 160 },
        );
      } else {
        releaseTimer = window.setTimeout(() => {
          releaseTimer = 0;
          selectionChanged();
        }, 80);
      }
    };
    root.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("selectionchange", selectionChanged);
    return () => {
      root.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("selectionchange", selectionChanged);
      if (releaseIdle !== null) {
        const cancelIdle = (
          window as Window & { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback;
        cancelIdle?.(releaseIdle);
      }
      if (releaseTimer) window.clearTimeout(releaseTimer);
    };
  }, [rootRef, doc.revisionId]);

  const children: React.ReactNode[] = [];
  let previous = 0;
  for (const index of mounted) {
    const chunk = plan.chunks[index];
    if (!chunk) continue;
    if (virtual && index > previous)
      children.push(
        <div
          key={`gap-${index}`}
          aria-hidden="true"
          data-source-gap-start={plan.chunks[previous].range.start}
          data-source-gap-end={chunk.range.start}
          style={{
            height: prefix[index] - prefix[previous],
            userSelect: "none",
          }}
        />,
      );
    const Chunk =
      doc.format === "text" ? DocumentTextChunk : DocumentMarkdownChunk;
    children.push(
      <Chunk
        key={`${doc.revisionId}:${index}`}
        source={chunk.source}
        sourceStart={chunk.range.start}
        sourceEnd={chunk.range.end}
        chunkIndex={index}
        referenceDefinitions={chunk.referenceDefinitions}
      />,
    );
    previous = index + 1;
  }
  if (virtual && previous < plan.chunks.length)
    children.push(
      <div
        key="tail"
        aria-hidden="true"
        data-source-gap-start={plan.chunks[previous].range.start}
        data-source-gap-end={plan.sourceLength}
        style={{
          height: prefix[prefix.length - 1] - prefix[previous],
          userSelect: "none",
        }}
      />,
    );
  return <>{children}</>;
});

export function validateFocus(
  content: string,
  focus: AnchorInput | null,
  revisionId: string,
): void {
  if (focus) assertRendererAnchor(content, focus, revisionId);
}
