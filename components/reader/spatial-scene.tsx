"use client";

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Anchor,
  Connection,
  ConnectionId,
  DocumentSummary,
} from "../../lib/domain/model";
import {
  type DocumentView,
  type SceneAction,
  type SceneState,
  type Point3,
  type ViewId,
} from "../../lib/reader/scene";
import "./spatial-scene.css";
import { relationNames as RELATION_LABELS, relationColors as RELATION_COLORS } from "../../lib/reader/relations";
import { sourceRanges, type SourceSelectionRange } from "../../lib/reader/render-dom";

export interface SpatialSceneController {
  resetCamera(): void;
  focusView(viewId: ViewId): void;
  promoteView(viewId: ViewId): void;
  closeView(viewId: ViewId): void;
  panBy(delta: { x: number; y: number; z?: number }): void;
  orbitBy(delta: { x: number; y: number }): void;
  zoomBy(delta: number): void;
  measure(): void;
}

export interface RelatedProjection {
  document: DocumentSummary;
  anchor: Anchor;
  connectionId: ConnectionId;
  color: string;
}

export interface SpatialSceneProps {
  state: SceneState;
  dispatch: (action: SceneAction) => void;
  connections: readonly Connection[];
  mode: "read" | "overview";
  onModeChange: (mode: "read" | "overview") => void;
  renderDocument: (view: DocumentView, detailed: boolean) => React.ReactNode;
  onActivateConnection: (id: ConnectionId) => void;
  related?: readonly RelatedProjection[];
  onOpenRelated?: (connectionId: ConnectionId) => void;
  controllerRef?: React.Ref<SpatialSceneController>;
}

const MAX_BEAMS = 64;

type ScenePoint = { x: number; y: number };
type RectLike = { left: number; top: number; right: number; bottom: number };

interface EndpointGeometry extends ScenePoint {
  clipped: boolean;
  extent: number;
}

interface BeamGeometry {
  id: ConnectionId;
  path: string;
  ribbon: string;
  from: EndpointGeometry;
  to: EndpointGeometry;
  label: string;
  endpointLabel: string;
  color: string;
  primary: boolean;
}

interface ViewPlaneProps {
  view: DocumentView;
  role: "current" | "companion" | "peripheral";
  detailed: boolean;
  renderDocument: SpatialSceneProps["renderDocument"];
  dispatch: SpatialSceneProps["dispatch"];
  onNode: (id: ViewId, node: HTMLElement | null) => void;
  onStartPlaneDrag: (event: React.PointerEvent, id: ViewId) => void;
}

function customStyle(values: Record<string, string>): React.CSSProperties {
  return values as React.CSSProperties;
}

