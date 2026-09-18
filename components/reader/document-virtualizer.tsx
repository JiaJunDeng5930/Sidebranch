"use client";
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import type { AnchorInput, DocumentRevision } from "../../lib/domain/model";
import {
  assertRendererAnchor,
  type RenderChunk,
  type RenderPlan,
} from "../../lib/reader/render-markdown";
import { layoutTop } from "../../lib/reader/render-dom";
import { DocumentMarkdownChunk, DocumentTextChunk } from "./document-markdown";

export const VIRTUALIZATION_THRESHOLD = 16_384;
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
  const lines = chunk.source.split("\n");
  return Math.max(
    60,
    lines.reduce(
      (height, line) =>
        height + (line.length ? Math.ceil(line.length / 35) * 30 : 14),
      0,
    ),
  );
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
  const prefix = useMemo(() => {
    const result = [0];
    for (const chunk of plan.chunks)
      result.push(
        result[result.length - 1] +
          estimatedHeight(chunk, heights.get(chunk.index)),
      );
    return result;
  }, [plan, heights]);
  const first = virtual
    ? indexAt(prefix, Math.max(0, viewport.top - viewport.height))
    : 0;
  const last = virtual
    ? indexAt(prefix, viewport.top + viewport.height * 2)
    : plan.chunks.length - 1;
  const indexes = new Set<number>();
  for (let index = first; index <= last; index++) indexes.add(index);
  if (focus && virtual) {
    const focused = plan.chunks.filter(
      (chunk) => chunk.range.start < focus.end && chunk.range.end > focus.start,
    );
    if (focused[0]) indexes.add(focused[0].index);
    if (focused.length > 1) indexes.add(focused[focused.length - 1].index);
  }
  for (const index of selectionPins) indexes.add(index);
  const mounted = [...indexes].sort((a, b) => a - b);
  const mountedKey = mounted.join(",");

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
      if (dragging) return;
      const selection = window.getSelection();
      const from =
        selection && !selection.isCollapsed
          ? chunkAt(selection.anchorNode)
          : null;
      const to =
        selection && !selection.isCollapsed
          ? chunkAt(selection.focusNode)
          : null;
      const next =
        from !== null && to !== null
          ? Array.from(
              { length: Math.abs(to - from) + 1 },
              (_, i) => Math.min(from, to) + i,
            )
          : [];
      setSelectionPins((old) =>
        old.join(",") === next.join(",") ? old : next,
      );
    };
    const down = () => {
      dragging = true;
      setSelectionPins(
        [
          ...root.querySelectorAll<HTMLElement>("[data-document-chunk-index]"),
        ].map((node) => Number(node.dataset.documentChunkIndex)),
      );
    };
    const up = () => {
      dragging = false;
      selectionChanged();
    };
    root.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("selectionchange", selectionChanged);
    return () => {
      root.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("selectionchange", selectionChanged);
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
