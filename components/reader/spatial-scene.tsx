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
  ConnectionId,
  ConnectionRelation,
  DocumentRevision,
  DocumentSummary,
  RevisionId,
} from "../../lib/domain/model";
import type {
  CameraPose,
  ReadingPosition,
  SurfaceRole,
} from "../../lib/reader/attention";
import type {
  ConnectionActivation,
  DocumentRenderContext,
  PassageHandle,
  PresentationRequest,
  ReadingSurface,
  RelationNavigationState,
  SpatialSceneProps as ContractSpatialSceneProps,
  SurfaceInstanceId,
} from "../../lib/reader/spatial-contract";
import {
  buildRangeGeometry,
  polygonHits,
  polygonToPath,
  ruledSurface,
  type Point as GeometryPoint,
  type RangeEdge,
  type RangeGeometry,
  type RangeVisibility,
} from "../../lib/reader/range-geometry";
import type {
  EdgeLeaf,
  DocumentTarget,
  NeighborhoodKnowledge,
} from "../../lib/reader/space-index";
import {
  cameraTransform,
  constrainCameraPose,
  worldPoint,
  screenPoint,
  type WorldPoint,
  screenToWorld,
} from "../../lib/reader/camera";
import {
  projectSpaceEdges,
  resolveEdgeActivation,
} from "../../lib/reader/space-index";
import { relationNames as RELATION_LABELS } from "../../lib/reader/relations";
import { relationStyle } from "../../lib/reader/semantic-palette";
import {
  alignPaperReadingLines,
  interpolatePaperMotion,
  planScenePresentation,
  planSpacePresentation,
  compensateCameraForPaperReflow,
  paperRect,
  rangeScrollTarget,
  reconcileFocusScroll,
  type PaperPose,
  type PaperMotion,
} from "./scene-presentation";
import {
  SceneGeometry,
  projectScenePoints,
  type CachedAnchorGeometry,
} from "./scene-geometry";
import { SceneInteraction } from "./scene-interaction";
import {
  cameraForView,
  readingView,
  sameSpaceView,
  type SpaceView,
} from "../../lib/reader/space-view";
import "./spatial-scene.css";

export interface SpatialSceneController {
  resetCamera(): void;
  cancelInput(): void;
  measure(): void;
}

export type SpatialSceneProps = Omit<
  ContractSpatialSceneProps,
  "renderDocument" | "renderDocumentMenu"
> & {
  readonly controllerRef?: React.Ref<SpatialSceneController>;
  readonly renderDocument: (
    surface: ReadingSurface,
    role: SurfaceRole,
    context: DocumentRenderContext,
  ) => React.ReactNode;
  readonly renderDocumentMenu?: (
    surface: ReadingSurface,
    role: SurfaceRole,
  ) => React.ReactNode;
};

export type {
  ReadingSurface,
  ReturnLeaf,
  PendingSurface,
} from "../../lib/reader/spatial-contract";

type Point = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number };

type RetainedSurface = {
  surface: ReadingSurface;
  role: SurfaceRole;
  departing: boolean;
  departureAt: number;
  peripheralPosition: Point;
};
type EdgeBand = EdgeLeaf["band"];
type EdgeSlot = "left" | "right" | "top" | "bottom";

type EdgeItem = EdgeLeaf & {
  key: string;
  slot: EdgeSlot;
};

type EdgeGroup = {
  id: string;
  band: EdgeBand;
  slot: EdgeSlot;
  leaves: readonly EdgeItem[];
  index: number;
};

type Beam = {
  id: ConnectionId;
  relation: ConnectionRelation;
  label: string;
  endpointLabel: string;
  visibility: `${RangeVisibility}:${RangeVisibility}`;
  worldPolygon: readonly GeometryPoint[];
  worldRangeContours: readonly (readonly GeometryPoint[])[];
  selected: boolean;
  exact: boolean;
  path: string | null;
  /** Available free-space span for an identity caption, when two papers bound it. */
  labelGap: number | null;
  labelPoint: GeometryPoint;
  labelWorld: GeometryPoint;
  origin: ConnectionActivation["origin"];
};

type AnchorMeasurement = {
  readonly surfaceId: SurfaceInstanceId | null;
  readonly geometry: RangeGeometry;
  readonly worldContours: readonly (readonly GeometryPoint[])[];
};

type FanState = {
  readonly centerRevisionId: RevisionId | null;
  readonly groupId: string;
  readonly items: readonly EdgeItem[];
  readonly window: number;
};

type RelationMenuState = {
  readonly x: number;
  readonly y: number;
  readonly ids: readonly ConnectionId[];
};

type PreviewState = {
  readonly key: string;
  readonly item: EdgeItem;
  readonly document: DocumentRevision | null;
  readonly loading: boolean;
  readonly error: string | null;
};

type Pose = CameraPose;
const DESKTOP_FAN_LIMIT = 7;
const NARROW_FAN_LIMIT = 3;
const DESKTOP_BEAM_LIMIT = 48;
const NARROW_BEAM_LIMIT = 16;
const EMPTY_TARGETS: readonly EdgeItem[] = [];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function samePose(a: Pose, b: Pose): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.yaw === b.yaw &&
    a.pitch === b.pitch &&
    a.zoom === b.zoom
  );
}

function interpolate(a: Pose, b: Pose, amount: number): Pose {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
    yaw: a.yaw + (b.yaw - a.yaw) * amount,
    pitch: a.pitch + (b.pitch - a.pitch) * amount,
    zoom: a.zoom + (b.zoom - a.zoom) * amount,
  };
}

function easeAttention(amount: number): number {
  const n = 1 - amount;
  return 1 - n * n * n;
}

function edgeForPaper(
  paper: Rect | null,
  otherPaper: Rect | null,
  viewport: Rect,
): RangeEdge {
  if (!paper) return "right";
  const target = otherPaper ?? viewport;
  const paperCenter = {
    x: (paper.left + paper.right) / 2,
    y: (paper.top + paper.bottom) / 2,
  };
  const targetCenter = {
    x: (target.left + target.right) / 2,
    y: (target.top + target.bottom) / 2,
  };
  if (
    Math.abs(targetCenter.x - paperCenter.x) >=
    Math.abs(targetCenter.y - paperCenter.y)
  )
    return targetCenter.x >= paperCenter.x ? "right" : "left";
  return targetCenter.y >= paperCenter.y ? "bottom" : "top";
}

function endpointPoints(
  endpoint: NonNullable<RangeGeometry["endpoint"]>,
): readonly [Point, Point] {
  switch (endpoint.edge) {
    case "left":
    case "right":
      return [
        { x: endpoint.coordinate, y: endpoint.start },
        { x: endpoint.coordinate, y: endpoint.end },
      ];
    case "top":
    case "bottom":
      return [
        { x: endpoint.start, y: endpoint.coordinate },
        { x: endpoint.end, y: endpoint.coordinate },
      ];
  }
}

function worldPointForLocal(point: Point, viewport: DOMRect): GeometryPoint {
  return screenToWorld(
    screenPoint(point.x, point.y),
    { x: 0, y: 0, yaw: 0, pitch: 0, zoom: 1 },
    viewport,
  );
}

function toWorldPolygon(
  polygon: readonly GeometryPoint[],
  viewport: DOMRect,
): readonly GeometryPoint[] {
  return polygon.map((point) => worldPointForLocal(point, viewport));
}

function proxyAtPaperEdge(
  paper: Rect | null,
  clip: Rect,
  edge: RangeEdge,
): NonNullable<RangeGeometry["endpoint"]> {
  const span = Math.min(
    24,
    Math.max(
      12,
      edge === "left" || edge === "right"
        ? (clip.bottom - clip.top) * 0.08
        : (clip.right - clip.left) * 0.08,
    ),
  );
  const paperCenter = paper
    ? edge === "left" || edge === "right"
      ? (paper.top + paper.bottom) / 2
      : (paper.left + paper.right) / 2
    : edge === "left" || edge === "right"
      ? (clip.top + clip.bottom) / 2
      : (clip.left + clip.right) / 2;
  const center =
    edge === "left" || edge === "right"
      ? clamp(paperCenter, clip.top + span / 2, clip.bottom - span / 2)
      : clamp(paperCenter, clip.left + span / 2, clip.right - span / 2);
  const coordinate =
    edge === "left"
      ? clip.left
      : edge === "right"
        ? clip.right
        : edge === "top"
          ? clip.top
          : clip.bottom;
  return {
    edge,
    coordinate,
    start: center - span / 2,
    end: center + span / 2,
    precise: false,
    proxy: true,
  };
}

function slotForBand(band: EdgeBand): EdgeSlot {
  switch (band) {
    case "direct":
      return "left";
    case "second":
      return "right";
    case "archive":
      return "top";
    case "other":
      return "bottom";
  }
}

function bandLabel(band: EdgeBand): string {
  switch (band) {
    case "direct":
      return "相连文档";
    case "second":
      return "延伸阅读";
    case "archive":
      return "已归档";
    case "other":
      return "空间文档";
  }
}

function rangeStatusLabel(visibility: Beam["visibility"]): string {
  // Missing range or edge measurements do not establish that a relation is unavailable.
  if (visibility.includes("unavailable")) return "查看另一端";
  if (visibility.includes("peripheral")) return "展开原文";
  if (visibility.includes("unmounted-range")) return "范围待定位";
  if (visibility.includes("partial-range")) return "部分正文待定位";
  if (visibility.includes("offscreen-range")) return "定位范围";
  if (visibility.includes("clipped-range")) return "范围继续";
  return "阅读另一端";
}

function projectEdges(
  documents: readonly DocumentSummary[],
  knowledge: NeighborhoodKnowledge,
  excluded: readonly ReadingPosition[],
): readonly EdgeGroup[] {
  const items = projectSpaceEdges(documents, knowledge, excluded).map(
    (leaf: EdgeLeaf): EdgeItem => ({
      key: `${leaf.document.id}:${leaf.target.revisionId}`,
      document: leaf.document,
      target: leaf.target,
      band: leaf.band,
      slot: slotForBand(leaf.band),
      sequence: leaf.sequence,
      connectionId: leaf.connectionId,
      alternatives: leaf.alternatives,
    }),
  );

  const byBand = new Map<EdgeBand, EdgeItem[]>();
  for (const item of items) {
    const list = byBand.get(item.band) ?? [];
    list.push(item);
    byBand.set(item.band, list);
  }
  const groups: EdgeGroup[] = [];
  const groupSize = 24;
  for (const band of ["direct", "second", "other", "archive"] as const) {
    const leaves = byBand.get(band) ?? [];
    for (let start = 0; start < leaves.length; start += groupSize) {
      const index = groups.length;
      const slot = slotForBand(band);
      groups.push({
        id: `stack-${band}-${Math.floor(start / groupSize)}`,
        band,
        slot,
        leaves: leaves.slice(start, start + groupSize),
        index,
      });
    }
  }
  return groups;
}

function endpointLabel(
  fromDocument: { title: string; sequence: number | null },
  toDocument: { title: string; sequence: number | null },
): string {
  return `${fromDocument?.title ?? "文档"} v${fromDocument?.sequence ?? "?"} ↔ ${toDocument?.title ?? "文档"} v${toDocument?.sequence ?? "?"}`;
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function departurePosition(role: SurfaceRole, viewportWidth: number): Point {
  const distance = Math.max(900, viewportWidth + 720);
  return { x: role === "current" ? -distance : distance, y: 28 };
}

/**
 * Keep relation labels out of readable text.  A relation between two papers
 * gets its label in the gap; a relation whose anchors share one paper gets a
 * small label just outside that paper's nearest edge.  The resulting point is
 * cached in world coordinates, so camera-only motion never re-reads a Range.
 */
function beamLabelPoint(
  from: Point,
  to: Point,
  paperRects: readonly Rect[],
): Point {
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const fromPaper = paperRects.find((rect) => pointInRect(from, rect));
  const toPaper = paperRects.find((rect) => pointInRect(to, rect));

  if (fromPaper && toPaper && fromPaper !== toPaper) {
    if (fromPaper.right <= toPaper.left)
      return {
        x: (fromPaper.right + toPaper.left) / 2,
        y: midpoint.y,
      };
    if (toPaper.right <= fromPaper.left)
      return {
        x: (toPaper.right + fromPaper.left) / 2,
        y: midpoint.y,
      };
    if (fromPaper.bottom <= toPaper.top)
      return {
        x: midpoint.x,
        y: (fromPaper.bottom + toPaper.top) / 2,
      };
    if (toPaper.bottom <= fromPaper.top)
      return {
        x: midpoint.x,
        y: (toPaper.bottom + fromPaper.top) / 2,
      };
    return midpoint;
  }

  if (fromPaper && fromPaper === toPaper) {
    const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
    if (horizontal)
      return {
        x: to.x >= from.x ? fromPaper.right + 18 : fromPaper.left - 18,
        y: clamp(midpoint.y, fromPaper.top + 18, fromPaper.bottom - 18),
      };
    return {
      x: clamp(midpoint.x, fromPaper.left + 18, fromPaper.right - 18),
      y: to.y >= from.y ? fromPaper.bottom + 18 : fromPaper.top - 18,
    };
  }

  return midpoint;
}

function beamLabelGap(
  from: Point,
  to: Point,
  paperRects: readonly Rect[],
): number | null {
  const fromPaper = paperRects.find((rect) => pointInRect(from, rect));
  const toPaper = paperRects.find((rect) => pointInRect(to, rect));
  if (!fromPaper || !toPaper || fromPaper === toPaper) return null;
  if (fromPaper.right <= toPaper.left)
    return Math.max(0, toPaper.left - fromPaper.right);
  if (toPaper.right <= fromPaper.left)
    return Math.max(0, fromPaper.left - toPaper.right);
  if (fromPaper.bottom <= toPaper.top)
    return Math.max(0, toPaper.top - fromPaper.bottom);
  if (toPaper.bottom <= fromPaper.top)
    return Math.max(0, fromPaper.top - toPaper.bottom);
  return 0;
}

function isControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input,textarea,select,button,a,[role='button'],[contenteditable='true']",
    ),
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