const ViewPlane = React.memo(function ViewPlane({
  view,
  role,
  detailed,
  renderDocument,
  dispatch,
  onNode,
  onStartPlaneDrag,
}: ViewPlaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const restoredView = useRef<string | null>(null);
  const content = useMemo(
    () => renderDocument(view, detailed),
    [detailed, renderDocument, view],
  );

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const focusKey = `${view.id}:${view.focus?.revisionId ?? ""}:${view.focus?.start ?? ""}:${view.focus?.end ?? ""}`;
    const newFocus = restoredView.current !== focusKey;
    restoredView.current = focusKey;
    // A newly mounted passage positions its explicit anchor before this parent
    // layout effect. Do not overwrite that navigation with the default zero.
    if (newFocus && view.focus) return;
    if (Math.abs(scroll.scrollTop - view.scrollTop) > 1)
      scroll.scrollTop = Math.max(0, view.scrollTop);
  }, [view.id, view.scrollTop, view.focus]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null)
        window.cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  const onScroll = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll || scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      dispatch({
        type: "update-view",
        viewId: view.id,
        patch: { scrollTop: scroll.scrollTop },
      });
    });
  }, [dispatch, view.id]);

  return (
    <section
      ref={(node) => onNode(view.id, node)}
      className={`spatial-view spatial-view-${role}`}
      data-view-id={view.id}
      data-revision-id={view.document.revisionId}
      data-view-role={role}
      data-detailed={detailed ? "true" : "false"}
      aria-label={`${view.document.title}，v${view.document.sequence}`}
      style={customStyle({
        "--view-x": `${view.position.x}px`,
        "--view-y": `${view.position.y}px`,
        "--view-z": `${view.position.z}px`,
      })}
    >
      <header
        className="spatial-view-header"
        data-view-handle
        onPointerDown={(event) => onStartPlaneDrag(event, view.id)}
      >
        <div className="spatial-view-heading">
          <span className="spatial-view-role">
            {role === "current"
              ? "当前"
              : role === "companion"
                ? "旁文"
                : "关联"}
          </span>
          <strong title={view.document.path}>{view.document.title}</strong>
          <span className="spatial-view-revision">
            v{view.document.sequence}
          </span>
        </div>
        <div className="spatial-view-actions">
          {role !== "current" && (
            <button
              type="button"
              className="spatial-view-action"
              aria-label={`将${view.document.title}设为当前文档`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() =>
                dispatch({ type: "promote-view", viewId: view.id })
              }
            >
              当前
            </button>
          )}
          <button
            type="button"
            className="spatial-view-action spatial-view-close"
            aria-label={`关闭${view.document.title}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => dispatch({ type: "close-view", viewId: view.id })}
          >
            ×
          </button>
        </div>
      </header>
      <div
        ref={scrollRef}
        className="spatial-document-scroll"
        data-document-scroll
        tabIndex={0}
        onScroll={onScroll}
      >
        {content}
      </div>
    </section>
  );
});

interface RelatedPlaneProps {
  origin: Point3;
  related: RelatedProjection;
  index: number;
  relationLabel: string;
  onNode: (id: string, node: HTMLElement | null) => void;
  onOpenRelated?: (id: ConnectionId) => void;
}

function RelatedPlane({
  origin,
  related,
  index,
  relationLabel,
  onNode,
  onOpenRelated,
}: RelatedPlaneProps) {
  const id = `related-${related.connectionId}-${index}`;
  const position = {
    x: origin.x + (index % 2 === 0
        ? -560 - Math.floor(index / 2) * 110
        : 560 + Math.floor(index / 2) * 110),
    y: origin.y + ((index % 3) - 1) * 115,
    z: origin.z - 330 - Math.floor(index / 2) * 120,
  };
  return (
    <article
      ref={(node) => onNode(id, node)}
      className="spatial-related"
      data-related-id={id}
      data-connection-id={related.connectionId}
      data-revision-id={related.anchor.revisionId}
      style={customStyle({
        "--view-x": `${position.x}px`,
        "--view-y": `${position.y}px`,
        "--view-z": `${position.z}px`,
        "--related-color": related.color,
      })}
    >
      <header className="spatial-related-header" data-view-handle>
        <span className="spatial-view-role">关联文档</span>
        <strong title={related.document.path}>{related.document.title}</strong>
        <span className="spatial-view-revision">
          v{related.document.sequence}
        </span>
      </header>
      <div className="spatial-related-body" data-document-scroll>
        <span
          className="spatial-related-relation"
          style={{ color: related.color }}
        >
          {relationLabel}
        </span>
        <blockquote>
          <span
            data-source-start={related.anchor.start}
            data-source-end={related.anchor.end}
            data-revision-id={related.anchor.revisionId}
          >
            {related.anchor.quote}
          </span>
        </blockquote>
        {onOpenRelated && (
          <button
            type="button"
            className="spatial-related-open"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onOpenRelated(related.connectionId)}
          >
            打开完整文档 ↗
          </button>
        )}
      </div>
    </article>
  );
}

function rectFromDomRect(rect: DOMRect): RectLike {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function intersectRect(a: RectLike, b: RectLike): RectLike | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function unionRects(rects: readonly RectLike[]): RectLike | null {
  if (!rects.length) return null;
  return rects.reduce(
    (result, rect) => ({
      left: Math.min(result.left, rect.left),
      top: Math.min(result.top, rect.top),
      right: Math.max(result.right, rect.right),
      bottom: Math.max(result.bottom, rect.bottom),
    }),
    { ...rects[0] },
  );
}

function clampPointToRect(point: ScenePoint, rect: RectLike): ScenePoint {
  return {
    x: Math.min(rect.right, Math.max(rect.left, point.x)),
    y: Math.min(rect.bottom, Math.max(rect.top, point.y)),
  };
}

type ProjectSourceRanges = (root: HTMLElement, source: SourceSelectionRange) => readonly Range[];

function sourceRects(
  root: HTMLElement,
  revisionId: string,
  start: number,
  end: number,
  projectRanges: ProjectSourceRanges,
): RectLike[] {
  return projectRanges(root, { revisionId, start, end })
    .flatMap((range) => Array.from(range.getClientRects()))
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map(rectFromDomRect);
}

function measureEndpoint(
  root: HTMLElement,
  revisionId: string,
  start: number,
  end: number,
  sceneRect: RectLike,
  projectRanges: ProjectSourceRanges,
): EndpointGeometry | null {
  const all = sourceRects(root, revisionId, start, end, projectRanges);
  const source = unionRects(all);
  const scrollNode = root.querySelector<HTMLElement>("[data-document-scroll]");
  const clip = intersectRect(
    sceneRect,
    scrollNode
      ? rectFromDomRect(scrollNode.getBoundingClientRect())
      : sceneRect,
  );
  if (!clip) return null;
  if (!source) {
    const revisionRoot = Array.from(root.querySelectorAll<HTMLElement>("[data-revision-id]")).find(node => node.dataset.revisionId === revisionId);
    const gap = revisionRoot && Array.from(revisionRoot.querySelectorAll<HTMLElement>("[data-source-gap-start]")).find(node => Number(node.dataset.sourceGapStart) <= start && Number(node.dataset.sourceGapEnd) >= end);
    if (!gap) return null;
    const rect = gap.getBoundingClientRect();
    const above = rect.bottom <= clip.top || (rect.top < clip.top && rect.bottom < clip.bottom);
    return {x:(clip.left+clip.right)/2-sceneRect.left,y:(above?clip.top:clip.bottom)-sceneRect.top,clipped:true,extent:3};
  }
  const visible = all
    .map((rect) => intersectRect(rect, clip))
    .filter((rect): rect is RectLike => rect !== null);
  const visibleUnion = unionRects(visible);
  const clipped =
    !visibleUnion ||
    source.left < clip.left ||
    source.right > clip.right ||
    source.top < clip.top ||
    source.bottom > clip.bottom;
  const pointRect = visibleUnion ?? source;
  const point = {
    x: pointRect.left + (pointRect.right - pointRect.left) / 2,
    y: pointRect.top + (pointRect.bottom - pointRect.top) / 2,
  };
  const finalPoint = clipped ? clampPointToRect(point, clip) : point;
  return {
    x: finalPoint.x - sceneRect.left,
    y: finalPoint.y - sceneRect.top,
    clipped,
    extent: clipped ? 3 : Math.min(22, Math.max(4, (pointRect.bottom - pointRect.top) / 2)),
  };
}

function beamRibbon(from: EndpointGeometry, to: EndpointGeometry): string {
  const bend = Math.max(42, Math.abs(to.x - from.x) * 0.34) * (to.x >= from.x ? 1 : -1);
  const a = from.y - from.extent, b = to.y - to.extent;
  const c = to.y + to.extent, d = from.y + from.extent;
  return `M ${from.x} ${a} C ${from.x+bend} ${a} ${to.x-bend} ${b} ${to.x} ${b} L ${to.x} ${c} C ${to.x-bend} ${c} ${from.x+bend} ${d} ${from.x} ${d} Z`;
}

function beamPath(from: ScenePoint, to: ScenePoint): string {
  const dx = to.x - from.x;
  const bend = Math.max(42, Math.abs(dx) * 0.34);
  const direction = dx >= 0 ? 1 : -1;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${(from.x + bend * direction).toFixed(1)} ${from.y.toFixed(1)} ${(to.x - bend * direction).toFixed(1)} ${to.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function sameGeometry(
  a: readonly BeamGeometry[],
  b: readonly BeamGeometry[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (beam, index) =>
      beam.id === b[index]?.id &&
      beam.path === b[index]?.path &&
      beam.ribbon === b[index]?.ribbon &&
      beam.primary === b[index]?.primary &&
      beam.label === b[index]?.label &&
      beam.endpointLabel === b[index]?.endpointLabel &&
      beam.color === b[index]?.color &&
      beam.from.clipped === b[index]?.from.clipped &&
      beam.to.clipped === b[index]?.to.clipped,
  );
}

function roleFor(
  state: SceneState,
  id: ViewId,
): "current" | "companion" | "peripheral" {
  if (state.currentViewId === id) return "current";
  if (state.companionViewId === id) return "companion";
  return "peripheral";
}

function distanceFromCurrent(state: SceneState, view: DocumentView): number {
  const current = state.views.find(
    (candidate) => candidate.id === state.currentViewId,
  );
  if (!current) return 0;
  return Math.hypot(
    current.position.x - view.position.x,
    current.position.y - view.position.y,
    current.position.z - view.position.z,
  );
}

export function SpatialScene({
  state,
  dispatch,
  connections,
  mode,
  onModeChange,
  renderDocument,
  onActivateConnection,
  related = [],
  onOpenRelated,
  controllerRef,
}: SpatialSceneProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewNodes = useRef(new Map<string, HTMLElement>());
  const changeMode = useCallback((next: "read" | "overview") => {
    const viewport = viewportRef.current;
    if (next === "overview" && viewport) dispatch({ type: "overview-camera", width: viewport.clientWidth, height: viewport.clientHeight });
    else if (next === "read") dispatch({ type: "reset-camera" });
    onModeChange(next);
  }, [dispatch, onModeChange]);

  const dragRef = useRef<
    | { kind: "camera" | "orbit"; pointerId: number; x: number; y: number }
    | { kind: "plane"; pointerId: number; id: string; x: number; y: number }
    | null
  >(null);
  const measureFrame = useRef<number | null>(null);
  const inputRef = useRef({ state, connections, related });
  const [beams, setBeams] = useState<readonly BeamGeometry[]>([]);
  const sourceRangeCache = useRef(new WeakMap<HTMLElement, Map<string, readonly Range[]>>());
  const measurementRootsKey = state.views.map(view => view.id).join("|") + "/" + related.map(item => item.connectionId + ":" + item.anchor.revisionId).join("|");
  const projectRanges = useCallback<ProjectSourceRanges>((root, source) => {
    let cache = sourceRangeCache.current.get(root);
    if (!cache) {
      cache = new Map();
      sourceRangeCache.current.set(root, cache);
    }
    const key = `${source.revisionId}:${source.start}:${source.end}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const ranges = sourceRanges(root, source);
    cache.set(key, ranges);
    return ranges;
  }, []);

  const setViewNode = useCallback((id: string, node: HTMLElement | null) => {
    if (node) viewNodes.current.set(id, node);
    else viewNodes.current.delete(id);
  }, []);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const sceneRect = rectFromDomRect(viewport.getBoundingClientRect());
    const {
      state: currentState,
      connections: currentConnections,
      related: currentRelated,
    } = inputRef.current;
    const current = currentState.currentViewId;
    const companion = currentState.companionViewId;
    const endpointCache = new Map<string, EndpointGeometry | null>();
    const currentView = currentState.views.find(view => view.id === current);
    const companionView = currentState.views.find(view => view.id === companion);
    const matchesFocus = (anchor: Anchor, view: DocumentView | undefined) => Boolean(view?.focus && view.focus.revisionId === anchor.revisionId && view.focus.start === anchor.start && view.focus.end === anchor.end);
    const priority = (connection: Connection) => {
      const endpoints = [connection.from,connection.to];
      const focusScore = endpoints.filter(anchor => matchesFocus(anchor,currentView) || matchesFocus(anchor,companionView)).length * 16;
      return focusScore + endpoints.filter(anchor => anchor.revisionId === currentView?.document.revisionId || anchor.revisionId === companionView?.document.revisionId).length * 4;
    };
    const prioritized = [...currentConnections].sort((a,b) => priority(b)-priority(a)).slice(0,MAX_BEAMS);
    const endpoint = (revisionId: string, start: number, end: number) => {
      const cacheKey = `${revisionId}:${start}:${end}`;
      if (endpointCache.has(cacheKey))
        return endpointCache.get(cacheKey) ?? null;
      const orderedViews = [...currentState.views].sort((a,b) => {
        const score = (view:DocumentView) => Number(view.focus?.revisionId === revisionId && view.focus.start === start && view.focus.end === end)*4 + Number(view.id === current)*2 + Number(view.id === companion);
        return score(b)-score(a);
      });
      for (const view of orderedViews) {
        if (view.document.revisionId !== revisionId) continue;
        const node = viewNodes.current.get(view.id);
        if (!node) continue;
        const result = measureEndpoint(node, revisionId, start, end, sceneRect, projectRanges);
        if (result) {
          endpointCache.set(cacheKey, result);
          return result;
        }
      }
      for (const projection of currentRelated) {
        if (projection.anchor.revisionId !== revisionId) continue;
        const node = viewNodes.current.get(
          `related-${projection.connectionId}-${currentRelated.indexOf(projection)}`,
        );
        if (!node) continue;
        const result = measureEndpoint(node, revisionId, start, end, sceneRect, projectRanges);
        if (result) {
          endpointCache.set(cacheKey, result);
          return result;
        }
      }
      endpointCache.set(cacheKey, null);
      return null;
    };
    const next: BeamGeometry[] = [];
    for (const connection of prioritized) {
      const from = endpoint(
        connection.from.revisionId,
        connection.from.start,
        connection.from.end,
      );
      const to = endpoint(
        connection.to.revisionId,
        connection.to.start,
        connection.to.end,
      );
      if (!from || !to) continue;
      const primary = [connection.from, connection.to].some(anchor => matchesFocus(anchor, currentView) || matchesFocus(anchor, companionView));
      const fromDocument =
        currentState.views.find(
          (view) => view.document.revisionId === connection.from.revisionId,
        )?.document ??
        currentRelated.find(
          (projection) =>
            projection.anchor.revisionId === connection.from.revisionId,
        )?.document;
      const toDocument =
        currentState.views.find(
          (view) => view.document.revisionId === connection.to.revisionId,
        )?.document ??
        currentRelated.find(
          (projection) =>
            projection.anchor.revisionId === connection.to.revisionId,
        )?.document;
      const endpointLabel = `${fromDocument?.title ?? "相关文档"} · v${fromDocument?.sequence ?? "?"} ↔ ${toDocument?.title ?? "相关文档"} · v${toDocument?.sequence ?? "?"}`;
      next.push({
        id: connection.id,
        path: beamPath(from, to),
        ribbon: beamRibbon(from, to),
        from,
        to,
        label: connection.label || RELATION_LABELS[connection.relation],
        endpointLabel,
        color: RELATION_COLORS[connection.relation],
        primary,
      });
    }
    setBeams((previous) => (sameGeometry(previous, next) ? previous : next));
  }, [projectRanges]);

  const scheduleMeasure = useCallback(() => {
    if (measureFrame.current !== null) return;
    measureFrame.current = window.requestAnimationFrame(() => {
      measureFrame.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    inputRef.current = { state, connections, related };
    scheduleMeasure();
  }, [
    scheduleMeasure,
    state,
    state.views,
    state.camera,
    state.currentViewId,
    state.companionViewId,
    connections,
    related,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onScroll = () => scheduleMeasure();
    const scrollNodes = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-document-scroll]"),
    );
    scrollNodes.forEach((node) =>
      node.addEventListener("scroll", onScroll, { passive: true }),
    );
    window.addEventListener("resize", onScroll);
    const mutationObserver = new MutationObserver(() => {
      sourceRangeCache.current = new WeakMap();
      scheduleMeasure();
    });
    scrollNodes.forEach(node => mutationObserver.observe(node, { childList: true, characterData: true, subtree: true }));
    sourceRangeCache.current = new WeakMap();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onScroll);
    resizeObserver?.observe(viewport);
    scrollNodes.forEach((node) => resizeObserver?.observe(node));
    return () => {
      scrollNodes.forEach((node) =>
        node.removeEventListener("scroll", onScroll),
      );
      window.removeEventListener("resize", onScroll);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      if (measureFrame.current !== null) {
        window.cancelAnimationFrame(measureFrame.current);
        measureFrame.current = null;
      }
    };
  }, [scheduleMeasure, measurementRootsKey]);

  useImperativeHandle(
    controllerRef,
    () => ({
      resetCamera: () => dispatch({ type: "reset-camera" }),
      focusView: (viewId) => dispatch({ type: "focus-view", viewId }),
      promoteView: (viewId) => dispatch({ type: "promote-view", viewId }),
      closeView: (viewId) => dispatch({ type: "close-view", viewId }),
      panBy: (delta) =>
        dispatch({
          type: "camera",
          patch: {
            position: {
              x: state.camera.position.x + delta.x,
              y: state.camera.position.y + delta.y,
              z: state.camera.position.z + (delta.z ?? 0),
            },
          },
        }),
      orbitBy: (delta) =>
        dispatch({
          type: "camera",
          patch: {
            rotation: {
              x: state.camera.rotation.x + delta.y,
              y: state.camera.rotation.y + delta.x,
            },
          },
        }),
      zoomBy: (delta) =>
        dispatch({
          type: "camera",
          patch: { zoom: state.camera.zoom + delta },
        }),
      measure,
    }),
    [dispatch, measure, state.camera],
  );

  const orderedViews = useMemo(
    () =>
      [...state.views].sort((a, b) => {
        const roleOrder = { current: 0, companion: 1, peripheral: 2 } as const;
        return (
          roleOrder[roleFor(state, a.id)] - roleOrder[roleFor(state, b.id)]
        );
      }),
    [state],
  );

  const startCameraDrag = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dragRef.current = {
      kind: event.shiftKey || event.altKey ? "orbit" : "camera",
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const startPlaneDrag = useCallback(
    (event: React.PointerEvent, id: string) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("button,a,input,textarea,select")) return;
      dragRef.current = {
        kind: "plane",
        pointerId: event.pointerId,
        id,
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-view-handle]")) return;
      if (target.closest("[data-document-scroll]")) return;
      if (target.closest("button,a,input,textarea,select")) return;
      startCameraDrag(event);
    },
    [startCameraDrag],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.kind === "plane") {
        const view = state.views.find((candidate) => candidate.id === drag.id);
        if (view) {
          dispatch({
            type: "update-view",
            viewId: view.id,
            patch: {
              position: {
                x: view.position.x + dx / state.camera.zoom,
                y: view.position.y + dy / state.camera.zoom,
                z: view.position.z,
              },
            },
          });
        }
      } else if (drag.kind === "orbit") {
        dispatch({
          type: "camera",
          patch: {
            rotation: {
              x: state.camera.rotation.x + dy * 0.18,
              y: state.camera.rotation.y + dx * 0.18,
            },
          },
        });
      } else {
        dispatch({
          type: "camera",
          patch: {
            position: {
              x: state.camera.position.x - dx / state.camera.zoom,
              y: state.camera.position.y - dy / state.camera.zoom,
              z: state.camera.position.z,
            },
          },
        });
      }
    },
    [dispatch, state.camera, state.views],
  );

  const stopPointer = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame: number | null = null;
    let delta = 0;
    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-document-scroll]") && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      delta += event.deltaY;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        dispatch({type:"camera",patch:{zoom:inputRef.current.state.camera.zoom*Math.exp(-delta*0.001)}});
        delta = 0;
      });
    };
    viewport.addEventListener("wheel",onWheel,{passive:false});
    return () => {viewport.removeEventListener("wheel",onWheel);if(frame !== null) cancelAnimationFrame(frame);};
  },[dispatch]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable ||
        target.closest("[contenteditable='true']")
      )
        return;
      if ((event.altKey || event.metaKey) && event.key === "ArrowLeft") {
        event.preventDefault();
        dispatch({ type: "history-back" });
        return;
      }
      if ((event.altKey || event.metaKey) && event.key === "ArrowRight") {
        event.preventDefault();
        dispatch({ type: "history-forward" });
        return;
      }
      if (target.closest("[data-document-scroll]")) return;
      if (event.key === "Escape") {
        if (state.currentViewId)
          dispatch({ type: "focus-view", viewId: state.currentViewId });
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        dispatch({ type: "reset-camera" });
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        changeMode("read");
        return;
      }
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        changeMode("overview");
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        dispatch({ type: "camera", patch: { zoom: state.camera.zoom + 0.08 } });
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        dispatch({ type: "camera", patch: { zoom: state.camera.zoom - 0.08 } });
        return;
      }
      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        dispatch({
          type: "camera",
          patch: {
            rotation: {
              x: state.camera.rotation.x,
              y: state.camera.rotation.y + (event.key === "]" ? 4 : -4),
            },
          },
        });
        return;
      }
      const pan = {
        ArrowLeft: { x: -36, y: 0 },
        ArrowRight: { x: 36, y: 0 },
        ArrowUp: { x: 0, y: -36 },
        ArrowDown: { x: 0, y: 36 },
      }[event.key];
      if (pan && !target.closest("button,a")) {
        event.preventDefault();
        dispatch({
          type: "camera",
          patch: {
            position: {
              x: state.camera.position.x + pan.x,
              y: state.camera.position.y + pan.y,
              z: state.camera.position.z,
            },
          },
        });
      }
    },
    [dispatch, changeMode, state.camera, state.currentViewId],
  );

  const worldStyle = customStyle({
    "--camera-transform": `rotateX(${-state.camera.rotation.x}deg) rotateY(${-state.camera.rotation.y}deg) scale(${state.camera.zoom}) translate3d(${-state.camera.position.x}px, ${-state.camera.position.y}px, ${-state.camera.position.z}px)`,
  });

  return (
    <section
      className={`spatial-scene spatial-scene-${mode}`}
      aria-label="空间阅读场景"
    >
      <div className="spatial-scene-toolbar">
        <div className="spatial-scene-modes" role="group" aria-label="场景模式">
          <button
            type="button"
            className={mode === "read" ? "active" : ""}
            aria-pressed={mode === "read"}
            onClick={() => changeMode("read")}
          >
            阅读
          </button>
          <button
            type="button"
            className={mode === "overview" ? "active" : ""}
            aria-pressed={mode === "overview"}
            onClick={() => changeMode("overview")}
          >
            总览
          </button>
        </div>
        <span className="spatial-scene-status">
          {state.views.length} 个阅读面 · {connections.length} 条连接
        </span>
        <span className="spatial-scene-hint">拖动空白平移 · Shift 拖动旋转 · 滚轮缩放</span>
        <div className="spatial-scene-actions">
          {state.currentViewId && (
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "focus-view", viewId: state.currentViewId! })
              }
            >
              回到当前
            </button>
          )}
        </div>
      </div>
      <div
        ref={viewportRef}
        className="spatial-scene-viewport"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
        onKeyDown={onKeyDown}
      >
        <div className="spatial-scene-world" style={worldStyle}>
          {orderedViews.map((view) => {
            const role = roleFor(state, view.id);
            const detailed =
              role !== "peripheral" ||
              distanceFromCurrent(state, view) <
                (mode === "overview" ? 1_250 : 900);
            return (
              <ViewPlane
                key={view.id}
                view={view}
                role={role}
                detailed={detailed}
                renderDocument={renderDocument}
                dispatch={dispatch}
                onNode={setViewNode}
                onStartPlaneDrag={startPlaneDrag}
              />
            );
          })}
          {related.map((projection, index) => {
            if (
              state.views.some(
                (view) =>
                  view.document.revisionId === projection.anchor.revisionId,
              )
            )
              return null;
            const connection = connections.find(
              (candidate) => candidate.id === projection.connectionId,
            );
            return (
              <RelatedPlane
                key={`${projection.connectionId}-${index}`}
                related={projection}
                origin={state.views.find(view => view.id === state.currentViewId)?.position ?? { x: 0, y: 0, z: 0 }}
                index={index}
                relationLabel={
                  connection
                    ? connection.label || RELATION_LABELS[connection.relation]
                    : "相关连接"
                }
                onNode={setViewNode}
                onOpenRelated={onOpenRelated}
              />
            );
          })}
        </div>
        <svg
          className="spatial-scene-beams"
          aria-label="文档之间的精确文字连接"
          preserveAspectRatio="none"
        >
          <defs>
            <marker
              id="spatial-beam-arrow"
              markerWidth="7"
              markerHeight="7"
              refX="5"
              refY="3.5"
              orient="auto"
            >
              <path d="M0 0L7 3.5L0 7z" fill="context-stroke" />
            </marker>
          </defs>
          {beams.map((beam) => (
            <g key={beam.id} data-beam-connection-id={beam.id}>
              {beam.primary && <path d={beam.ribbon} fill={beam.color} className="spatial-beam-ribbon" />}
              <path
                d={beam.path}
                className={`spatial-beam ${beam.primary ? "primary" : ""} ${beam.from.clipped || beam.to.clipped ? "clipped" : ""}`}
                stroke={beam.color}
                fill="none"
                tabIndex={0}
                role="button"
                aria-label={`激活连接：${beam.label}；${beam.endpointLabel}`}
                data-connection-id={beam.id}
                onClick={() => onActivateConnection(beam.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onActivateConnection(beam.id);
                  }
                }}
              >
                <title>{beam.endpointLabel}</title>
              </path>
              {beam.from.clipped && (
                <circle
                  className="spatial-beam-edge"
                  cx={beam.from.x}
                  cy={beam.from.y}
                  r="5"
                  stroke={beam.color}
                  fill="none"
                  data-connection-id={beam.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`激活连接端点：${beam.label}`}
                  pointerEvents="all"
                  onClick={() => onActivateConnection(beam.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onActivateConnection(beam.id);
                    }
                  }}
                >
                  <title>{beam.endpointLabel}</title>
                </circle>
              )}
              {beam.to.clipped && (
                <circle
                  className="spatial-beam-edge"
                  cx={beam.to.x}
                  cy={beam.to.y}
                  r="5"
                  stroke={beam.color}
                  fill="none"
                  data-connection-id={beam.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`激活连接端点：${beam.label}`}
                  pointerEvents="all"
                  onClick={() => onActivateConnection(beam.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onActivateConnection(beam.id);
                    }
                  }}
                >
                  <title>{beam.endpointLabel}</title>
                </circle>
              )}
            </g>
          ))}
        </svg>
        <div className="spatial-scene-beam-labels" aria-hidden="false">
          {beams.filter(beam => beam.primary).slice(0, 3).map((beam) => {
            const x = (beam.from.x + beam.to.x) / 2;
            const y = (beam.from.y + beam.to.y) / 2;
            return (
              <button
                type="button"
                key={beam.id}
                className={`spatial-beam-label ${beam.primary ? "primary" : ""}`}
                style={customStyle({
                  left: `${x}px`,
                  top: `${y}px`,
                  "--beam-color": beam.color,
                })}
                data-connection-id={beam.id}
                aria-label={`${beam.label}：${beam.endpointLabel}`}
                title={beam.endpointLabel}
                onClick={() => onActivateConnection(beam.id)}
              >
                {beam.label}
              </button>
            );
          })}
        </div>
        {!state.views.length && (
          <div className="spatial-scene-empty">
            <span>空间还是空的。</span>
            <small>从目录打开文档，开始阅读。</small>
          </div>
        )}
      </div>
    </section>
  );
}