interface SurfacePaperProps {
  surface: ReadingSurface;
  role: SurfaceRole;
  instanceKey: SurfaceInstanceId;
  position: PaperPose;
  paperWidth: number | null;
  paperMaxHeight: number | null;
  register: (key: SurfaceInstanceId, node: HTMLElement | null) => void;
  registerPassage: (
    surfaceId: SurfaceInstanceId,
    handle: PassageHandle | null,
  ) => void;
  onScroll: (
    surfaceId: SurfaceInstanceId,
    scrollTop: number,
    presentationId: number,
  ) => void;
  onLayoutDirty: () => void;
  onUserScroll: (surfaceId: SurfaceInstanceId) => void;
  onPromote: () => void;
  onFollow: (activation: ConnectionActivation) => void;
  onStepConnection: (direction: -1 | 1) => void;
  relationNavigation: RelationNavigationState;
  mobileHidden: boolean;
  departing: boolean;
  presentation: PresentationRequest;
  renderDocument: SpatialSceneProps["renderDocument"];
  renderDocumentMenu: SpatialSceneProps["renderDocumentMenu"];
  showVersion: boolean;
}

const SurfacePaper = React.memo(function SurfacePaper({
  surface,
  role,
  instanceKey,
  position,
  paperWidth,
  paperMaxHeight,
  register,
  registerPassage,
  onScroll,
  onLayoutDirty,
  onUserScroll,
  onPromote,
  onFollow,
  onStepConnection,
  relationNavigation,
  mobileHidden,
  departing,
  presentation,
  renderDocument,
  renderDocumentMenu,
  showVersion,
}: SurfacePaperProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [relationOpen, setRelationOpen] = useState(false);
  const relationTriggerRef = useRef<HTMLButtonElement>(null);
  const relationMenuRef = useRef<HTMLDivElement>(null);
  const closeRelationMenu = () => {
    setRelationOpen(false);
    relationTriggerRef.current?.focus({ preventScroll: true });
  };
  const followRelation = (activation: ConnectionActivation) => {
    closeRelationMenu();
    onFollow(activation);
  };
  useEffect(() => {
    if (relationOpen)
      relationMenuRef.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
  }, [relationOpen]);
  const scrollFrame = useRef<number | null>(null);
  const identity = instanceKey;
  const context = useMemo<DocumentRenderContext>(
    () => ({
      registerPassage: (handle) => registerPassage(surface.surfaceId, handle),
      onGeometryChange: onLayoutDirty,
    }),
    [onLayoutDirty, registerPassage, surface.surfaceId],
  );
  const content = useMemo(
    () => renderDocument(surface, role, context),
    [context, renderDocument, role, surface],
  );
  const documentMenu = useMemo(
    () => renderDocumentMenu?.(surface, role) ?? null,
    [renderDocumentMenu, role, surface],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onScrollEvent = () => {
      if (scrollFrame.current !== null) return;
      scrollFrame.current = window.requestAnimationFrame(() => {
        scrollFrame.current = null;
        onScroll(surface.surfaceId, node.scrollTop, presentation.id);
      });
    };
    node.addEventListener("scroll", onScrollEvent, { passive: true });
    return () => {
      node.removeEventListener("scroll", onScrollEvent);
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = null;
      }
    };
  }, [onLayoutDirty, onScroll, presentation.id, surface.surfaceId]);

  return (
    <article
      ref={(node) => register(identity, node)}
      className={`spatial-paper spatial-paper-${role} ${mobileHidden ? "is-mobile-hidden" : ""} ${departing ? "is-departing" : ""}`}
      data-hit-role="text"
      data-surface-key={identity}
      data-document-id={surface.position.documentId}
      data-revision-id={surface.position.revisionId}
      data-mobile-hidden={mobileHidden ? "true" : "false"}
      data-departing={departing ? "true" : "false"}
      aria-hidden={mobileHidden || departing || undefined}
      inert={mobileHidden || departing || undefined}
      onWheelCapture={() => onUserScroll(surface.surfaceId)}
      onTouchStartCapture={() => onUserScroll(surface.surfaceId)}
      onPointerDownCapture={(event) => {
        if ((event.target as Element).closest("[data-document-scroll]"))
          onUserScroll(surface.surfaceId);
      }}
      onKeyDownCapture={(event) => {
        if (
          [
            "ArrowUp",
            "ArrowDown",
            "PageUp",
            "PageDown",
            "Home",
            "End",
            " ",
          ].includes(event.key) &&
          !isControlTarget(event.target)
        )
          onUserScroll(surface.surfaceId);
      }}
      aria-label={`${surface.document.title}，v${surface.document.sequence}，${role === "current" ? "当前" : "旁读"}`}
      style={
        {
          "--paper-x": `${position.x}px`,
          "--paper-y": `${position.y}px`,
          "--paper-scale": position.scale,
          opacity: position.opacity,
          ...(paperWidth === null
            ? {}
            : { "--paper-width": `${paperWidth}px` }),
          ...(paperMaxHeight === null
            ? {}
            : { "--paper-max-height": `${paperMaxHeight}px` }),
        } as React.CSSProperties
      }
    >
      <header
        className={`spatial-paper-header spatial-paper-header-${role}`}
        data-hit-role="control"
        data-view-handle
        onKeyDown={(event) => {
          if (event.key === "Escape" && relationOpen) {
            event.preventDefault();
            event.stopPropagation();
            closeRelationMenu();
          }
        }}
      >
        <button
          type="button"
          className="spatial-paper-grip"
          data-paper-grip={surface.surfaceId}
          data-hit-role="paper-grip"
          aria-label={`移动纸页：${surface.document.title}`}
          title="移动纸页；Enter 开始键盘移动，方向键调整，Enter 确认，Escape 取消"
        >
          ⠿
        </button>
        <div className="spatial-paper-heading">
          <span className="spatial-paper-attention" aria-hidden="true" />
          <span className="spatial-paper-identity">
            {role === "current" ? "当前" : "旁读"}
          </span>
          <strong
            title={`${surface.document.title} · ${surface.document.path} · v${surface.document.sequence}`}
          >
            {surface.document.title}
          </strong>
          {showVersion && (
            <span className="spatial-paper-revision">
              v{surface.document.sequence}
            </span>
          )}
        </div>
        <div className="spatial-paper-actions">
          {role === "current" && (
            <button
              type="button"
              className="spatial-relation-trigger"
              ref={relationTriggerRef}
              data-hit-role="control"
              aria-expanded={relationOpen}
              aria-haspopup="menu"
              aria-label="关系导航"
              onClick={() => setRelationOpen((open) => !open)}
            >
              {relationNavigation.ordinal !== null
                ? `${relationNavigation.ordinal}/${relationNavigation.total}`
                : `关系 ${relationNavigation.total}`}
            </button>
          )}
          {role === "companion" && (
            <button
              type="button"
              className="spatial-paper-promote"
              data-hit-role="control"
              onClick={onPromote}
            >
              继续读这篇
            </button>
          )}
          {documentMenu}
          {role === "current" && relationOpen && (
            <div
              className="spatial-paper-relation-menu"
              ref={relationMenuRef}
              role="menu"
              onKeyDown={(event) => {
                if (
                  !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                )
                  return;
                const items = Array.from(
                  relationMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ) ?? [],
                );
                if (!items.length) return;
                event.preventDefault();
                event.stopPropagation();
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length;
                items[next]?.focus();
              }}
              data-hit-role="control"
            >
              <div className="spatial-paper-relation-summary">
                {relationNavigation.current
                  ? relationNavigation.current.label || "当前关系"
                  : relationNavigation.total
                    ? "选择一条关系"
                    : "当前纸页没有关系"}
              </div>
              <div className="spatial-paper-relation-actions">
                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    !relationNavigation.canPrevious ||
                    relationNavigation.loading
                  }
                  onClick={() => {
                    closeRelationMenu();
                    onStepConnection(-1);
                  }}
                >
                  上一条
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    !relationNavigation.canNext || relationNavigation.loading
                  }
                  onClick={() => {
                    closeRelationMenu();
                    onStepConnection(1);
                  }}
                >
                  下一条
                </button>
                {relationNavigation.current && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      followRelation({
                        connectionId: relationNavigation.current!.connectionId,
                        origin: {
                          kind: "surface",
                          surfaceId: surface.surfaceId,
                          endpoint: relationNavigation.current!.endpoint,
                        },
                      })
                    }
                  >
                    定位这条关系
                  </button>
                )}
              </div>
              {relationNavigation.items.length > 0 && (
                <div
                  className="spatial-paper-relation-list"
                  role="listbox"
                  aria-label="当前纸页的全部关系"
                >
                  {relationNavigation.items.map((item, index) => (
                    <button
                      key={`${item.connectionId}:${item.endpoint}`}
                      type="button"
                      role="option"
                      aria-selected={
                        relationNavigation.current?.connectionId ===
                          item.connectionId &&
                        relationNavigation.current.endpoint === item.endpoint
                      }
                      onClick={() =>
                        followRelation({
                          connectionId: item.connectionId,
                          origin: {
                            kind: "surface",
                            surfaceId: surface.surfaceId,
                            endpoint: item.endpoint,
                          },
                        })
                      }
                    >
                      <span>
                        {index + 1}. {item.label}
                      </span>
                      <small>
                        {item.endpoint === "from" ? "从此处出发" : "指向此处"}
                      </small>
                    </button>
                  ))}
                </div>
              )}
              {relationNavigation.loading && <small>正在读取关系</small>}
              {relationNavigation.error && (
                <small>{relationNavigation.error}</small>
              )}
            </div>
          )}
        </div>
      </header>
      <div
        ref={scrollRef}
        className="spatial-paper-scroll"
        data-document-scroll
        data-hit-role="text"
        tabIndex={0}
      >
        {content}
      </div>
    </article>
  );
});

interface EdgeShellProps {
  item: EdgeItem;
  index: number;
  register: (key: string, node: HTMLElement | null) => void;
  onActivate: (item: EdgeItem) => void;
  onReadBeside: (target: DocumentTarget) => void;
  onHover: (key: string | null) => void;
  onPreviewStart: (item: EdgeItem) => void;
  onPreviewEnd: () => void;
  hovered: boolean;
}

const EdgeShell = React.memo(function EdgeShell({
  item,
  index,
  register,
  onActivate,
  onReadBeside,
  onHover,
  onPreviewStart,
  onPreviewEnd,
  hovered,
}: EdgeShellProps) {
  const key = `edge:${item.key}`;
  const currentRevision = item.alternatives.find(
    (alternative) => alternative.revisionId === item.document.revisionId,
  );
  return (
    <article
      ref={(node) => register(key, node)}
      className={`spatial-edge-shell spatial-edge-shell-${item.slot} ${hovered ? "is-hovered" : ""}`}
      data-hit-role="document-affordance"
      data-document-id={item.document.id}
      data-revision-id={item.target.revisionId}
      data-edge-key={item.key}
      style={{ "--edge-index": index } as React.CSSProperties}
      onPointerEnter={() => {
        onHover(key);
        onPreviewStart(item);
      }}
      onPointerLeave={() => {
        onHover(null);
        onPreviewEnd();
      }}
      onFocus={() => {
        onHover(key);
        onPreviewStart(item);
      }}
      onBlur={(event) => {
        onHover(null);
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          onPreviewEnd();
      }}
      aria-label={`${item.document.title}，v${item.sequence}`}
    >
      <span className="spatial-edge-fold" aria-hidden="true" />
      <button
        type="button"
        className="spatial-edge-main"
        data-hit-role="document-affordance"
        onFocus={() => onHover(key)}
        onBlur={() => onHover(null)}
        onClick={() => onActivate(item)}
        onPointerEnter={() => onPreviewStart(item)}
        title={item.document.title}
        aria-label={`${item.document.title}，v${item.sequence}，${item.connectionId ? "跟随连接" : "旁读"}`}
      >
        <span className="spatial-edge-copy">
          <strong>{item.document.title}</strong>
          <small>
            v{item.sequence} · {bandLabel(item.band)}
          </small>
        </span>
      </button>
      {currentRevision && (
        <button
          type="button"
          className="spatial-edge-current-version"
          data-hit-role="document-affordance"
          onFocus={() => onHover(key)}
          onBlur={() => onHover(null)}
          onClick={() =>
            onReadBeside({
              documentId: item.document.id,
              revisionId: item.document.revisionId,
              focus: null,
            })
          }
          aria-label={`旁读${item.document.title}当前版本 v${item.document.sequence}`}
        >
          当前 v{item.document.sequence}
        </button>
      )}
    </article>
  );
});

interface StackRootProps {
  group: EdgeGroup;
  front: EdgeItem;
  complete: boolean;
  open: boolean;
  onToggle: () => void;
  onHover: (key: string | null) => void;
  hovered: boolean;
}

function StackRoot({
  group,
  front,
  complete,
  open,
  onToggle,
  onHover,
  hovered,
}: StackRootProps) {
  const unknown = !complete;
  return (
    <button
      type="button"
      className={`spatial-stack-root ${open ? "is-open" : ""} ${hovered ? "is-hovered" : ""}`}
      data-hit-role="document-affordance"
      data-stack-id={group.id}
      onClick={onToggle}
      onPointerEnter={() => onHover(group.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(group.id)}
      onBlur={() => onHover(null)}
      aria-expanded={open}
      title={front.document.title}
      aria-label={`${front.document.title}，${bandLabel(group.band)}折页，已载入 ${group.leaves.length} 份${unknown ? "，还有未载入成员" : ""}`}
    >
      <span className="spatial-stack-edges" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="spatial-stack-copy">
        <strong>{front.document.title}</strong>
        <small>
          {bandLabel(group.band)} · {group.leaves.length} 份
        </small>
      </span>
    </button>
  );
}

function Fan({
  items,
  group,
  start,
  limit,
  hovered,
  onActivate,
  onReadBeside,
  onHover,
  onPreviewStart,
  onPreviewEnd,
  onPrevious,
  onNext,
  onClose,
}: {
  items: readonly EdgeItem[];
  group: EdgeGroup;
  start: number;
  limit: number;
  hovered: string | null;
  onActivate: (item: EdgeItem) => void;
  onReadBeside: (target: DocumentTarget) => void;
  onHover: (key: string | null) => void;
  onPreviewStart: (item: EdgeItem) => void;
  onPreviewEnd: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const visible = items.slice(start, start + limit);
  const hasPrevious = start > 0;
  const hasNext = start + limit < items.length;
  return (
    <div
      className="spatial-fan"
      data-hit-role="document-affordance"
      aria-label="折页窗口"
    >
      <div className="spatial-fan-controls">
        <button
          type="button"
          onClick={onPrevious}
          disabled={!hasPrevious}
          aria-label="上一组折页"
        >
          ‹
        </button>
        <span>
          {start + 1}–{Math.min(items.length, start + limit)} / {items.length}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          aria-label="下一组折页"
        >
          ›
        </button>
        <button type="button" onClick={onClose} aria-label="收起折页">
          ×
        </button>
      </div>
      <div className="spatial-fan-leaves">
        {visible.map((item, index) => {
          const key = `fan:${group.id}:${item.key}`;
          const angle = (index - (visible.length - 1) / 2) * 4.2;
          const offset = (index - (visible.length - 1) / 2) * 28;
          const currentRevision = item.alternatives.find(
            (alternative) =>
              alternative.revisionId === item.document.revisionId,
          );
          return (
            <article
              key={key}
              className={`spatial-fan-leaf ${hovered === key ? "is-hovered" : ""}`}
              data-hit-role="document-affordance"
              data-document-id={item.document.id}
              data-revision-id={item.target.revisionId}
              style={
                {
                  "--fan-index": index,
                  "--fan-angle": `${angle}deg`,
                  "--fan-offset": `${offset}px`,
                } as React.CSSProperties
              }
              onPointerEnter={() => onHover(key)}
              onPointerLeave={() => {
                onHover(null);
                onPreviewEnd();
              }}
              onFocus={() => onPreviewStart(item)}
            >
              <span className="spatial-fan-fold" aria-hidden="true" />
              <button
                type="button"
                className="spatial-fan-primary"
                data-hit-role="document-affordance"
                onFocus={() => onHover(key)}
                onBlur={() => {
                  onHover(null);
                  onPreviewEnd();
                }}
                onClick={() => onActivate(item)}
                onPointerEnter={() => onPreviewStart(item)}
                title={item.document.title}
                aria-label={`${item.document.title}，v${item.sequence}，${item.connectionId ? "跟随连接" : "旁读"}`}
              >
                <strong>{item.document.title}</strong>
                <small>
                  v{item.sequence} · {bandLabel(item.band)}
                </small>
              </button>
              {currentRevision && (
                <button
                  type="button"
                  className="spatial-fan-current-version"
                  data-hit-role="document-affordance"
                  onFocus={() => onHover(key)}
                  onBlur={() => {
                    onHover(null);
                    onPreviewEnd();
                  }}
                  onClick={() =>
                    onReadBeside({
                      documentId: item.document.id,
                      revisionId: item.document.revisionId,
                      focus: null,
                    })
                  }
                  onPointerEnter={() => onPreviewStart(item)}
                  aria-label={`旁读${item.document.title}当前版本 v${item.document.sequence}`}
                >
                  旁读当前 v{item.document.sequence}
                </button>
              )}
              {item.alternatives.length > 0 && (
                <span className="spatial-fan-alternatives">
                  另有 {item.alternatives.length} 个版本
                </span>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function SpatialScene({
  current,
  companion,
  previous,
  view,
  documents,
  catalogue,
  neighborhood,
  connections,
  selectedConnectionId,
  pending,
  onReadBeside,
  onPromote,
  onFollow,
  onStepConnection,
  relationNavigation,
  presentation,
  onHistory,
  onScroll,
  onViewCheckpoint,
  onReturnToReading,
  renderDocument,
  renderDocumentMenu,
  loadPreview,
  controllerRef,
}: SpatialSceneProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const surfaceNodes = useRef(new Map<SurfaceInstanceId, HTMLElement>());
  const passageHandles = useRef(new Map<SurfaceInstanceId, PassageHandle>());
  const edgeNodes = useRef(new Map<string, HTMLElement>());
  const selectedEndpoint = relationNavigation.current?.endpoint;
  const inputRef = useRef({
    current,
    companion,
    previous,
    connections,
    selectedConnectionId,
    selectedEndpoint,
    documents,
    neighborhood,
  });
  useLayoutEffect(() => {
    inputRef.current = {
      current,
      companion,
      previous,
      connections,
      selectedConnectionId,
      selectedEndpoint,
      documents,
      neighborhood,
    };
  }, [
    current,
    companion,
    previous,
    connections,
    selectedConnectionId,
    selectedEndpoint,
    documents,
    neighborhood,
  ]);
  const liveView = useRef(view);
  const renderedLayoutKey = useRef("");
  const livePose = useRef<Pose>(cameraForView(view));
  const targetPose = useRef<Pose>(cameraForView(view));
  const [interaction] = useState(() => new SceneInteraction());
  const [draftKind, setDraftKind] = useState<SpaceView["kind"] | null>(null);
  const viewKind = draftKind ?? view.kind;
  const zoomInput = useRef<HTMLInputElement>(null);
  const paperMotionPose = useRef<PaperMotion>(new Map());
  const paperTargets = useRef<PaperMotion>(new Map());
  const sceneGeometry = useRef(new SceneGeometry());
  const rebuildBeamGeometry = useRef<(() => void) | null>(null);
  const presentationFrame = useRef<number | null>(null);
  const presentationScheduleFrame = useRef<number | null>(null);
  const presentationGeneration = useRef(0);
  const presentationPending = useRef<{
    camera: Pose;
    paper: PaperMotion;
    scroll: ReadonlyMap<SurfaceInstanceId, number>;
    duration: number;
  } | null>(null);
  const initialScrollTargets = useRef(new Map<SurfaceInstanceId, number>());
  const interruptedScroll = useRef(new Set<SurfaceInstanceId>());
  const handledPresentationId = useRef<number | null>(null);
  const activePresentationScrollTargets = useRef(
    new Map<SurfaceInstanceId, number>(),
  );
  const programmaticScroll = useRef(
    new Map<SurfaceInstanceId, { presentationId: number; target: number }>(),
  );
  const [fan, setFan] = useState<FanState | null>(null);
  const [groupPage, setGroupPage] = useState(0);
  const [relationMenu, setRelationMenu] = useState<RelationMenuState | null>(
    null,
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [hoveredState, setHoveredState] = useState<{
    readonly key: string;
    readonly centerRevisionId: RevisionId | null;
  } | null>(null);
  const [selectionActive, setSelectionActive] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const previewTimer = useRef<number | null>(null);
  const previewCloseTimer = useRef<number | null>(null);
  const previewRequest = useRef(0);
  const [beams, setBeams] = useState<readonly Beam[]>([]);
  const [hoveredBeamId, setHoveredBeamId] = useState<ConnectionId | null>(null);
  const [beamLabelWidths, setBeamLabelWidths] = useState<
    Readonly<Record<string, number>>
  >({});
  const beamWorldCache = useRef<readonly Beam[]>([]);
  const beamDescriptors = useRef<readonly Beam[]>([]);
  const cameraMoving = useRef(false);
  const beamPathNodes = useRef(new Map<ConnectionId, SVGPathElement>());
  const beamRangeNodes = useRef(new Map<string, SVGPathElement>());
  const beamPaperEdgeLabelNodes = useRef(
    new Map<ConnectionId, SVGTextElement>(),
  );
  const beamLabelNodes = useRef(new Map<ConnectionId, HTMLButtonElement>());
  const viewportSize = useRef<{ width: number; height: number } | null>(null);
  const measureFrame = useRef<number | null>(null);
  const scheduleMeasureRef = useRef<(() => void) | null>(null);
  const reducedMotion = useReducedMotion();
  const [narrow, setNarrow] = useState(false);

  const [sceneSize, setSceneSize] = useState({ width: 0, height: 0 });
  const hasCompanion = companion !== null;
  const sceneLayout = useMemo(() => {
    return planScenePresentation(
      sceneSize.width,
      sceneSize.height,
      hasCompanion,
    );
  }, [hasCompanion, sceneSize.height, sceneSize.width]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const measured: Record<string, number> = {};
      for (const beam of beams) {
        const node = beamLabelNodes.current.get(beam.id);
        const width = node?.getBoundingClientRect().width ?? 0;
        if (width > 0) {
          measured[beam.id] = Math.ceil(width);
          node!.dataset.measuredWidth = String(Math.ceil(width));
        }
      }
      setBeamLabelWidths((previous) => {
        const previousKeys = Object.keys(previous);
        const measuredKeys = Object.keys(measured);
        if (
          previousKeys.length === measuredKeys.length &&
          measuredKeys.every((key) => previous[key] === measured[key])
        )
          return previous;
        return measured;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [beams, hoveredBeamId, sceneSize.height, sceneSize.width]);
  const retainedSurfaceMap = useRef(
    new Map<SurfaceInstanceId, RetainedSurface>(),
  );
  const [retainedSurfaceVersion, setRetainedSurfaceVersion] = useState(0);

  useEffect(() => {
    const update = () => {
      const node = viewportRef.current;
      const width = node?.clientWidth ?? window.innerWidth;
      const height = node?.clientHeight ?? window.innerHeight;
      viewportSize.current = { width, height };
      setNarrow(width <= 620);
      setSceneSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (viewportRef.current) observer?.observe(viewportRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const registerSurface = useCallback(
    (key: SurfaceInstanceId, node: HTMLElement | null) => {
      if (node) surfaceNodes.current.set(key, node);
      else surfaceNodes.current.delete(key);
    },
    [],
  );
  const registerPassage = useCallback(
    (surfaceId: SurfaceInstanceId, handle: PassageHandle | null) => {
      if (handle) passageHandles.current.set(surfaceId, handle);
      else passageHandles.current.delete(surfaceId);
      sceneGeometry.current.invalidate();
      window.requestAnimationFrame(() => scheduleMeasureRef.current?.());
    },
    [],
  );
  const registerEdge = useCallback((key: string, node: HTMLElement | null) => {
    if (node) edgeNodes.current.set(key, node);
    else edgeNodes.current.delete(key);
  }, []);

  const setCameraMoving = useCallback((moving: boolean) => {
    if (cameraMoving.current === moving) return;
    cameraMoving.current = moving;
    viewportRef.current?.classList.toggle("is-camera-moving", moving);
  }, []);

  const renderCachedBeams = useCallback(() => {
    // The viewport dimensions are refreshed by the layout measurement pass.
    // Camera-only frames reuse them and therefore never read a Range or DOM
    // rect while the pointer is moving.
    const viewport = viewportSize.current;
    if (!viewport) return;
    rebuildBeamGeometry.current?.();
    for (const beam of beamWorldCache.current) {
      const polygon = projectScenePoints(
        beam.worldPolygon,
        livePose.current,
        viewport,
      );
      beamPathNodes.current
        .get(beam.id)
        ?.setAttribute("d", polygonToPath(polygon));
      beam.worldRangeContours.forEach((contour, index) => {
        const projected = projectScenePoints(
          contour,
          livePose.current,
          viewport,
        );
        beamRangeNodes.current
          .get(`${beam.id}:${index}`)
          ?.setAttribute("d", polygonToPath(projected));
      });
      const labelScreen = projectScenePoints(
        [beam.labelWorld],
        livePose.current,
        viewport,
      )[0];
      const paperEdgeLabel = beamPaperEdgeLabelNodes.current.get(beam.id);
      const label = beamLabelNodes.current.get(beam.id);
      if (paperEdgeLabel)
        paperEdgeLabel.style.visibility = labelScreen ? "" : "hidden";
      if (label) label.style.visibility = labelScreen ? "" : "hidden";
      if (!labelScreen) continue;
      if (paperEdgeLabel) {
        paperEdgeLabel.setAttribute("x", `${labelScreen.x}`);
        paperEdgeLabel.setAttribute("y", `${labelScreen.y - 8}`);
      }
      if (label) {
        const width = Number(label.dataset.measuredWidth ?? 0);
        label.classList.toggle(
          "is-omitted",
          beam.labelGap !== null &&
            width + 12 > beam.labelGap * livePose.current.zoom,
        );
        label.style.transform = `translate3d(${labelScreen.x}px, ${labelScreen.y}px, 0) translate(-50%, -50%)`;
      }
    }
  }, []);

  const beginCameraMotion = useCallback(() => {
    setCameraMoving(true);
  }, [setCameraMoving]);

  const settleCameraMotion = useCallback(() => {
    setCameraMoving(false);
    renderCachedBeams();
  }, [renderCachedBeams, setCameraMoving]);

  const cancelPresentationClock = useCallback(() => {
    presentationGeneration.current += 1;
    if (presentationFrame.current !== null) {
      window.cancelAnimationFrame(presentationFrame.current);
      presentationFrame.current = null;
    }
    if (presentationScheduleFrame.current !== null) {
      window.cancelAnimationFrame(presentationScheduleFrame.current);
      presentationScheduleFrame.current = null;
    }
    presentationPending.current = null;
    programmaticScroll.current.clear();
    activePresentationScrollTargets.current.clear();
  }, []);

  const writePaperMotion = useCallback((poses: PaperMotion) => {
    paperMotionPose.current = poses;
    for (const [id, pose] of poses) {
      const node = surfaceNodes.current.get(id);
      if (!node) continue;
      node.style.setProperty("--paper-x", `${pose.x}px`);
      node.style.setProperty("--paper-y", `${pose.y}px`);
      node.style.setProperty("--paper-scale", String(pose.scale));
      node.style.opacity = String(pose.opacity);
    }
  }, []);

  const currentSurfaceId = current?.surfaceId;
  const companionSurfaceId = companion?.surfaceId;
  const resolveViewPapers = useCallback(
    (value: SpaceView): PaperMotion => {
      if (!currentSurfaceId) return new Map();
      const measurement = (id: SurfaceInstanceId, fallbackWidth: number) => ({
        surfaceId: id,
        width: sceneGeometry.current.layouts.get(id)?.width ?? fallbackWidth,
        height:
          sceneGeometry.current.layouts.get(id)?.height ??
          sceneLayout.paperMaxHeight,
      });
      const plan = planSpacePresentation({
        width: sceneSize.width,
        height: sceneSize.height,
        view: value,
        current: measurement(currentSurfaceId, sceneLayout.paperWidth),
        companion: companionSurfaceId
          ? measurement(
              companionSurfaceId,
              sceneLayout.companionWidth ?? sceneLayout.paperWidth,
            )
          : null,
      });
      return value.kind === "reading" && sceneLayout.framing.kind === "paired"
        ? alignPaperReadingLines(
            plan.poses,
            sceneGeometry.current.layouts,
            currentSurfaceId,
            sceneLayout.paperMaxHeight,
          )
        : plan.poses;
    },
    [
      currentSurfaceId,
      companionSurfaceId,
      sceneLayout,
      sceneSize.width,
      sceneSize.height,
    ],
  );

  const paperCorners = useCallback(
    (poses: PaperMotion): readonly WorldPoint[] => {
      const corners: WorldPoint[] = [];
      for (const surfaceId of [currentSurfaceId, companionSurfaceId]) {
        if (!surfaceId) continue;
        const pose = poses.get(surfaceId);
        const layout = sceneGeometry.current.layouts.get(surfaceId);
        if (!pose || !layout) continue;
        for (const x of [-layout.width / 2, layout.width / 2])
          for (const y of [-layout.height / 2, layout.height / 2])
            corners.push(
              worldPoint(pose.x + x * pose.scale, pose.y + y * pose.scale),
            );
      }
      return corners;
    },
    [currentSurfaceId, companionSurfaceId],
  );

  const paintView = useCallback(
    (value: SpaceView) => {
      const poses = resolveViewPapers(value);
      const camera = constrainCameraPose(
        cameraForView(value),
        livePose.current,
        { safetyCorners: paperCorners(poses) },
      );
      liveView.current = value.kind === "free" ? { ...value, camera } : value;
      livePose.current = camera;
      targetPose.current = camera;
      paperTargets.current = poses;
      writePaperMotion(poses);
      if (worldRef.current)
        worldRef.current.style.transform = cameraTransform(camera);
      if (zoomInput.current)
        zoomInput.current.value = String(Math.round(camera.zoom * 100));
      setDraftKind(value.kind);
      setCameraMoving(true);
      renderCachedBeams();
    },
    [
      paperCorners,
      renderCachedBeams,
      resolveViewPapers,
      setCameraMoving,
      writePaperMotion,
    ],
  );

  useLayoutEffect(() => {
    interaction.configure({
      context: () => ({
        generation: presentation.id,
        view,
        viewport: viewportSize.current ?? sceneSize,
        offset: sceneGeometry.current.viewportOffset,
        element: viewportRef.current,
      }),
      enterFree: () => {
        if (liveView.current.kind === "free")
          return { ...liveView.current, camera: livePose.current };
        const next: Extract<SpaceView, { kind: "free" }> = {
          kind: "free",
          camera: livePose.current,
          placements: new Map(),
        };
        const nextPapers = resolveViewPapers(next);
        const visibleId =
          view.kind === "reading"
            ? (view.exposedSurfaceId ?? current?.surfaceId)
            : current?.surfaceId;
        const before = visibleId
          ? paperMotionPose.current.get(visibleId)
          : null;
        const after = visibleId ? nextPapers.get(visibleId) : null;
        let camera =
          before && after
            ? compensateCameraForPaperReflow(
                livePose.current,
                worldPoint(before.x, before.y),
                worldPoint(after.x, after.y),
              )
            : livePose.current;
        if (before && after && before.scale > 0 && before.scale !== 1) {
          camera = {
            ...camera,
            x: after.x + (livePose.current.x - before.x) / before.scale,
            y: after.y + (livePose.current.y - before.y) / before.scale,
            zoom: livePose.current.zoom * before.scale,
          };
        }
        return {
          ...next,
          camera: constrainCameraPose(camera, livePose.current, {
            safetyCorners: paperCorners(nextPapers),
          }),
        };
      },
      center: (value, id) => {
        const pose = resolveViewPapers(value).get(id);
        return worldPoint(pose?.x ?? 0, pose?.y ?? 0);
      },
      corners: (value) => paperCorners(resolveViewPapers(value)),
      stopPresentation: cancelPresentationClock,
      paint: paintView,
      checkpoint: onViewCheckpoint,
      settled: () => {
        setDraftKind(null);
        settleCameraMotion();
      },
    });
  });

  useLayoutEffect(() => {
    interaction.synchronize();
  }, [interaction, presentation.id, sceneSize.width, sceneSize.height]);

  const startPresentationClock = useCallback(
    (pending: {
      camera: Pose;
      paper: PaperMotion;
      scroll: ReadonlyMap<SurfaceInstanceId, number>;
      duration: number;
    }) => {
      presentationGeneration.current += 1;
      const generation = presentationGeneration.current;
      if (presentationFrame.current !== null)
        window.cancelAnimationFrame(presentationFrame.current);
      const fromCamera = livePose.current;
      const fromPaper = paperMotionPose.current;
      const scrollStarts = new Map<SurfaceInstanceId, number>();
      for (const surfaceId of pending.scroll.keys()) {
        const scroll = surfaceNodes.current
          .get(surfaceId)
          ?.querySelector<HTMLElement>("[data-document-scroll]");
        if (scroll) scrollStarts.set(surfaceId, scroll.scrollTop);
      }
      activePresentationScrollTargets.current = new Map(pending.scroll);
      targetPose.current = pending.camera;
      const started = performance.now();
      const finish = () => {
        presentationFrame.current = null;
        if (generation !== presentationGeneration.current) return;
        const finalScrollTargets = new Map(
          activePresentationScrollTargets.current,
        );
        livePose.current = constrainCameraPose(
          pending.camera,
          livePose.current,
          { safetyCorners: paperCorners(pending.paper) },
        );
        writePaperMotion(pending.paper);
        if (worldRef.current)
          worldRef.current.style.transform = cameraTransform(livePose.current);

        for (const [surfaceId, target] of finalScrollTargets) {
          const scroll = surfaceNodes.current
            .get(surfaceId)
            ?.querySelector<HTMLElement>("[data-document-scroll]");
          if (!scroll) continue;
          scroll.scrollTop = target;
          programmaticScroll.current.set(surfaceId, {
            presentationId: presentation.id,
            target: scroll.scrollTop,
          });
        }
        activePresentationScrollTargets.current.clear();
        if (finalScrollTargets.size) scheduleMeasureRef.current?.();
        renderCachedBeams();
        settleCameraMotion();
        let removed = false;
        for (const [id, retained] of retainedSurfaceMap.current) {
          if (!retained.departing) continue;
          retainedSurfaceMap.current.delete(id);
          sceneGeometry.current.layouts.delete(id);
          removed = true;
        }
        if (removed) setRetainedSurfaceVersion((version) => version + 1);
      };
      if (
        reducedMotion ||
        (samePose(fromCamera, pending.camera) &&
          fromPaper === pending.paper &&
          scrollStarts.size === 0)
      ) {
        finish();
        return;
      }
      beginCameraMotion();
      const frame = (now: number) => {
        if (generation !== presentationGeneration.current) return;
        const amount = clamp((now - started) / pending.duration, 0, 1);
        const eased = easeAttention(amount);
        const requestedCamera = interpolate(fromCamera, pending.camera, eased);
        const paper = interpolatePaperMotion(fromPaper, pending.paper, eased);
        const camera = constrainCameraPose(requestedCamera, livePose.current, {
          safetyCorners: paperCorners(paper),
        });
        livePose.current = camera;
        writePaperMotion(paper);
        if (worldRef.current)
          worldRef.current.style.transform = cameraTransform(camera);

        for (const [
          surfaceId,
          target,
        ] of activePresentationScrollTargets.current) {
          const scroll = surfaceNodes.current
            .get(surfaceId)
            ?.querySelector<HTMLElement>("[data-document-scroll]");
          const start = scrollStarts.get(surfaceId);
          if (!scroll || start === undefined) continue;
          const value = start + (target - start) * eased;
          scroll.scrollTop = value;
          programmaticScroll.current.set(surfaceId, {
            presentationId: presentation.id,
            target: scroll.scrollTop,
          });
        }
        renderCachedBeams();
        if (amount < 1)
          presentationFrame.current = window.requestAnimationFrame(frame);
        else finish();
      };
      presentationFrame.current = window.requestAnimationFrame(frame);
    },
    [
      beginCameraMotion,
      paperCorners,
      presentation.id,
      reducedMotion,
      renderCachedBeams,
      settleCameraMotion,
      writePaperMotion,
    ],
  );

  const requestPresentation = useCallback(
    (
      cameraTarget?: Pose,
      paperTarget?: PaperMotion,
      scrollTargets?: ReadonlyMap<SurfaceInstanceId, number>,
      duration = 400,
    ) => {
      if (interaction.active) return;
      if (!presentationPending.current) {
        const continuedScroll = new Map(
          activePresentationScrollTargets.current,
        );
        cancelPresentationClock();
        presentationPending.current = {
          camera: cameraTarget ?? targetPose.current,
          paper: paperTarget ?? paperTargets.current,
          scroll: new Map(scrollTargets ?? continuedScroll),
          duration,
        };
      } else {
        const pending = presentationPending.current;
        if (cameraTarget) pending.camera = cameraTarget;
        if (paperTarget) pending.paper = paperTarget;
        if (scrollTargets) pending.scroll = new Map(scrollTargets);
        pending.duration = Math.max(pending.duration, duration);
      }
      if (presentationScheduleFrame.current !== null) return;
      presentationScheduleFrame.current = window.requestAnimationFrame(() => {
        presentationScheduleFrame.current = null;
        const pending = presentationPending.current;
        presentationPending.current = null;
        if (pending) startPresentationClock(pending);
      });
    },
    [cancelPresentationClock, startPresentationClock, interaction],
  );

  const measureBeams = useCallback(
    (layoutPass = true) => {
      const viewportNode = viewportRef.current;
      if (!viewportNode) return;
      const worldNode = worldRef.current;
      const viewport = layoutPass
        ? viewportNode.getBoundingClientRect()
        : ({
            ...viewportSize.current!,
            left: 0,
            top: 0,
          } as DOMRect);
      if (!viewport.width || !viewport.height) return;
      const viewportLocal: Rect = {
        left: 0,
        top: 0,
        right: viewport.width,
        bottom: viewport.height,
      };
      const restoreLayout = layoutPass
        ? sceneGeometry.current.measureLayout(
            viewport,
            worldNode,
            surfaceNodes.current,
            edgeNodes.current,
          )
        : () => {};
      const previousMeasurements = sceneGeometry.current.rangeMeasurements;
      try {
        if (layoutPass)
          viewportSize.current = {
            width: viewport.width,
            height: viewport.height,
          };
        const surfaceEntries = [
          inputRef.current.current,
          inputRef.current.companion,
        ].filter((surface): surface is ReadingSurface => Boolean(surface));
        const paperBySurface = new Map<SurfaceInstanceId, Rect>();
        for (const surface of surfaceEntries) {
          const layout = sceneGeometry.current.layouts.get(surface.surfaceId);
          const pose = paperMotionPose.current.get(surface.surfaceId);
          if (layout && pose)
            paperBySurface.set(
              surface.surfaceId,
              paperRect(layout, pose, viewport),
            );
        }

        const cachedAnchor = (
          surface: ReadingSurface,
          anchor: Anchor,
        ): CachedAnchorGeometry | undefined => {
          return sceneGeometry.current.resolveAnchor(
            surface.surfaceId,
            anchor,
            passageHandles.current.get(surface.surfaceId),
            surfaceNodes.current
              .get(surface.surfaceId)
              ?.querySelector<HTMLElement>("[data-document-scroll]"),
            layoutPass,
          );
        };
        const alignmentTargets = new Map<SurfaceInstanceId, number>();
        let correctedPaperTargets: PaperMotion | undefined;
        if (
          layoutPass &&
          liveView.current.kind === "reading" &&
          sceneLayout.framing.kind === "paired"
        ) {
          const aligned = alignPaperReadingLines(
            paperTargets.current,
            sceneGeometry.current.layouts,
            inputRef.current.current?.surfaceId,
            sceneLayout.paperMaxHeight,
          );
          if (aligned !== paperTargets.current) {
            paperTargets.current = aligned;
            correctedPaperTargets = aligned;
          }
        }
        if (
          layoutPass &&
          !interaction.active &&
          liveView.current.kind === "free"
        ) {
          const resolved = resolveViewPapers(liveView.current);
          if (
            [...resolved].some(([id, pose]) => {
              const previous = paperTargets.current.get(id);
              return (
                !previous || previous.x !== pose.x || previous.y !== pose.y
              );
            })
          ) {
            paperTargets.current = resolved;
            correctedPaperTargets = resolved;
          }
        }
        if (
          layoutPass &&
          !interaction.active &&
          liveView.current.kind === "reading" &&
          presentation.kind === "align-ranges"
        ) {
          for (const surface of surfaceEntries) {
            if (
              !presentation.surfaces.includes(surface.surfaceId) ||
              !surface.position.focus ||
              interruptedScroll.current.has(surface.surfaceId)
            )
              continue;
            const layout = sceneGeometry.current.layouts.get(surface.surfaceId);
            const cached = cachedAnchor(surface, {
              ...surface.position.focus,
              documentId: surface.position.documentId,
              revisionId: surface.position.revisionId,
            } as Anchor);
            if (!layout || !cached?.fragments.length) continue;
            const height = layout.scroll.bottom - layout.scroll.top;
            const top = Math.min(...cached.fragments.map((part) => part.top));
            const bottom = Math.max(
              ...cached.fragments.map((part) => part.bottom),
            );
            alignmentTargets.set(
              surface.surfaceId,
              rangeScrollTarget(
                top,
                bottom,
                cached.coverage === "complete",
                height,
                layout.maxScroll,
              ),
            );
          }
        }

        const measureAnchor = (
          anchor: Anchor,
          preferredSurfaceId?: SurfaceInstanceId,
        ): AnchorMeasurement => {
          const surface =
            surfaceEntries.find(
              (candidate) =>
                candidate.surfaceId === preferredSurfaceId &&
                candidate.position.documentId === anchor.documentId &&
                candidate.position.revisionId === anchor.revisionId,
            ) ??
            surfaceEntries.find(
              (candidate) =>
                candidate.position.documentId === anchor.documentId &&
                candidate.position.revisionId === anchor.revisionId,
            );
          const paper = surface
            ? (paperBySurface.get(surface.surfaceId) ?? null)
            : null;
          const otherPaper = surface
            ? (surfaceEntries
                .filter(
                  (candidate) => candidate.surfaceId !== surface.surfaceId,
                )
                .map(
                  (candidate) =>
                    paperBySurface.get(candidate.surfaceId) ?? null,
                )
                .find((candidate): candidate is Rect => Boolean(candidate)) ??
              null)
            : null;
          const edge = edgeForPaper(paper, otherPaper, viewportLocal);
          const node = surface
            ? surfaceNodes.current.get(surface.surfaceId)
            : null;
          const mobileHidden = node?.dataset.mobileHidden === "true";
          const scroll = node?.querySelector<HTMLElement>(
            "[data-document-scroll]",
          );
          const layout =
            surface && sceneGeometry.current.layouts.get(surface.surfaceId);
          const pose =
            surface && paperMotionPose.current.get(surface.surfaceId);
          const scrollLocal =
            layout && pose && paper
              ? {
                  left: paper.left + layout.scroll.left * pose.scale,
                  top: paper.top + layout.scroll.top * pose.scale,
                  right: paper.left + layout.scroll.right * pose.scale,
                  bottom: paper.top + layout.scroll.bottom * pose.scale,
                }
              : viewportLocal;
          // Clip content to its paper before projection. A paper outside the
          // neutral viewport can still be visible through the live camera.
          const clip = scrollLocal;
          const proxy = proxyAtPaperEdge(paper, clip, edge);
          const handle = surface
            ? passageHandles.current.get(surface.surfaceId)
            : undefined;
          let geometry: RangeGeometry;
          if (surface && handle) {
            const cached = cachedAnchor(surface, anchor) ?? {
              coverage: "unmounted" as const,
              missing: [],
              fragments: [],
            };
            const scale = pose?.scale ?? 1;
            const rangeFragments = cached.fragments.map((fragment) => ({
              left:
                (fragment.left - (scroll?.scrollLeft ?? 0)) * scale +
                scrollLocal.left,
              top:
                (fragment.top - (scroll?.scrollTop ?? 0)) * scale +
                scrollLocal.top,
              right:
                (fragment.right - (scroll?.scrollLeft ?? 0)) * scale +
                scrollLocal.left,
              bottom:
                (fragment.bottom - (scroll?.scrollTop ?? 0)) * scale +
                scrollLocal.top,
            }));
            geometry = buildRangeGeometry({
              coverage: cached.coverage,
              missing: cached.missing,
              ranges: rangeFragments,
              clip,
              edge,
              peripheral: mobileHidden,
              proxy,
            });
          } else if (surface) {
            geometry = buildRangeGeometry({
              coverage: "unmounted",
              ranges: [],
              clip,
              edge,
              peripheral: mobileHidden,
              proxy,
            });
          } else {
            const edgeEntry = [...edgeNodes.current.entries()].find(
              ([, candidate]) =>
                candidate.dataset.documentId === anchor.documentId &&
                candidate.dataset.revisionId === anchor.revisionId,
            );
            const edgePaper =
              edgeEntry && sceneGeometry.current.edgeRects.get(edgeEntry[0]);
            if (edgePaper) {
              geometry = buildRangeGeometry({
                coverage: "unmounted",
                ranges: [],
                clip: viewportLocal,
                edge: edgeForPaper(edgePaper, null, viewportLocal),
                peripheral: true,
                proxy: proxyAtPaperEdge(
                  edgePaper,
                  viewportLocal,
                  edgeForPaper(edgePaper, null, viewportLocal),
                ),
              });
            } else {
              geometry = buildRangeGeometry({
                coverage: "unmapped",
                unavailable: true,
                ranges: [],
                clip: viewportLocal,
                edge,
                proxy: proxyAtPaperEdge(null, viewportLocal, edge),
              });
            }
          }
          return {
            surfaceId: surface?.surfaceId ?? null,
            geometry,
            worldContours: geometry.contours.map((contour) =>
              toWorldPolygon(contour, viewport),
            ),
          };
        };

        const paperRects = [...paperBySurface.values()];
        const labelFor = (anchor: Anchor) => {
          const mounted = surfaceEntries.find(
            (surface) => surface.position.revisionId === anchor.revisionId,
          )?.document;
          if (mounted) return mounted;
          const knowledge = inputRef.current.neighborhood;
          const known =
            knowledge.kind === "idle"
              ? undefined
              : knowledge.nodes.find(
                  (node) => node.revisionId === anchor.revisionId,
                );
          if (known)
            return { title: known.document.title, sequence: known.sequence };
          const metadata = inputRef.current.documents.find(
            (doc) => doc.id === anchor.documentId,
          );
          return {
            title: metadata?.title ?? "文档",
            sequence:
              metadata?.revisionId === anchor.revisionId
                ? metadata.sequence
                : null,
          };
        };
        // Each connection owns one animated path and one set of range contours.
        const candidateConnections = Array.from(
          new Map(
            inputRef.current.connections.map((connection) => [
              connection.id,
              connection,
            ]),
          ).values(),
        ).sort((left, right) => {
          const leftStart = Math.min(left.from.start, left.to.start);
          const rightStart = Math.min(right.from.start, right.to.start);
          return leftStart - rightStart || left.id.localeCompare(right.id);
        });
        const limit = narrow ? NARROW_BEAM_LIMIT : DESKTOP_BEAM_LIMIT;
        const selected = candidateConnections.filter(
          (connection) =>
            connection.id === inputRef.current.selectedConnectionId,
        );
        const unselected = candidateConnections.filter(
          (connection) =>
            connection.id !== inputRef.current.selectedConnectionId,
        );
        const measured: Beam[] = [];
        const selectedCount = Math.min(selected.length, limit);
        // Inactive relationships retain their passage marks and handles.  A
        // filled surface is reserved for the selected relationship so it
        // cannot obscure unrelated prose or look like a complete proxy.
        const drawConnections = [
          ...unselected.slice(0, Math.max(0, limit - selectedCount)),
          ...selected.slice(0, selectedCount),
        ];
        for (const connection of drawConnections) {
          const sameRevisionOccurrence =
            inputRef.current.current &&
            inputRef.current.companion &&
            inputRef.current.current.position.documentId ===
              connection.from.documentId &&
            inputRef.current.current.position.revisionId ===
              connection.from.revisionId &&
            inputRef.current.companion.position.documentId ===
              connection.to.documentId &&
            inputRef.current.companion.position.revisionId ===
              connection.to.revisionId;
          const reversedOccurrences =
            connection.id === inputRef.current.selectedConnectionId &&
            inputRef.current.selectedEndpoint === "to";
          const from = measureAnchor(
            connection.from,
            sameRevisionOccurrence
              ? (reversedOccurrences
                  ? inputRef.current.companion
                  : inputRef.current.current
                )?.surfaceId
              : undefined,
          );
          const to = measureAnchor(
            connection.to,
            sameRevisionOccurrence
              ? (reversedOccurrences
                  ? inputRef.current.current
                  : inputRef.current.companion
                )?.surfaceId
              : undefined,
          );
          const fromEndpoint =
            from.geometry.measuredEndpoint ?? from.geometry.endpoint;
          const toEndpoint =
            to.geometry.measuredEndpoint ?? to.geometry.endpoint;
          if (!fromEndpoint || !toEndpoint) continue;
          const exact =
            Boolean(from.geometry.measuredEndpoint) &&
            Boolean(to.geometry.measuredEndpoint) &&
            from.geometry.precise &&
            to.geometry.precise;
          const surface = exact
            ? ruledSurface(
                from.geometry.measuredEndpoint!,
                to.geometry.measuredEndpoint!,
              )
            : null;
          const worldPolygon = surface
            ? toWorldPolygon(surface.polygon, viewport)
            : [];
          const fromPoints = endpointPoints(fromEndpoint);
          const toPoints = endpointPoints(toEndpoint);
          const fromCenter = {
            x: (fromPoints[0].x + fromPoints[1].x) / 2,
            y: (fromPoints[0].y + fromPoints[1].y) / 2,
          };
          const toCenter = {
            x: (toPoints[0].x + toPoints[1].x) / 2,
            y: (toPoints[0].y + toPoints[1].y) / 2,
          };
          const labelPoint = beamLabelPoint(fromCenter, toCenter, paperRects);
          const labelGap = beamLabelGap(fromCenter, toCenter, paperRects);
          const labelWorld = worldPointForLocal(labelPoint, viewport);
          const fromDoc = labelFor(connection.from);
          const toDoc = labelFor(connection.to);
          measured.push({
            id: connection.id,
            relation: connection.relation,
            label: connection.label || RELATION_LABELS[connection.relation],
            endpointLabel: endpointLabel(fromDoc, toDoc),
            visibility: `${from.geometry.visibility}:${to.geometry.visibility}`,
            worldPolygon,
            worldRangeContours: [...from.worldContours, ...to.worldContours],
            selected: connection.id === inputRef.current.selectedConnectionId,
            exact,
            path: surface ? polygonToPath(surface.polygon) : null,
            labelGap,
            labelPoint,
            labelWorld,
            origin: from.surfaceId
              ? { kind: "surface", surfaceId: from.surfaceId, endpoint: "from" }
              : { kind: "bridge" },
          });
        }
        if (layoutPass) sceneGeometry.current.dirty = false;
        beamWorldCache.current = measured;
        const previous = beamDescriptors.current;
        const descriptionsChanged =
          previous.length !== measured.length ||
          measured.some((beam, index) => {
            const old = previous[index];
            return (
              !old ||
              old.id !== beam.id ||
              old.label !== beam.label ||
              old.endpointLabel !== beam.endpointLabel ||
              old.relation !== beam.relation ||
              old.visibility !== beam.visibility ||
              old.selected !== beam.selected ||
              old.exact !== beam.exact ||
              old.origin.kind !== beam.origin.kind ||
              (old.origin.kind === "surface" &&
                beam.origin.kind === "surface" &&
                (old.origin.surfaceId !== beam.origin.surfaceId ||
                  old.origin.endpoint !== beam.origin.endpoint)) ||
              old.worldRangeContours.length !== beam.worldRangeContours.length
            );
          });
        if (descriptionsChanged) {
          beamDescriptors.current = measured;
          setBeams(measured);
        }
        const batches =
          Number(viewportNode.dataset.rangeMeasureBatches ?? "0") +
          (layoutPass ? 1 : 0);
        const measurements =
          Number(viewportNode.dataset.rangeMeasurements ?? "0") +
          sceneGeometry.current.rangeMeasurements -
          previousMeasurements;
        viewportNode.dataset.rangeMeasureBatches = String(batches);
        viewportNode.dataset.rangeMeasurements = String(measurements);
        viewportNode.dataset.rangeSurfaceCount = String(measured.length);
        viewportNode.dataset.presentationGeneration = String(presentation.id);
        const displayedScroll = new Map<SurfaceInstanceId, number>();
        for (const id of alignmentTargets.keys()) {
          const scroll = surfaceNodes.current
            .get(id)
            ?.querySelector<HTMLElement>("[data-document-scroll]");
          if (scroll) displayedScroll.set(id, scroll.scrollTop);
        }
        const scrollCorrections = reconcileFocusScroll(
          alignmentTargets,
          displayedScroll,
          presentationPending.current?.scroll ??
            activePresentationScrollTargets.current,
          interruptedScroll.current,
        );
        if (scrollCorrections || correctedPaperTargets)
          requestPresentation(
            undefined,
            correctedPaperTargets,
            scrollCorrections,
            400,
          );
      } finally {
        restoreLayout();
      }
    },
    [
      narrow,
      presentation,
      requestPresentation,
      sceneLayout,
      interaction,
      resolveViewPapers,
    ],
  );

  useLayoutEffect(() => {
    rebuildBeamGeometry.current = () => measureBeams(false);
    return () => {
      rebuildBeamGeometry.current = null;
    };
  }, [measureBeams]);

  const scheduleMeasure = useCallback(() => {
    if (measureFrame.current !== null) return;
    measureFrame.current = window.requestAnimationFrame(() => {
      measureFrame.current = null;
      measureBeams();
      renderCachedBeams();
    });
  }, [measureBeams, renderCachedBeams]);

  const interruptSurfaceScroll = useCallback((surfaceId: SurfaceInstanceId) => {
    interruptedScroll.current.add(surfaceId);
    programmaticScroll.current.delete(surfaceId);
    activePresentationScrollTargets.current.delete(surfaceId);
    initialScrollTargets.current.delete(surfaceId);
    if (presentationPending.current) {
      const next = new Map(presentationPending.current.scroll);
      next.delete(surfaceId);
      presentationPending.current.scroll = next;
    }
  }, []);

  const onSurfaceScroll = useCallback(
    (
      surfaceId: SurfaceInstanceId,
      scrollTop: number,
      presentationId: number,
    ) => {
      // Virtual spacer commits can change the browser's scroll position without
      // user input. Only explicit scroll gestures revoke focus ownership.
      onScroll(surfaceId, scrollTop, presentationId);
      renderCachedBeams();
    },
    [onScroll, renderCachedBeams],
  );

  const invalidateGeometry = useCallback(() => {
    sceneGeometry.current.invalidate();
    scheduleMeasure();
  }, [scheduleMeasure]);

  useEffect(() => {
    scheduleMeasureRef.current = scheduleMeasure;
    return () => {
      if (scheduleMeasureRef.current === scheduleMeasure)
        scheduleMeasureRef.current = null;
    };
  }, [scheduleMeasure]);

  useEffect(() => {
    const nextRangeContextKey = [
      current?.surfaceId ?? "",
      current?.position.revisionId ?? "",
      companion?.surfaceId ?? "",
      companion?.position.revisionId ?? "",
      connections.map((connection) => connection.id).join(","),
    ].join("|");
    sceneGeometry.current.setContext(nextRangeContextKey);
    inputRef.current = {
      current,
      companion,
      previous,
      connections,
      selectedConnectionId,
      selectedEndpoint,
      documents,
      neighborhood,
    };
    if (sceneGeometry.current.dirty) scheduleMeasure();
    else renderCachedBeams();
  }, [
    companion,
    connections,
    documents,
    neighborhood,
    current,
    previous,
    scheduleMeasure,
    selectedConnectionId,
    selectedEndpoint,
    renderCachedBeams,
    presentation.id,
    narrow,
  ]);

  useEffect(() => {
    const newPresentation = handledPresentationId.current !== presentation.id;
    if (newPresentation) {
      handledPresentationId.current = presentation.id;
      interruptedScroll.current.clear();
    }
    if (newPresentation && presentation.kind === "restore") {
      const restoreTargets = new Map<SurfaceInstanceId, number>();
      for (const surface of [
        inputRef.current.current,
        inputRef.current.companion,
      ]) {
        if (surface)
          restoreTargets.set(surface.surfaceId, surface.position.scrollTop);
      }
      requestPresentation(undefined, undefined, restoreTargets, 400);
    }
    scheduleMeasure();
  }, [
    presentation.id,
    presentation.kind,
    requestPresentation,
    scheduleMeasure,
  ]);

  useLayoutEffect(() => {
    if (worldRef.current)
      worldRef.current.style.transform = cameraTransform(livePose.current);
    scheduleMeasure();
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    renderCachedBeams();
  }, [beams, viewKind, narrow, renderCachedBeams]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onResize = () => invalidateGeometry();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onResize);
    observer?.observe(viewport);
    for (const node of surfaceNodes.current.values()) observer?.observe(node);
    window.addEventListener("resize", onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      if (measureFrame.current !== null) {
        window.cancelAnimationFrame(measureFrame.current);
        measureFrame.current = null;
      }
    };
  }, [
    invalidateGeometry,
    current?.position.revisionId,
    companion?.position.revisionId,
  ]);

  useEffect(() => {
    return () => {
      cancelPresentationClock();
      settleCameraMotion();
      if (measureFrame.current !== null)
        window.cancelAnimationFrame(measureFrame.current);
      interaction.cancel();
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      if (previewTimer.current !== null)
        window.clearTimeout(previewTimer.current);
      if (previewCloseTimer.current !== null)
        window.clearTimeout(previewCloseTimer.current);
    };
  }, [cancelPresentationClock, settleCameraMotion, interaction]);

  const resetCamera = useCallback(() => {
    interaction.cancel();
    onReturnToReading();
  }, [interaction, onReturnToReading]);

  useImperativeHandle(
    controllerRef,
    () => ({
      resetCamera,
      measure: invalidateGeometry,
      cancelInput: () => interaction.cancel(),
    }),
    [resetCamera, invalidateGeometry, interaction],
  );

  const activateConnection = useCallback(
    (
      connectionId: ConnectionId,
      origin: ConnectionActivation["origin"] = { kind: "bridge" },
    ) => {
      interaction.cancel();
      setRelationMenu(null);
      onFollow({ connectionId, origin });
    },
    [onFollow, setRelationMenu, interaction],
  );

  const closePreview = useCallback(() => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    if (previewCloseTimer.current !== null)
      window.clearTimeout(previewCloseTimer.current);
    previewCloseTimer.current = window.setTimeout(() => {
      previewCloseTimer.current = null;
      setPreview(null);
    }, 120);
  }, []);

  const requestPreview = useCallback(
    (item: EdgeItem) => {
      if (previewCloseTimer.current !== null) {
        window.clearTimeout(previewCloseTimer.current);
        previewCloseTimer.current = null;
      }
      if (preview?.key === `edge:${item.key}` && preview.document) return;
      if (previewTimer.current !== null)
        window.clearTimeout(previewTimer.current);
      const key = `edge:${item.key}`;
      previewTimer.current = window.setTimeout(() => {
        previewTimer.current = null;
        const requestId = ++previewRequest.current;
        setPreview({ key, item, document: null, loading: true, error: null });
        void loadPreview(item.target).then(
          (document) => {
            if (requestId !== previewRequest.current) return;
            setPreview((currentPreview) =>
              currentPreview?.key === key
                ? { ...currentPreview, document, loading: false }
                : currentPreview,
            );
          },
          (error: unknown) => {
            if (requestId !== previewRequest.current) return;
            setPreview((currentPreview) =>
              currentPreview?.key === key
                ? {
                    ...currentPreview,
                    loading: false,
                    error:
                      error instanceof Error ? error.message : "正文读取失败",
                  }
                : currentPreview,
            );
          },
        );
      }, 180);
    },
    [loadPreview, preview],
  );

  const onBeamClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      const viewport = viewportRef.current?.getBoundingClientRect();
      if (!viewport) return;
      const point = {
        x: event.clientX - viewport.left,
        y: event.clientY - viewport.top,
      };
      const view = viewportSize.current ?? {
        width: viewport.width,
        height: viewport.height,
      };
      const navigationOrder = new Map(
        relationNavigation.items.map((item, index) => [
          item.connectionId,
          index,
        ]),
      );
      const candidates = beamWorldCache.current
        .slice()
        .sort(
          (left, right) =>
            (navigationOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
              (navigationOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
            left.id.localeCompare(right.id),
        );
      const hits = polygonHits(
        point,
        candidates
          .map((beam) => ({
            id: beam.id,
            polygon: projectScenePoints(
              beam.worldPolygon,
              livePose.current,
              view,
            ),
          }))
          .filter((candidate) => candidate.polygon.length > 2),
      );
      if (!hits.length) return;
      event.preventDefault();
      event.stopPropagation();
      if (hits.length === 1) {
        const beam = beamWorldCache.current.find(
          (candidate) => candidate.id === hits[0],
        );
        activateConnection(hits[0], beam?.origin);
      } else setRelationMenu({ x: point.x, y: point.y, ids: hits });
    },
    [activateConnection, relationNavigation.items, setRelationMenu],
  );

  const excludedPositions = useMemo(
    () =>
      [current?.position, companion?.position, previous?.position].filter(
        (position): position is ReadingPosition => Boolean(position),
      ),
    [companion?.position, current?.position, previous?.position],
  );
  const edgeGroups = useMemo(() => {
    const currentRevisionId = current?.position.revisionId ?? null;
    const centeredKnowledge =
      currentRevisionId &&
      neighborhood.kind !== "idle" &&
      neighborhood.centerRevisionId !== currentRevisionId
        ? ({ kind: "idle" } as const)
        : neighborhood;
    return projectEdges(documents, centeredKnowledge, excludedPositions);
  }, [
    current?.position.revisionId,
    documents,
    excludedPositions,
    neighborhood,
  ]);
  const [frontByGroup, setFrontByGroup] = useState<Record<string, string>>({});
  const currentRevisionId = current?.position.revisionId ?? null;
  const activeFan =
    fan &&
    fan.centerRevisionId === currentRevisionId &&
    edgeGroups.some((group) => group.id === fan.groupId)
      ? fan
      : null;
  const fanOpen = activeFan?.groupId ?? null;
  const fanWindow = activeFan?.window ?? 0;
  const fanSnapshot = activeFan?.items ?? EMPTY_TARGETS;
  const renderedHovered =
    hoveredState?.centerRevisionId === currentRevisionId
      ? hoveredState.key
      : null;
  const fanLimit = narrow ? NARROW_FAN_LIMIT : DESKTOP_FAN_LIMIT;
  const completeCatalogue =
    catalogue.activeComplete && catalogue.archivedComplete;

  const closeFan = useCallback(() => {
    if (activeFan && activeFan.items[activeFan.window]) {
      setFrontByGroup((previousFront) => ({
        ...previousFront,
        [activeFan.groupId]: activeFan.items[activeFan.window].key,
      }));
    }
    setFan(null);
  }, [activeFan, setFan, setFrontByGroup]);

  const activateEdge = useCallback(
    (item: EdgeItem) => {
      interaction.cancel();
      closeFan();
      const activation = resolveEdgeActivation(
        item,
        current?.position.revisionId ?? null,
        connections,
      );
      if (activation.kind === "follow")
        onFollow({
          connectionId: activation.connectionId,
          origin: { kind: "bridge" },
        });
      else onReadBeside(activation.target);
    },
    [
      closeFan,
      connections,
      current?.position.revisionId,
      onFollow,
      onReadBeside,
      interaction,
    ],
  );

  const toggleFan = useCallback(
    (group: EdgeGroup) => {
      if (fanOpen === group.id) {
        closeFan();
        return;
      }
      setFan({
        centerRevisionId: current?.position.revisionId ?? null,
        groupId: group.id,
        items: group.leaves.slice(),
        window: 0,
      });
    },
    [closeFan, current?.position.revisionId, fanOpen, setFan],
  );

  useLayoutEffect(() => {
    if (!fan || activeFan) return;
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    const invalidate = window.setTimeout(() => {
      setFan((currentFan) => (currentFan === fan ? null : currentFan));
      setHoveredState(null);
    }, 0);
    return () => window.clearTimeout(invalidate);
  }, [activeFan, currentRevisionId, fan]);

  useLayoutEffect(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (!hoveredState || hoveredState.centerRevisionId === currentRevisionId)
      return;
    const clear = window.setTimeout(() => setHoveredState(null), 0);
    return () => window.clearTimeout(clear);
  }, [currentRevisionId, hoveredState]);

  const updateHover = useCallback(
    (key: string | null) => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      const centerRevisionId = current?.position.revisionId ?? null;
      if (key === null) {
        hoverTimer.current = window.setTimeout(
          () => setHoveredState(null),
          120,
        );
        return;
      }
      if (typeof window.getSelection === "function") {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
      }
      hoverTimer.current = window.setTimeout(() => {
        if (
          (inputRef.current.current?.position.revisionId ?? null) !==
          centerRevisionId
        )
          return;
        setHoveredState({ key, centerRevisionId });
      }, 160);
    },
    [current?.position.revisionId],
  );

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      const active = Boolean(selection && !selection.isCollapsed);
      setSelectionActive(active);
      if (active) {
        interaction.cancel();
        if (hoverTimer.current !== null) {
          window.clearTimeout(hoverTimer.current);
          hoverTimer.current = null;
        }
        setHoveredState(null);
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [interaction]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (interaction.keyDown(event.nativeEvent)) return;
      const target = event.target as HTMLElement;
      if (event.key === "Escape" && relationMenu) {
        event.preventDefault();
        setRelationMenu(null);
        return;
      }
      if (event.key === "Escape" && fanOpen) {
        event.preventDefault();
        event.stopPropagation();
        closeFan();
        return;
      }
      const selected = window.getSelection();
      if (selected && !selected.isCollapsed) return;
      if (
        event.altKey &&
        !event.nativeEvent.isComposing &&
        target.closest("[data-document-scroll]") &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        onStepConnection(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (target !== viewportRef.current || isControlTarget(target)) return;
      if (event.key === "0") {
        event.preventDefault();
        resetCamera();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        interaction.zoom(livePose.current.zoom * 1.1);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        interaction.zoom(livePose.current.zoom / 1.1);
      }
    },
    [
      interaction,
      relationMenu,
      fanOpen,
      closeFan,
      onStepConnection,
      resetCamera,
    ],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    const wheel = (event: WheelEvent) => interaction.wheel(event);
    const cancel = () => interaction.cancel();
    const visibility = () => {
      if (document.hidden) cancel();
    };
    viewport?.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      viewport?.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [interaction]);

  const individualEdges: readonly EdgeItem[] = [];
  const groupSlots = Math.max(
    1,
    Math.min(4, Math.floor((sceneSize.width - 104) / 180)),
  );
  const groupPages = Math.max(1, Math.ceil(edgeGroups.length / groupSlots));
  const visibleGroupPage = Math.min(groupPage, groupPages - 1);
  const shellGroups = edgeGroups.slice(
    visibleGroupPage * groupSlots,
    (visibleGroupPage + 1) * groupSlots,
  );

  const visibleMobileSurfaceId =
    view.kind === "reading" &&
    (view.exposedSurfaceId === current?.surfaceId ||
      view.exposedSurfaceId === companion?.surfaceId)
      ? view.exposedSurfaceId
      : (current?.surfaceId ?? companion?.surfaceId ?? null);
  const recessed =
    viewKind === "reading" && sceneLayout.framing.kind === "recessed-companion";
  const showCurrentSurface =
    !!current && (!recessed || visibleMobileSurfaceId === current.surfaceId);
  const showCompanionSurface =
    !!companion &&
    (!recessed || visibleMobileSurfaceId === companion.surfaceId);

  /*
   * This render-time registry is intentional: keeping the previous keyed
   * occurrence in the same array is what lets React retain its DOM while a
   * navigation replaces current/companion.  It is pruned below to two
   * departures and is never used as an external mutable state source.
   */
  /* eslint-disable react-hooks/refs, react-hooks/purity */
  const activeSurfaceRecords = [
    current ? { surface: current, role: "current" as const } : null,
    companion ? { surface: companion, role: "companion" as const } : null,
  ].filter(
    (record): record is { surface: ReadingSurface; role: SurfaceRole } =>
      record !== null,
  );
  const activeSurfaceIds = new Set(
    activeSurfaceRecords.map((record) => record.surface.surfaceId),
  );
  for (const record of activeSurfaceRecords) {
    const retained = retainedSurfaceMap.current.get(record.surface.surfaceId);
    if (retained) {
      retained.surface = record.surface;
      retained.role = record.role;
      retained.departing = false;
      retained.departureAt = 0;
    } else {
      initialScrollTargets.current.set(
        record.surface.surfaceId,
        record.surface.position.scrollTop,
      );
      const edge = [...edgeNodes.current.entries()].find(
        ([, node]) =>
          node.dataset.documentId === record.surface.position.documentId,
      );
      const edgeRect = edge && sceneGeometry.current.edgeRects.get(edge[0]);
      const entry = edgeRect
        ? {
            x: (edgeRect.left + edgeRect.right - sceneSize.width) / 2,
            y: (edgeRect.top + edgeRect.bottom - sceneSize.height) / 2,
          }
        : departurePosition(record.role, sceneSize.width);
      paperMotionPose.current = new Map(paperMotionPose.current).set(
        record.surface.surfaceId,
        { ...entry, scale: 0.55, opacity: 0.16 },
      );
      retainedSurfaceMap.current.set(record.surface.surfaceId, {
        surface: record.surface,
        role: record.role,
        departing: false,
        departureAt: 0,
        peripheralPosition: entry,
      });
    }
  }
  for (const retained of retainedSurfaceMap.current.values()) {
    if (activeSurfaceIds.has(retained.surface.surfaceId)) continue;
    if (!retained.departing) {
      retained.departing = true;
      retained.departureAt = performance.now();
    }
  }
  const departures = [...retainedSurfaceMap.current.values()]
    .filter((retained) => retained.departing)
    .sort((left, right) => left.departureAt - right.departureAt);
  while (departures.length > 2) {
    const oldest = departures.shift();
    if (oldest) {
      retainedSurfaceMap.current.delete(oldest.surface.surfaceId);
      sceneGeometry.current.layouts.delete(oldest.surface.surfaceId);
    }
  }
  const retainedSurfaces = Array.from(retainedSurfaceMap.current.values()).map(
    (retained) => ({
      ...retained,
      pose: paperMotionPose.current.get(retained.surface.surfaceId) ?? {
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      },
    }),
  );
  useLayoutEffect(() => {
    if (interaction.active) return;
    const layoutKey = [
      presentation.id,
      current?.surfaceId,
      companion?.surfaceId,
      sceneSize.width,
      sceneSize.height,
    ].join(":");
    if (
      renderedLayoutKey.current === layoutKey &&
      sameSpaceView(liveView.current, view)
    )
      return;
    renderedLayoutKey.current = layoutKey;
    liveView.current = view;
    const targets = new Map(resolveViewPapers(view));
    for (const retained of retainedSurfaceMap.current.values()) {
      if (retained.departing)
        targets.set(retained.surface.surfaceId, {
          ...retained.peripheralPosition,
          scale: 0.55,
          opacity: 0.16,
        });
    }
    paperTargets.current = targets;
    const camera = constrainCameraPose(cameraForView(view), livePose.current, {
      safetyCorners: paperCorners(targets),
    });
    targetPose.current = camera;
    if (zoomInput.current)
      zoomInput.current.value = String(Math.round(camera.zoom * 100));
    const initial = initialScrollTargets.current.size
      ? new Map(initialScrollTargets.current)
      : undefined;
    initialScrollTargets.current.clear();
    requestPresentation(camera, targets, initial, 400);
  }, [
    view,
    current?.surfaceId,
    companion?.surfaceId,
    sceneSize.width,
    sceneSize.height,
    resolveViewPapers,
    paperCorners,
    requestPresentation,
    interaction,
    presentation.id,
  ]);
  /* eslint-enable react-hooks/refs, react-hooks/purity */

  const showOtherSurface = useCallback(() => {
    if (!current || !companion) return;
    interaction.cancel();
    onViewCheckpoint({
      generation: presentation.id,
      view: readingView(
        visibleMobileSurfaceId === current.surfaceId
          ? companion.surfaceId
          : current.surfaceId,
      ),
    });
  }, [
    companion,
    current,
    interaction,
    onViewCheckpoint,
    presentation.id,
    visibleMobileSurfaceId,
  ]);

  useLayoutEffect(() => {
    if (!recessed || !visibleMobileSurfaceId) return;
    surfaceNodes.current
      .get(visibleMobileSurfaceId)
      ?.querySelector<HTMLElement>("[data-document-scroll]")
      ?.focus({ preventScroll: true });
  }, [visibleMobileSurfaceId, recessed]);

  return (
    <section
      className={`spatial-scene ${selectionActive ? "selection-active" : ""}`}
      data-space-view={viewKind}
      aria-label="连续文档空间"
      data-retained-surfaces={retainedSurfaceVersion}
    >
      <div
        ref={viewportRef}
        className="spatial-scene-viewport"
        data-hit-role="stage"
        tabIndex={0}
        onPointerDown={(event) => interaction.pointerDown(event.nativeEvent)}
        onPointerMove={(event) => interaction.pointerMove(event.nativeEvent)}
        onPointerUp={(event) => interaction.pointerUp(event.nativeEvent)}
        onPointerCancel={(event) =>
          interaction.pointerCancel(event.nativeEvent)
        }
        onLostPointerCapture={(event) =>
          interaction.pointerCancel(event.nativeEvent)
        }
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && interaction.active) {
            interaction.keyDown(event.nativeEvent);
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onKeyDown={onKeyDown}
      >
        <div
          className="spatial-stage-input"
          data-hit-role="stage"
          aria-hidden="true"
        />
        <div ref={worldRef} className="spatial-scene-world">
          {retainedSurfaces.map((retained) => {
            const isCurrent = retained.role === "current";
            const hidden =
              recessed &&
              (isCurrent ? !showCurrentSurface : !showCompanionSurface);
            return (
              <SurfacePaper
                key={retained.surface.surfaceId}
                surface={retained.surface}
                role={retained.role}
                instanceKey={retained.surface.surfaceId}
                position={retained.pose}
                paperWidth={
                  recessed
                    ? sceneLayout.paperWidth
                    : isCurrent
                      ? sceneLayout.paperWidth
                      : (sceneLayout.companionWidth ?? sceneLayout.paperWidth)
                }
                paperMaxHeight={sceneLayout.paperMaxHeight}
                register={registerSurface}
                registerPassage={registerPassage}
                onScroll={onSurfaceScroll}
                onLayoutDirty={invalidateGeometry}
                onUserScroll={interruptSurfaceScroll}
                onPromote={() => {
                  interaction.cancel();
                  onPromote();
                }}
                onFollow={(activation) => {
                  interaction.cancel();
                  onFollow(activation);
                }}
                onStepConnection={onStepConnection}
                relationNavigation={relationNavigation}
                mobileHidden={hidden}
                departing={retained.departing}
                presentation={presentation}
                renderDocument={renderDocument}
                renderDocumentMenu={renderDocumentMenu}
                showVersion={
                  retained.surface.document.id ===
                    (isCurrent
                      ? companion?.document.id
                      : current?.document.id) ||
                  !retained.surface.document.isCurrent ||
                  retained.surface.document.archived
                }
              />
            );
          })}
          {!companion && pending && (
            <article
              className="spatial-pending-surface"
              data-hit-role="document-affordance"
              data-document-id={pending.target.documentId}
              data-revision-id={pending.target.revisionId}
            >
              <header>
                <span>旁读</span>
                <strong>{pending.title}</strong>
              </header>
              <div className="spatial-pending-body">
                {pending.error ? (
                  <>
                    <p>{pending.error}</p>
                    <button
                      type="button"
                      onClick={() => onReadBeside(pending.target)}
                    >
                      重试
                    </button>
                  </>
                ) : (
                  <>
                    <p>正在载入正文</p>
                    <span className="spatial-loading-line" aria-hidden="true" />
                  </>
                )}
              </div>
            </article>
          )}
          {!current && !pending && (
            <div className="spatial-empty-state" data-hit-role="stage">
              <strong>空间还是空的。</strong>
              <span>打开一篇文档，纸场会从这里开始。</span>
            </div>
          )}
        </div>
        <div className="spatial-scene-edge-layer" aria-label="空间边缘入口">
          {recessed && current && companion && (
            <button
              type="button"
              className="spatial-counterpart-lip"
              data-hit-role="document-affordance"
              data-document-id={
                visibleMobileSurfaceId === current.surfaceId
                  ? companion.position.documentId
                  : current.position.documentId
              }
              data-revision-id={
                visibleMobileSurfaceId === current.surfaceId
                  ? companion.position.revisionId
                  : current.position.revisionId
              }
              onClick={showOtherSurface}
              aria-label={`阅读相关段落：${visibleMobileSurfaceId === current.surfaceId ? companion.document.title : current.document.title}`}
            >
              <span>相关文档</span>
              <strong>
                {visibleMobileSurfaceId === current.surfaceId
                  ? companion.document.title
                  : current.document.title}
              </strong>
              <small>阅读相关段落</small>
            </button>
          )}
          {previous && (
            <button
              type="button"
              className="spatial-return-leaf"
              data-hit-role="document-affordance"
              data-document-id={previous.document.id}
              data-revision-id={previous.position.revisionId}
              onClick={() => {
                onHistory(previous.historyIndex);
              }}
              aria-label={`返回到${previous.document.title}，v${previous.document.sequence}`}
            >
              <span className="spatial-return-tag">返回</span>
              <strong>{previous.document.title}</strong>
              <small>v{previous.document.sequence} · 回到原段落</small>
            </button>
          )}
          {individualEdges.map((item, index) => (
            <EdgeShell
              key={item.key}
              item={item}
              index={index}
              register={registerEdge}
              onActivate={activateEdge}
              onReadBeside={(target) => {
                closeFan();
                onReadBeside(target);
              }}
              onHover={updateHover}
              onPreviewStart={requestPreview}
              onPreviewEnd={closePreview}
              hovered={renderedHovered === `edge:${item.key}`}
            />
          ))}
          <div className="spatial-fold-slots" aria-label="空间折页">
            {shellGroups.map((group) => {
              const frontKey = frontByGroup[group.id];
              const front =
                group.leaves.find((item) => item.key === frontKey) ??
                group.leaves[0];
              return (
                <React.Fragment key={group.id}>
                  <StackRoot
                    group={group}
                    front={front}
                    complete={completeCatalogue}
                    open={fanOpen === group.id}
                    onToggle={() => {
                      toggleFan(group);
                      scheduleMeasure();
                    }}
                    onHover={updateHover}
                    hovered={renderedHovered === group.id}
                  />
                  {fanOpen === group.id && (
                    <Fan
                      items={fanSnapshot}
                      group={group}
                      start={fanWindow}
                      limit={fanLimit}
                      hovered={renderedHovered}
                      onActivate={activateEdge}
                      onReadBeside={(target) => {
                        closeFan();
                        onReadBeside(target);
                      }}
                      onHover={updateHover}
                      onPreviewStart={requestPreview}
                      onPreviewEnd={closePreview}
                      onPrevious={() =>
                        setFan((currentFan) =>
                          currentFan
                            ? {
                                ...currentFan,
                                window: Math.max(
                                  0,
                                  currentFan.window - fanLimit,
                                ),
                              }
                            : currentFan,
                        )
                      }
                      onNext={() =>
                        setFan((currentFan) =>
                          currentFan
                            ? {
                                ...currentFan,
                                window: Math.min(
                                  Math.max(
                                    0,
                                    currentFan.items.length - fanLimit,
                                  ),
                                  currentFan.window + fanLimit,
                                ),
                              }
                            : currentFan,
                        )
                      }
                      onClose={closeFan}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {groupPages > 1 && (
            <nav
              className="spatial-fold-pages"
              aria-label="折页组分页"
              data-hit-role="control"
            >
              <button
                type="button"
                aria-label="上一页折页组"
                disabled={visibleGroupPage === 0}
                onClick={() => {
                  closeFan();
                  setGroupPage(visibleGroupPage - 1);
                }}
              >
                ‹
              </button>
              <span>
                {visibleGroupPage + 1}/{groupPages}
              </span>
              <button
                type="button"
                aria-label="下一页折页组"
                disabled={visibleGroupPage + 1 >= groupPages}
                onClick={() => {
                  closeFan();
                  setGroupPage(visibleGroupPage + 1);
                }}
              >
                ›
              </button>
            </nav>
          )}
          {preview && (
            <article
              className={`spatial-edge-preview spatial-edge-preview-${preview.item.slot}`}
              data-hit-role="document-affordance"
              onPointerEnter={() => {
                if (previewCloseTimer.current !== null) {
                  window.clearTimeout(previewCloseTimer.current);
                  previewCloseTimer.current = null;
                }
              }}
              onPointerLeave={closePreview}
              onFocus={() => {
                if (previewCloseTimer.current !== null) {
                  window.clearTimeout(previewCloseTimer.current);
                  previewCloseTimer.current = null;
                }
              }}
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  closePreview();
              }}
            >
              <header>
                <span>{bandLabel(preview.item.band)}</span>
                <strong>{preview.item.document.title}</strong>
                <small>v{preview.item.sequence}</small>
              </header>
              <div className="spatial-edge-preview-body">
                {preview.loading && <p>正在读取正文…</p>}
                {preview.error && <p>{preview.error}</p>}
                {preview.document && (
                  <p>{preview.document.content.slice(0, 1800)}</p>
                )}
              </div>
              <div className="spatial-edge-preview-actions">
                <button
                  type="button"
                  onClick={() => {
                    closePreview();
                    onReadBeside(preview.item.target);
                  }}
                >
                  旁读
                </button>
                {preview.item.connectionId && (
                  <button
                    type="button"
                    onClick={() =>
                      activateConnection(preview.item.connectionId!)
                    }
                  >
                    沿关系阅读
                  </button>
                )}
              </div>
            </article>
          )}
        </div>
        <svg
          className="spatial-scene-beams"
          aria-label="文档之间的范围关系"
          preserveAspectRatio="none"
          onClick={onBeamClick}
        >
          {beams.map((beam) => (
            <g
              key={beam.id}
              style={relationStyle(beam.relation)}
              data-beam-connection-id={beam.id}
              data-range-visibility={beam.visibility}
            >
              {beam.path && (beam.selected || hoveredBeamId === beam.id) && (
                <path
                  ref={(node) => {
                    if (node) beamPathNodes.current.set(beam.id, node);
                    else beamPathNodes.current.delete(beam.id);
                  }}
                  d={beam.path}
                  className={`spatial-beam ${beam.selected ? "is-selected" : ""} ${beam.exact ? "is-exact" : "is-proxy"}`}
                  stroke="var(--relation-ink)"
                  fill="var(--relation-signal)"
                  pointerEvents="fill"
                  data-hit-role="relation"
                  onMouseEnter={() => setHoveredBeamId(beam.id)}
                  onMouseLeave={() => setHoveredBeamId(null)}
                  aria-label={`激活${RELATION_LABELS[beam.relation]}${beam.label !== RELATION_LABELS[beam.relation] ? `：${beam.label}` : ""}连接；${beam.endpointLabel}${beam.exact ? "" : `；${rangeStatusLabel(beam.visibility)}`}`}
                >
                  <title>{beam.endpointLabel}</title>
                </path>
              )}
            </g>
          ))}
        </svg>
        <svg
          className="spatial-scene-range-contours"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          {beams.map((beam) => (
            <g key={beam.id} data-beam-connection-id={beam.id}>
              {beam.exact &&
                (beam.selected || hoveredBeamId === beam.id) &&
                beam.worldRangeContours.map((_, index) => (
                  <path
                    key={`${beam.id}:range:${index}`}
                    ref={(node) => {
                      const key = `${beam.id}:${index}`;
                      if (node) beamRangeNodes.current.set(key, node);
                      else beamRangeNodes.current.delete(key);
                    }}
                    d={beam.path ?? ""}
                    className={`spatial-range-contour ${beam.selected ? "is-selected" : ""}`}
                    fill="none"
                    stroke="var(--relation-ink)"
                    data-hit-role="relation-geometry"
                    pointerEvents="none"
                  />
                ))}
              {beam.selected && !beam.exact && (
                <text
                  ref={(node) => {
                    if (node)
                      beamPaperEdgeLabelNodes.current.set(beam.id, node);
                    else beamPaperEdgeLabelNodes.current.delete(beam.id);
                  }}
                  x={beam.labelPoint.x}
                  y={beam.labelPoint.y - 8}
                  className="spatial-beam-paper-edge-label"
                >
                  {rangeStatusLabel(beam.visibility)}
                </text>
              )}
            </g>
          ))}
        </svg>
        {relationMenu && (
          <div
            className="spatial-relation-menu"
            data-hit-role="control"
            role="menu"
            aria-label="重叠关系"
            style={{
              left: relationMenu.x,
              top: relationMenu.y,
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setRelationMenu(null);
            }}
          >
            <span className="spatial-relation-menu-title">选择关系</span>
            {relationMenu.ids.map((id) => {
              const connection = connections.find(
                (candidate) => candidate.id === id,
              );
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  onClick={() => activateConnection(id)}
                >
                  <span>
                    {connection?.label ||
                      (connection
                        ? RELATION_LABELS[connection.relation]
                        : "关系")}
                  </span>
                  <small>{id.slice(0, 8)}</small>
                </button>
              );
            })}
          </div>
        )}
        <div className="spatial-beam-labels" aria-label="可见连接">
          {beams.map((beam) => {
            const measuredWidth = beamLabelWidths[beam.id];
            const labelFits =
              beam.labelGap === null ||
              measuredWidth === undefined ||
              measuredWidth + 12 <= beam.labelGap;
            return (
              <button
                type="button"
                ref={(node) => {
                  if (node) beamLabelNodes.current.set(beam.id, node);
                  else beamLabelNodes.current.delete(beam.id);
                }}
                key={beam.id}
                className={`spatial-beam-label ${beam.selected ? "is-selected" : "is-quiet"} ${hoveredBeamId === beam.id ? "is-hovered" : ""} ${labelFits ? "" : "is-omitted"}`}
                data-hit-role="relation"
                aria-hidden={!labelFits}
                tabIndex={labelFits ? 0 : -1}
                style={
                  {
                    ...relationStyle(beam.relation),
                    left: 0,
                    top: 0,
                    transform: `translate3d(${beam.labelPoint.x}px, ${beam.labelPoint.y}px, 0) translate(-50%, -50%)`,
                  } as React.CSSProperties
                }
                onClick={() => activateConnection(beam.id, beam.origin)}
                onMouseEnter={() => setHoveredBeamId(beam.id)}
                onMouseLeave={() => setHoveredBeamId(null)}
                aria-label={`${RELATION_LABELS[beam.relation]}${beam.label !== RELATION_LABELS[beam.relation] ? `：${beam.label}` : ""}：${beam.endpointLabel}${beam.selected ? "，已选" : ""}`}
                title={`${RELATION_LABELS[beam.relation]}${beam.label !== RELATION_LABELS[beam.relation] ? `：${beam.label}` : ""}：${beam.endpointLabel}`}
              >
                <span className="spatial-beam-label-short" aria-hidden="true">
                  <span className="spatial-beam-label-symbol" />
                  <span>{RELATION_LABELS[beam.relation]}</span>
                  {beam.selected &&
                  beam.label !== RELATION_LABELS[beam.relation]
                    ? ` · ${beam.label}`
                    : null}
                  {!beam.exact
                    ? ` · ${rangeStatusLabel(beam.visibility)}`
                    : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="spatial-scene-actions" data-hit-role="control">
          <div className="spatial-zoom" aria-label="空间缩放">
            <button
              type="button"
              aria-label="缩小空间"
              onClick={() => interaction.zoom(livePose.current.zoom / 1.2)}
            >
              −
            </button>
            <label>
              <input
                ref={zoomInput}
                type="number"
                min={20}
                max={300}
                step={10}
                aria-label="空间缩放百分比"
                defaultValue={Math.round(cameraForView(view).zoom * 100)}
                onBlur={(event) => {
                  const zoom = event.currentTarget.valueAsNumber / 100;
                  if (Math.abs(zoom - livePose.current.zoom) > 0.005)
                    interaction.zoom(zoom);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
              %
            </label>
            <button
              type="button"
              aria-label="放大空间"
              onClick={() => interaction.zoom(livePose.current.zoom * 1.2)}
            >
              +
            </button>
          </div>
          <span className="spatial-gesture-hint spatial-gesture-hint-desktop">
            缩放浏览空间 · 拖动标题移动纸页
          </span>
          <span className="spatial-gesture-hint spatial-gesture-hint-mobile">
            缩放浏览空间 · 拖动标题移动纸页
          </span>
          {viewKind === "free" && (
            <button
              type="button"
              className="spatial-restore-action"
              onClick={resetCamera}
            >
              回到阅读
            </button>
          )}
        </div>
        <div className="spatial-scene-catalogue-status" aria-live="polite">
          {catalogue.loading
            ? "正在载入空间成员"
            : completeCatalogue
              ? `${documents.length} 份文档`
              : `已载入 ${documents.length} 份文档，仍在载入`}
        </div>
      </div>
    </section>
  );
}
