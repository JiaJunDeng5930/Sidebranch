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
  EdgeLeaf,
  DocumentTarget,
  NeighborhoodKnowledge,
} from "../../lib/reader/space-index";
import {
  cameraTransform,
  poseForScreenAnchor,
  screenToWorld,
  worldToScreen,
} from "../../lib/reader/camera";
import {
  projectSpaceEdges,
  resolveEdgeActivation,
} from "../../lib/reader/space-index";
import {
  relationColors as RELATION_COLORS,
  relationNames as RELATION_LABELS,
} from "../../lib/reader/relations";
import { sourceRanges } from "../../lib/reader/render-dom";
import "./spatial-scene.css";

/** A ready-to-render readable surface. It is keyed by revision identity. */
export interface ReadingSurface {
  position: ReadingPosition;
  document: DocumentRevision;
}

/** The former current surface after a companion has been promoted. */
export interface ReturnLeaf {
  position: ReadingPosition;
  document: DocumentSummary;
  historyIndex: number;
}

/** Metadata shown while a companion request is still in flight. */
export interface PendingSurface {
  target: DocumentTarget;
  title: string;
  error: string | null;
}

export interface SpatialSceneController {
  resetCamera(): void;
  measure(): void;
}

export interface SpatialSceneProps {
  current: ReadingSurface | null;
  companion: ReadingSurface | null;
  previous: ReturnLeaf | null;
  camera: CameraPose;
  documents: readonly DocumentSummary[];
  catalogue: {
    activeComplete: boolean;
    archivedComplete: boolean;
    loading: boolean;
  };
  neighborhood: NeighborhoodKnowledge;
  connections: readonly Connection[];
  selectedConnectionId: ConnectionId | null;
  pending: PendingSurface | null;
  onReadBeside: (target: DocumentTarget) => void;
  onPromote: () => void;
  onReturnToCurrent: () => void;
  onFollow: (id: ConnectionId) => void;
  onHistory: (index: number) => void;
  onScroll: (role: SurfaceRole, scrollTop: number) => void;
  onCameraCheckpoint: (pose: CameraPose) => void;
  renderDocument: (
    surface: ReadingSurface,
    role: SurfaceRole,
  ) => React.ReactNode;
  controllerRef?: React.Ref<SpatialSceneController>;
}

type Point = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number };
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
};

type Endpoint = Point & {
  coordinateSpace: "world" | "viewport";
  clipped: boolean;
  paperEdge: boolean;
  worldPoint: Point | null;
};

type Beam = {
  id: ConnectionId;
  label: string;
  endpointLabel: string;
  color: string;
  from: Endpoint;
  to: Endpoint;
  selected: boolean;
  exact: boolean;
  path: string;
  labelPoint: Point;
  labelWorld: Point | null;
};

type FanState = {
  readonly centerRevisionId: RevisionId | null;
  readonly groupId: string;
  readonly items: readonly EdgeItem[];
  readonly window: number;
};

type Pose = CameraPose;
type DragState =
  | {
      kind: "pending" | "pan" | "orbit";
      pointerId: number;
      pointerType: string;
      x: number;
      y: number;
      startX: number;
      startY: number;
      spaceOverride: boolean;
      orbitRequested: boolean;
    }
  | { kind: "pinch"; pointerId: number }
  | null;

type PointerPoint = { x: number; y: number; pointerType: string };

const DESKTOP_FAN_LIMIT = 7;
const NARROW_FAN_LIMIT = 3;
const DESKTOP_EDGE_LIMIT = 40;
const NARROW_EDGE_LIMIT = 16;
const DESKTOP_BEAM_LIMIT = 48;
const NARROW_BEAM_LIMIT = 16;
const CAMERA_LIMITS = {
  x: 10_000,
  y: 10_000,
  zoomMin: 0.55,
  zoomMax: 1.8,
  yaw: 22,
  pitch: 10,
} as const;
const EMPTY_TARGETS: readonly EdgeItem[] = [];

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampPose(pose: Pose): Pose {
  return {
    x: clamp(finite(pose.x, 0), -CAMERA_LIMITS.x, CAMERA_LIMITS.x),
    y: clamp(finite(pose.y, 0), -CAMERA_LIMITS.y, CAMERA_LIMITS.y),
    yaw: clamp(finite(pose.yaw, 0), -CAMERA_LIMITS.yaw, CAMERA_LIMITS.yaw),
    pitch: clamp(
      finite(pose.pitch, 0),
      -CAMERA_LIMITS.pitch,
      CAMERA_LIMITS.pitch,
    ),
    zoom: clamp(
      finite(pose.zoom, 1),
      CAMERA_LIMITS.zoomMin,
      CAMERA_LIMITS.zoomMax,
    ),
  };
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

function rectFromDomRect(rect: DOMRect): Rect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function unionRects(rects: readonly Rect[]): Rect | null {
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

function intersectRects(a: Rect, b: Rect): Rect | null {
  const result = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return result.right > result.left && result.bottom > result.top
    ? result
    : null;
}

function clampPoint(point: Point, rect: Rect): Point {
  return {
    x: clamp(point.x, rect.left, rect.right),
    y: clamp(point.y, rect.top, rect.bottom),
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
  return (["direct", "second", "other", "archive"] as const).flatMap((band) => {
    const leaves = byBand.get(band);
    if (!leaves?.length) return [];
    return [
      {
        id: `stack-${band}`,
        band,
        slot: slotForBand(band),
        leaves,
      },
    ];
  });
}

function endpointLabel(
  fromDocument: { title: string; sequence: number | null },
  toDocument: { title: string; sequence: number | null },
): string {
  return `${fromDocument?.title ?? "文档"} v${fromDocument?.sequence ?? "?"} ↔ ${toDocument?.title ?? "文档"} v${toDocument?.sequence ?? "?"}`;
}

function pathForBeam(from: Point, to: Point): string {
  const delta = to.x - from.x;
  const bend = Math.max(42, Math.abs(delta) * 0.34);
  const direction = delta >= 0 ? 1 : -1;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${(from.x + bend * direction).toFixed(1)} ${from.y.toFixed(1)} ${(to.x - bend * direction).toFixed(1)} ${to.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
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

function isControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input,textarea,select,button,a,[role='button'],[contenteditable='true']",
    ),
  );
}

function anchorMatches(anchor: Anchor, position: ReadingPosition): boolean {
  return (
    anchor.documentId === position.documentId &&
    anchor.revisionId === position.revisionId
  );
}

function surfaceIdentity(position: ReadingPosition): string {
  const focus = position.focus;
  return `${position.documentId}:${position.revisionId}:${focus?.start ?? ""}:${focus?.end ?? ""}`;
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
  instanceKey: string;
  position: Point;
  paperWidth: number | null;
  paperMaxHeight: number | null;
  register: (key: string, node: HTMLElement | null) => void;
  onScroll: (role: SurfaceRole, scrollTop: number) => void;
  onLayoutDirty: () => void;
  onPromote: () => void;
  onReturnToCurrent: () => void;
  renderDocument: SpatialSceneProps["renderDocument"];
}

const SurfacePaper = React.memo(function SurfacePaper({
  surface,
  role,
  instanceKey,
  position,
  paperWidth,
  paperMaxHeight,
  register,
  onScroll,
  onLayoutDirty,
  onPromote,
  onReturnToCurrent,
  renderDocument,
}: SurfacePaperProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const restoredPosition = useRef<string | null>(null);
  const positionKey = surfaceIdentity(surface.position);
  const identity = instanceKey;
  const content = useMemo(
    () => renderDocument(surface, role),
    [renderDocument, role, surface],
  );

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const focus = surface.position.focus;
    const focusKey = `${positionKey}:${focus?.start ?? ""}:${focus?.end ?? ""}`;
    const focusChanged = restoredPosition.current !== focusKey;
    restoredPosition.current = focusKey;
    if (focusChanged && focus) return;
    if (Math.abs(node.scrollTop - surface.position.scrollTop) > 1)
      node.scrollTop = Math.max(0, surface.position.scrollTop);
  }, [positionKey, surface.position.focus, surface.position.scrollTop]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onScrollEvent = () => {
      onLayoutDirty();
      if (scrollFrame.current !== null) return;
      scrollFrame.current = window.requestAnimationFrame(() => {
        scrollFrame.current = null;
        onScroll(role, node.scrollTop);
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
  }, [onLayoutDirty, onScroll, role]);

  return (
    <article
      ref={(node) => register(identity, node)}
      className={`spatial-paper spatial-paper-${role}`}
      data-hit-role="text"
      data-surface-key={identity}
      data-document-id={surface.position.documentId}
      data-revision-id={surface.position.revisionId}
      aria-label={`${surface.document.title}，v${surface.document.sequence}，${role === "current" ? "当前" : "旁读"}`}
      style={
        {
          "--paper-x": `${position.x}px`,
          "--paper-y": `${position.y}px`,
          ...(paperWidth === null
            ? {}
            : { "--paper-width": `${paperWidth}px` }),
          ...(paperMaxHeight === null
            ? {}
            : { "--paper-max-height": `${paperMaxHeight}px` }),
        } as React.CSSProperties
      }
    >
      {role === "companion" && (
        <header className="spatial-paper-header" data-hit-role="control">
          <span className="spatial-paper-role">旁读</span>
          <div className="spatial-paper-actions">
            <button
              type="button"
              className="spatial-paper-promote"
              data-hit-role="control"
              onClick={onPromote}
            >
              继续读这篇
            </button>
            <button
              type="button"
              className="spatial-paper-dismiss"
              data-hit-role="control"
              onClick={onReturnToCurrent}
            >
              收起旁读
            </button>
          </div>
        </header>
      )}
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
  hovered: boolean;
}

const EdgeShell = React.memo(function EdgeShell({
  item,
  index,
  register,
  onActivate,
  onReadBeside,
  onHover,
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
      onPointerEnter={() => onHover(key)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(null)}
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
      className={`spatial-stack-root spatial-stack-root-${group.slot} ${open ? "is-open" : ""} ${hovered ? "is-hovered" : ""}`}
      data-hit-role="document-affordance"
      data-stack-id={group.id}
      onClick={onToggle}
      onPointerEnter={() => onHover(group.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(group.id)}
      onBlur={() => onHover(null)}
      aria-expanded={open}
      aria-label={`${bandLabel(group.band)}折页，已载入 ${group.leaves.length} 份${unknown ? "，还有未载入成员" : ""}`}
    >
      <span className="spatial-stack-edges" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="spatial-stack-copy">
        <strong>{front.document.title}</strong>
        <small>
          {group.leaves.length} 份 ·{" "}
          {unknown ? "已载入，仍在载入" : "按 Enter 查看"}
        </small>
      </span>
      <span className="spatial-stack-count" aria-hidden="true">
        {group.leaves.length}
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
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const visible = items.slice(start, start + limit);
  const hasPrevious = start > 0;
  const hasNext = start + limit < items.length;
  return (
    <div
      className={`spatial-fan spatial-fan-${group.slot}`}
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
              onPointerLeave={() => onHover(null)}
            >
              <span className="spatial-fan-fold" aria-hidden="true" />
              <button
                type="button"
                className="spatial-fan-primary"
                data-hit-role="document-affordance"
                onFocus={() => onHover(key)}
                onBlur={() => onHover(null)}
                onClick={() => onActivate(item)}
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
  camera,
  documents,
  catalogue,
  neighborhood,
  connections,
  selectedConnectionId,
  pending,
  onReadBeside,
  onPromote,
  onReturnToCurrent,
  onFollow,
  onHistory,
  onScroll,
  onCameraCheckpoint,
  renderDocument,
  controllerRef,
}: SpatialSceneProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const surfaceNodes = useRef(new Map<string, HTMLElement>());
  const edgeNodes = useRef(new Map<string, HTMLElement>());
  const inputRef = useRef({
    current,
    companion,
    previous,
    camera: clampPose(camera),
    connections,
    selectedConnectionId,
    documents,
    neighborhood,
  });
  const livePose = useRef<Pose>(clampPose(camera));
  const targetPose = useRef<Pose>(clampPose(camera));
  const animationFrame = useRef<number | null>(null);
  const animationGeneration = useRef(0);
  const transitionStarted = useRef(0);
  const [fan, setFan] = useState<FanState | null>(null);
  const [hoveredState, setHoveredState] = useState<{
    readonly key: string;
    readonly centerRevisionId: RevisionId | null;
  } | null>(null);
  const [selectionActive, setSelectionActive] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const [beams, setBeams] = useState<readonly Beam[]>([]);
  const beamWorldCache = useRef<readonly Beam[]>([]);
  const beamDescriptors = useRef<readonly Beam[]>([]);
  const cameraMoving = useRef(false);
  const beamPathNodes = useRef(new Map<ConnectionId, SVGPathElement>());
  const beamPaperEdgeLabelNodes = useRef(
    new Map<ConnectionId, SVGTextElement>(),
  );
  const beamLabelNodes = useRef(new Map<ConnectionId, HTMLButtonElement>());
  const viewportSize = useRef<{ width: number; height: number } | null>(null);
  const measureFrame = useRef<number | null>(null);
  const pointers = useRef(new Map<number, PointerPoint>());
  const pinch = useRef<{ distance: number; center: Point } | null>(null);
  const gestureDelta = useRef({
    panX: 0,
    panY: 0,
    orbitX: 0,
    orbitY: 0,
    zoom: 0,
    anchor: null as Point | null,
  });
  const gestureFrame = useRef<number | null>(null);
  const drag = useRef<DragState>(null);
  const spacePressed = useRef(false);
  const wheelAccum = useRef({ x: 0, y: 0, zoom: 0, anchor: { x: 0, y: 0 } });
  const wheelFrame = useRef<number | null>(null);
  const wheelCheckpoint = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();
  const [narrow, setNarrow] = useState(false);
  const [sceneSize, setSceneSize] = useState({ width: 0, height: 0 });

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
    (key: string, node: HTMLElement | null) => {
      if (node) surfaceNodes.current.set(key, node);
      else surfaceNodes.current.delete(key);
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
    const screenFor = (endpoint: Endpoint): Point => {
      if (endpoint.coordinateSpace === "viewport" || !endpoint.worldPoint)
        return { x: endpoint.x, y: endpoint.y };
      return worldToScreen(endpoint.worldPoint, livePose.current, viewport);
    };
    for (const beam of beamWorldCache.current) {
      if (cameraMoving.current && !beam.selected) continue;
      const fromScreen = screenFor(beam.from);
      const toScreen = screenFor(beam.to);
      const path = pathForBeam(fromScreen, toScreen);
      beamPathNodes.current.get(beam.id)?.setAttribute("d", path);
      const labelScreen = beam.labelWorld
        ? worldToScreen(beam.labelWorld, livePose.current, viewport)
        : {
            x: (fromScreen.x + toScreen.x) / 2,
            y: (fromScreen.y + toScreen.y) / 2,
          };
      const paperEdgeLabel = beamPaperEdgeLabelNodes.current.get(beam.id);
      if (paperEdgeLabel) {
        paperEdgeLabel.setAttribute("x", `${labelScreen.x}`);
        paperEdgeLabel.setAttribute("y", `${labelScreen.y - 8}`);
      }
      const label = beamLabelNodes.current.get(beam.id);
      if (label) {
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

  const cancelPoseAnimation = useCallback(() => {
    animationGeneration.current += 1;
    if (animationFrame.current !== null) {
      window.cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
    // An input gesture takes over the pose that was actually painted.  The
    // next gesture frame/checkpoint will replace this target with its latest
    // desired pose.
    targetPose.current = clampPose(livePose.current);
  }, []);

  const writePose = useCallback(
    (pose: Pose) => {
      livePose.current = clampPose(pose);
      if (worldRef.current)
        worldRef.current.style.transform = cameraTransform(livePose.current);
      renderCachedBeams();
    },
    [renderCachedBeams],
  );

  const animateTo = useCallback(
    (next: Pose, duration = 400) => {
      const target = clampPose(next);
      cancelPoseAnimation();
      targetPose.current = target;
      const from = livePose.current;
      if (reducedMotion || samePose(from, target)) {
        beginCameraMotion();
        writePose(target);
        settleCameraMotion();
        return;
      }
      beginCameraMotion();
      const generation = animationGeneration.current;
      transitionStarted.current = performance.now();
      const frame = (now: number) => {
        if (generation !== animationGeneration.current) return;
        const amount = clamp(
          (now - transitionStarted.current) / duration,
          0,
          1,
        );
        writePose(interpolate(from, target, easeAttention(amount)));
        if (amount < 1)
          animationFrame.current = window.requestAnimationFrame(frame);
        else {
          animationFrame.current = null;
          settleCameraMotion();
        }
      };
      animationFrame.current = window.requestAnimationFrame(frame);
    },
    [
      beginCameraMotion,
      cancelPoseAnimation,
      reducedMotion,
      settleCameraMotion,
      writePose,
    ],
  );

  const checkpoint = useCallback(() => {
    const settled = clampPose(livePose.current);
    targetPose.current = settled;
    settleCameraMotion();
    onCameraCheckpoint(settled);
  }, [onCameraCheckpoint, settleCameraMotion]);

  const scheduleCheckpoint = useCallback(() => {
    if (wheelCheckpoint.current !== null)
      window.clearTimeout(wheelCheckpoint.current);
    wheelCheckpoint.current = window.setTimeout(() => {
      wheelCheckpoint.current = null;
      checkpoint();
    }, 100);
  }, [checkpoint]);

  const measureAnchor = useCallback(
    (anchor: Anchor, viewport: DOMRect): Endpoint | null => {
      const candidates = [...surfaceNodes.current.values()];
      const exactRoot = candidates.find(
        (root) =>
          root.dataset.revisionId === anchor.revisionId &&
          root.dataset.documentId === anchor.documentId,
      );
      if (exactRoot) {
        const ranges = sourceRanges(exactRoot, {
          revisionId: anchor.revisionId,
          start: anchor.start,
          end: anchor.end,
        });
        const rangeRects = ranges
          .flatMap((range) => Array.from(range.getClientRects()))
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map(rectFromDomRect);
        const source = unionRects(rangeRects);
        const scroll = exactRoot.querySelector<HTMLElement>(
          "[data-document-scroll]",
        );
        const clip = intersectRects(
          viewport,
          scroll ? rectFromDomRect(scroll.getBoundingClientRect()) : viewport,
        );
        if (source && clip) {
          const visible = intersectRects(source, clip);
          const point = visible
            ? {
                x: (visible.left + visible.right) / 2,
                y: (visible.top + visible.bottom) / 2,
              }
            : clampPoint(
                {
                  x: (source.left + source.right) / 2,
                  y: (source.top + source.bottom) / 2,
                },
                clip,
              );
          const world = screenToWorld(
            { x: point.x - viewport.left, y: point.y - viewport.top },
            livePose.current,
            viewport,
          );
          return {
            x: point.x - viewport.left,
            y: point.y - viewport.top,
            coordinateSpace: "world" as const,
            clipped: !visible,
            paperEdge: !visible,
            worldPoint: world,
          };
        }
        if (clip) {
          const gap = Array.from(
            exactRoot.querySelectorAll<HTMLElement>(
              "[data-source-gap-start][data-source-gap-end]",
            ),
          ).find(
            (node) =>
              Number(node.dataset.sourceGapStart) <= anchor.start &&
              Number(node.dataset.sourceGapEnd) >= anchor.end,
          );
          if (gap) {
            const gapRect = rectFromDomRect(gap.getBoundingClientRect());
            const above =
              gapRect.bottom <= clip.top ||
              (gapRect.top < clip.top && gapRect.bottom < clip.bottom);
            const point = {
              x: (clip.left + clip.right) / 2,
              y: above ? clip.top : clip.bottom,
            };
            const world = screenToWorld(
              { x: point.x - viewport.left, y: point.y - viewport.top },
              livePose.current,
              viewport,
            );
            return {
              x: point.x - viewport.left,
              y: point.y - viewport.top,
              coordinateSpace: "world" as const,
              clipped: true,
              paperEdge: true,
              worldPoint: world,
            };
          }
        }
      }

      const fallback = [...edgeNodes.current.values()].find(
        (node) =>
          node.dataset.documentId === anchor.documentId &&
          node.dataset.revisionId === anchor.revisionId,
      );
      if (!fallback) return null;
      const fallbackRect = rectFromDomRect(fallback.getBoundingClientRect());
      const visible = intersectRects(fallbackRect, viewport);
      const point = visible
        ? {
            x: (visible.left + visible.right) / 2,
            y: (visible.top + visible.bottom) / 2,
          }
        : clampPoint(
            {
              x: (fallbackRect.left + fallbackRect.right) / 2,
              y: (fallbackRect.top + fallbackRect.bottom) / 2,
            },
            viewport,
          );
      return {
        x: point.x - viewport.left,
        y: point.y - viewport.top,
        coordinateSpace: "viewport" as const,
        clipped: true,
        paperEdge: true,
        worldPoint: null,
      };
    },
    [],
  );

  const measureBeams = useCallback(() => {
    const viewportNode = viewportRef.current;
    if (!viewportNode) return;
    const viewport = viewportNode.getBoundingClientRect();
    viewportSize.current = {
      width: viewport.width,
      height: viewport.height,
    };
    const paperRects = [...surfaceNodes.current.values()]
      .filter((node) => node.classList.contains("spatial-paper"))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left - viewport.left,
          top: rect.top - viewport.top,
          right: rect.right - viewport.left,
          bottom: rect.bottom - viewport.top,
        };
      });
    const currentPosition = inputRef.current.current?.position;
    const companionPosition = inputRef.current.companion?.position;
    const currentDocument = inputRef.current.current?.document;
    const companionDocument = inputRef.current.companion?.document;
    const labelFor = (anchor: Anchor) => {
      const mounted = [currentDocument, companionDocument].find(
        (doc) => doc?.revisionId === anchor.revisionId,
      );
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
          metadata?.revisionId === anchor.revisionId ? metadata.sequence : null,
      };
    };
    const candidateConnections = inputRef.current.connections
      .slice()
      .sort((a, b) => {
        const score = (connection: Connection) => {
          const endpoints = [connection.from, connection.to];
          return (
            (inputRef.current.selectedConnectionId === connection.id
              ? 1000
              : 0) +
            endpoints.filter(
              (anchor) =>
                currentPosition && anchorMatches(anchor, currentPosition),
            ).length *
              16 +
            endpoints.filter(
              (anchor) =>
                companionPosition && anchorMatches(anchor, companionPosition),
            ).length *
              8
          );
        };
        return score(b) - score(a);
      });
    const limit = narrow ? NARROW_BEAM_LIMIT : DESKTOP_BEAM_LIMIT;
    const selected = candidateConnections.filter(
      (connection) => connection.id === inputRef.current.selectedConnectionId,
    );
    const selectedIds = new Set(selected.map((connection) => connection.id));
    const prioritized = [
      ...selected,
      ...candidateConnections.filter(
        (connection) => !selectedIds.has(connection.id),
      ),
    ].slice(0, limit);
    const measured: Beam[] = [];
    for (const connection of prioritized) {
      const from = measureAnchor(connection.from, viewport);
      const to = measureAnchor(connection.to, viewport);
      if (!from || !to) continue;
      const fromDoc = labelFor(connection.from);
      const toDoc = labelFor(connection.to);
      const fromScreen = { x: from.x, y: from.y };
      const toScreen = { x: to.x, y: to.y };
      const labelPoint = beamLabelPoint(fromScreen, toScreen, paperRects);
      const labelWorld =
        from.coordinateSpace === "world" && to.coordinateSpace === "world"
          ? screenToWorld(labelPoint, livePose.current, viewport)
          : null;
      measured.push({
        id: connection.id,
        label: connection.label || RELATION_LABELS[connection.relation],
        endpointLabel: endpointLabel(fromDoc, toDoc),
        color: RELATION_COLORS[connection.relation],
        from,
        to,
        selected: connection.id === inputRef.current.selectedConnectionId,
        exact: !from.paperEdge && !to.paperEdge,
        path: pathForBeam(fromScreen, toScreen),
        labelPoint,
        labelWorld,
      });
    }
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
          old.color !== beam.color ||
          old.selected !== beam.selected ||
          old.exact !== beam.exact
        );
      });
    if (descriptionsChanged) {
      beamDescriptors.current = measured;
      setBeams(measured);
    }
    renderCachedBeams();
  }, [measureAnchor, narrow, renderCachedBeams]);

  const scheduleMeasure = useCallback(() => {
    if (measureFrame.current !== null) return;
    measureFrame.current = window.requestAnimationFrame(() => {
      measureFrame.current = null;
      measureBeams();
    });
  }, [measureBeams]);

  useEffect(() => {
    inputRef.current = {
      current,
      companion,
      previous,
      camera: clampPose(camera),
      connections,
      selectedConnectionId,
      documents,
      neighborhood,
    };
    targetPose.current = clampPose(camera);
    if (!samePose(livePose.current, targetPose.current))
      animateTo(targetPose.current);
    scheduleMeasure();
  }, [
    animateTo,
    camera,
    companion,
    connections,
    documents,
    neighborhood,
    current,
    previous,
    scheduleMeasure,
    selectedConnectionId,
  ]);

  useLayoutEffect(() => {
    if (worldRef.current)
      worldRef.current.style.transform = cameraTransform(livePose.current);
    scheduleMeasure();
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    renderCachedBeams();
  }, [beams, renderCachedBeams]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onResize = () => scheduleMeasure();
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
    scheduleMeasure,
    current?.position.revisionId,
    companion?.position.revisionId,
  ]);

  useEffect(() => {
    return () => {
      cancelPoseAnimation();
      settleCameraMotion();
      if (measureFrame.current !== null)
        window.cancelAnimationFrame(measureFrame.current);
      if (gestureFrame.current !== null)
        window.cancelAnimationFrame(gestureFrame.current);
      if (wheelFrame.current !== null)
        window.cancelAnimationFrame(wheelFrame.current);
      if (wheelCheckpoint.current !== null)
        window.clearTimeout(wheelCheckpoint.current);
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    };
  }, [cancelPoseAnimation, settleCameraMotion]);

  const resetCamera = useCallback(() => {
    const home = { x: 0, y: 0, yaw: 0, pitch: 0, zoom: 1 };
    animateTo(home);
    onCameraCheckpoint(home);
  }, [animateTo, onCameraCheckpoint]);

  useImperativeHandle(
    controllerRef,
    () => ({ resetCamera, measure: scheduleMeasure }),
    [resetCamera, scheduleMeasure],
  );

  const excludedPositions = useMemo(
    () =>
      [current?.position, companion?.position, previous?.position].filter(
        (position): position is ReadingPosition => Boolean(position),
      ),
    [companion?.position, current?.position, previous?.position],
  );
  const edgeGroups = useMemo(
    () => {
      const currentRevisionId = current?.position.revisionId ?? null;
      const centeredKnowledge =
        currentRevisionId &&
        neighborhood.kind !== "idle" &&
        neighborhood.centerRevisionId !== currentRevisionId
          ? ({ kind: "idle" } as const)
          : neighborhood;
      return projectEdges(documents, centeredKnowledge, excludedPositions);
    },
    [current?.position.revisionId, documents, excludedPositions, neighborhood],
  );
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
  }, [activeFan]);

  const activateEdge = useCallback(
    (item: EdgeItem) => {
      closeFan();
      const activation = resolveEdgeActivation(
        item,
        current?.position.revisionId ?? null,
        connections,
      );
      if (activation.kind === "follow") onFollow(activation.connectionId);
      else onReadBeside(activation.target);
    },
    [closeFan, connections, current?.position.revisionId, onFollow, onReadBeside],
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
    [closeFan, current?.position.revisionId, fanOpen],
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
    if (
      !hoveredState ||
      hoveredState.centerRevisionId === currentRevisionId
    )
      return;
    const clear = window.setTimeout(() => setHoveredState(null), 0);
    return () => window.clearTimeout(clear);
  }, [currentRevisionId, hoveredState]);

  const updateHover = useCallback((key: string | null) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    const centerRevisionId = current?.position.revisionId ?? null;
    if (key === null) {
      hoverTimer.current = window.setTimeout(() => setHoveredState(null), 120);
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
  }, [current?.position.revisionId]);

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      const active = Boolean(selection && !selection.isCollapsed);
      setSelectionActive(active);
      if (active) {
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
  }, []);

  const applyPan = useCallback(
    (dx: number, dy: number) => {
      const viewport = viewportSize.current;
      if (!viewport) return;
      cancelPoseAnimation();
      beginCameraMotion();
      const center = { x: viewport.width / 2, y: viewport.height / 2 };
      const world = screenToWorld(center, livePose.current, viewport);
      writePose(
        poseForScreenAnchor(
          world,
          { x: center.x + dx, y: center.y + dy },
          livePose.current,
          viewport,
        ),
      );
    },
    [beginCameraMotion, cancelPoseAnimation, writePose],
  );

  const applyZoom = useCallback(
    (delta: number, anchor: Point | null) => {
      const viewport = viewportSize.current;
      if (!viewport) return;
      cancelPoseAnimation();
      beginCameraMotion();
      const before = livePose.current;
      const nextZoom = clamp(
        before.zoom * Math.exp(-delta * 0.001),
        CAMERA_LIMITS.zoomMin,
        CAMERA_LIMITS.zoomMax,
      );
      const point = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
      const world = screenToWorld(point, before, viewport);
      const next = poseForScreenAnchor(
        world,
        point,
        {
          ...before,
          zoom: nextZoom,
        },
        viewport,
      );
      writePose(next);
    },
    [beginCameraMotion, cancelPoseAnimation, writePose],
  );

  const flushGesture = useCallback(() => {
    gestureFrame.current = null;
    const delta = gestureDelta.current;
    gestureDelta.current = {
      panX: 0,
      panY: 0,
      orbitX: 0,
      orbitY: 0,
      zoom: 0,
      anchor: null,
    };
    if (
      delta.panX === 0 &&
      delta.panY === 0 &&
      delta.orbitX === 0 &&
      delta.orbitY === 0 &&
      delta.zoom === 0
    )
      return;
    beginCameraMotion();
    const viewport = viewportSize.current;
    let next = { ...livePose.current };
    if (delta.panX !== 0 || delta.panY !== 0) {
      if (viewport) {
        const center = { x: viewport.width / 2, y: viewport.height / 2 };
        const world = screenToWorld(center, next, viewport);
        next = poseForScreenAnchor(
          world,
          { x: center.x + delta.panX, y: center.y + delta.panY },
          next,
          viewport,
        );
      }
    }
    if (delta.orbitX !== 0 || delta.orbitY !== 0) {
      next = {
        ...next,
        yaw: next.yaw + delta.orbitX * 0.18,
        pitch: next.pitch + delta.orbitY * 0.12,
      };
    }
    if (delta.zoom !== 0 && viewport) {
      const anchor = delta.anchor ?? {
        x: viewport.width / 2,
        y: viewport.height / 2,
      };
      const nextZoom = clamp(
        next.zoom * Math.exp(-delta.zoom * 0.001),
        CAMERA_LIMITS.zoomMin,
        CAMERA_LIMITS.zoomMax,
      );
      const world = screenToWorld(anchor, next, viewport);
      next = poseForScreenAnchor(
        world,
        anchor,
        { ...next, zoom: nextZoom },
        viewport,
      );
    }
    writePose(next);
  }, [beginCameraMotion, writePose]);

  const scheduleGesture = useCallback(() => {
    if (gestureFrame.current !== null) return;
    gestureFrame.current = window.requestAnimationFrame(flushGesture);
  }, [flushGesture]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (narrow) return;
      const target = event.target as HTMLElement;
      const role =
        target.closest<HTMLElement>("[data-hit-role]")?.dataset.hitRole;
      const explicitPan = spacePressed.current && !isControlTarget(target);
      if (!explicitPan && role && role !== "stage") {
        if (role === "text") {
          cancelPoseAnimation();
          settleCameraMotion();
        }
        return;
      }
      if (event.button !== 0 && event.pointerType !== "touch") return;
      if (explicitPan) event.preventDefault();
      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        pointerType: event.pointerType,
      });
      if (pointers.current.size >= 2 && event.pointerType === "touch") {
        cancelPoseAnimation();
        beginCameraMotion();
        drag.current = { kind: "pinch", pointerId: event.pointerId };
        const points = [...pointers.current.values()];
        const [first, second] = points;
        const viewport = viewportRef.current?.getBoundingClientRect();
        pinch.current = {
          distance: Math.max(
            1,
            Math.hypot(first.x - second.x, first.y - second.y),
          ),
          center: viewport
            ? {
                x: (first.x + second.x) / 2 - viewport.left,
                y: (first.y + second.y) / 2 - viewport.top,
              }
            : { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }
      drag.current = {
        kind: "pending",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        spaceOverride: explicitPan,
        // Capture the modifier at pointerdown.  Once the movement crosses
        // the threshold, changing Shift must not switch an in-flight pan to
        // orbit (or vice versa).
        orbitRequested: event.shiftKey && !explicitPan,
      };
    },
    [beginCameraMotion, cancelPoseAnimation, narrow, settleCameraMotion],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = pointers.current.get(event.pointerId);
      if (point) {
        point.x = event.clientX;
        point.y = event.clientY;
      }
      const active = drag.current;
      if (
        !active ||
        (active.kind !== "pinch" && active.pointerId !== event.pointerId)
      )
        return;
      if (active.kind === "pinch") {
        const points = [...pointers.current.values()];
        if (points.length < 2 || !pinch.current) return;
        const [a, b] = points;
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const viewport = viewportRef.current?.getBoundingClientRect();
        const center = viewport
          ? {
              x: (a.x + b.x) / 2 - viewport.left,
              y: (a.y + b.y) / 2 - viewport.top,
            }
          : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gestureDelta.current.panX += center.x - pinch.current.center.x;
        gestureDelta.current.panY += center.y - pinch.current.center.y;
        gestureDelta.current.zoom += (pinch.current.distance - distance) * 2;
        gestureDelta.current.anchor = center;
        pinch.current = { distance, center };
        scheduleGesture();
        return;
      }
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      const moved = Math.hypot(
        event.clientX - active.startX,
        event.clientY - active.startY,
      );
      const threshold = active.pointerType === "touch" ? 8 : 4;
      if (active.kind === "pending") {
        if (moved < threshold) return;
        active.kind = active.orbitRequested ? "orbit" : "pan";
        cancelPoseAnimation();
        beginCameraMotion();
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      event.preventDefault();
      active.x = event.clientX;
      active.y = event.clientY;
      if (active.kind === "orbit") {
        gestureDelta.current.orbitX += dx;
        gestureDelta.current.orbitY += dy;
      } else {
        gestureDelta.current.panX += dx;
        gestureDelta.current.panY += dy;
      }
      scheduleGesture();
    },
    [beginCameraMotion, cancelPoseAnimation, scheduleGesture],
  );

  const finishPointer = useCallback(
    (event?: React.PointerEvent<HTMLDivElement>) => {
      if (event) pointers.current.delete(event.pointerId);
      const active = drag.current;
      if (active?.kind === "pending") {
        drag.current = null;
        return;
      }
      if (pointers.current.size < 2) drag.current = null;
      if (pointers.current.size < 2) pinch.current = null;
      if (active) {
        if (gestureFrame.current !== null) {
          window.cancelAnimationFrame(gestureFrame.current);
          flushGesture();
        }
        checkpoint();
        if (event) event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    },
    [checkpoint, flushGesture],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (narrow) return;
      const target = event.target as HTMLElement;
      const role =
        target.closest<HTMLElement>("[data-hit-role]")?.dataset.hitRole;
      const inText = Boolean(target.closest("[data-document-scroll]"));
      if (inText || (role && role !== "stage")) return;
      event.preventDefault();
      wheelAccum.current.x += event.shiftKey ? event.deltaY : event.deltaX;
      wheelAccum.current.y += event.shiftKey ? 0 : event.deltaY;
      if (event.ctrlKey || event.metaKey)
        wheelAccum.current.zoom += event.deltaY;
      wheelAccum.current.anchor = {
        x: event.nativeEvent.offsetX,
        y: event.nativeEvent.offsetY,
      };
      if (wheelFrame.current !== null) return;
      wheelFrame.current = window.requestAnimationFrame(() => {
        wheelFrame.current = null;
        const pendingWheel = wheelAccum.current;
        wheelAccum.current = {
          x: 0,
          y: 0,
          zoom: 0,
          anchor: pendingWheel.anchor,
        };
        if (pendingWheel.zoom !== 0)
          applyZoom(pendingWheel.zoom, pendingWheel.anchor);
        else applyPan(-pendingWheel.x, -pendingWheel.y);
        scheduleCheckpoint();
      });
    },
    [applyPan, applyZoom, scheduleCheckpoint, narrow],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (event.key === "Escape" && fanOpen) {
        event.preventDefault();
        event.stopPropagation();
        closeFan();
        return;
      }
      if (narrow || isControlTarget(target)) return;
      if (event.code === "Space") {
        spacePressed.current = true;
        if (!target.closest("[data-document-scroll]")) event.preventDefault();
        return;
      }
      if (target.closest("[data-document-scroll]")) return;
      if (event.key === "0") {
        event.preventDefault();
        resetCamera();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        applyZoom(-80, null);
        checkpoint();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        applyZoom(80, null);
        checkpoint();
      } else if (event.shiftKey && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const delta = {
          ArrowLeft: { x: -36, y: 0 },
          ArrowRight: { x: 36, y: 0 },
          ArrowUp: { x: 0, y: -36 },
          ArrowDown: { x: 0, y: 36 },
        }[event.key];
        if (delta) {
          applyPan(delta.x, delta.y);
          checkpoint();
        }
      }
    },
    [applyPan, applyZoom, checkpoint, resetCamera, narrow, fanOpen, closeFan],
  );

  const onKeyUp = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.code === "Space") spacePressed.current = false;
  }, []);

  useEffect(() => {
    const releaseInput = () => {
      spacePressed.current = false;
      drag.current = null;
      pinch.current = null;
      const viewport = viewportRef.current;
      for (const id of pointers.current.keys())
        if (viewport?.hasPointerCapture(id)) viewport.releasePointerCapture(id);
      pointers.current.clear();
      if (gestureFrame.current !== null) {
        window.cancelAnimationFrame(gestureFrame.current);
        flushGesture();
      }
      if (wheelFrame.current !== null) {
        window.cancelAnimationFrame(wheelFrame.current);
        wheelFrame.current = null;
      }
      wheelAccum.current = { x: 0, y: 0, zoom: 0, anchor: { x: 0, y: 0 } };
      if (wheelCheckpoint.current !== null) {
        window.clearTimeout(wheelCheckpoint.current);
        wheelCheckpoint.current = null;
      }
      cancelPoseAnimation();
      checkpoint();
    };
    const onVisibility = () => {
      if (document.hidden) releaseInput();
    };
    window.addEventListener("blur", releaseInput);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", releaseInput);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancelPoseAnimation, checkpoint, flushGesture]);

  const currentSurfaceKey = current ? surfaceIdentity(current.position) : null;
  const companionSurfaceKey = companion
    ? surfaceIdentity(companion.position)
    : null;
  const sameSurfaceIdentity =
    currentSurfaceKey !== null && currentSurfaceKey === companionSurfaceKey;
  const visibleGroups = edgeGroups.filter((group) => {
    return group.leaves.length > 2;
  });
  const individualEdges = edgeGroups
    .filter((group) => group.leaves.length <= 2)
    .flatMap((group) => group.leaves)
    .slice(0, narrow ? NARROW_EDGE_LIMIT : DESKTOP_EDGE_LIMIT);
  const shellGroups = visibleGroups.slice(
    0,
    narrow
      ? Math.ceil(NARROW_EDGE_LIMIT / 4)
      : Math.ceil(DESKTOP_EDGE_LIMIT / 4),
  );
  const sceneLayout = useMemo(() => {
    if (narrow || sceneSize.width <= 0)
      return {
        paperWidth: null as number | null,
        paperMaxHeight: null as number | null,
        currentPosition: { x: 0, y: 0 },
        companionPosition: { x: 0, y: 0 },
      };

    const width = sceneSize.width;
    const splitWidth = Math.min(720, Math.max(260, (width - 100) / 2));
    const gap = 28;
    const paperWidth = companion
      ? splitWidth
      : Math.min(720, Math.max(260, width - 80));
    const offset = splitWidth / 2 + gap / 2;
    return {
      paperWidth,
      paperMaxHeight:
        sceneSize.height > 0 ? Math.max(180, sceneSize.height - 28) : null,
      currentPosition: { x: companion ? -offset : 0, y: 0 },
      companionPosition: { x: offset, y: 12 },
    };
  }, [companion, narrow, sceneSize.height, sceneSize.width]);
  const currentPosition = sceneLayout.currentPosition;
  const companionPosition = sceneLayout.companionPosition;

  return (
    <section
      className={`spatial-scene ${selectionActive ? "selection-active" : ""}`}
      aria-label="连续文档空间"
    >
      <div
        ref={viewportRef}
        className="spatial-scene-viewport"
        data-hit-role="stage"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onLostPointerCapture={finishPointer}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <div
          className="spatial-stage-input"
          data-hit-role="stage"
          aria-hidden="true"
        />
        <div ref={worldRef} className="spatial-scene-world">
          {current && (
            <SurfacePaper
              key={
                sameSurfaceIdentity
                  ? `${currentSurfaceKey}:current`
                  : currentSurfaceKey!
              }
              surface={current}
              role="current"
              instanceKey={
                sameSurfaceIdentity
                  ? `${currentSurfaceKey}:current`
                  : currentSurfaceKey!
              }
              position={currentPosition}
              paperWidth={sceneLayout.paperWidth}
              paperMaxHeight={sceneLayout.paperMaxHeight}
              register={registerSurface}
              onScroll={onScroll}
              onLayoutDirty={scheduleMeasure}
              onPromote={onPromote}
              onReturnToCurrent={onReturnToCurrent}
              renderDocument={renderDocument}
            />
          )}
          {companion && (
            <SurfacePaper
              key={
                sameSurfaceIdentity
                  ? `${companionSurfaceKey}:companion`
                  : companionSurfaceKey!
              }
              surface={companion}
              role="companion"
              instanceKey={
                sameSurfaceIdentity
                  ? `${companionSurfaceKey}:companion`
                  : companionSurfaceKey!
              }
              position={companionPosition}
              paperWidth={sceneLayout.paperWidth}
              paperMaxHeight={sceneLayout.paperMaxHeight}
              register={registerSurface}
              onScroll={onScroll}
              onLayoutDirty={scheduleMeasure}
              onPromote={onPromote}
              onReturnToCurrent={onReturnToCurrent}
              renderDocument={renderDocument}
            />
          )}
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
              hovered={renderedHovered === `edge:${item.key}`}
            />
          ))}
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
                    onPrevious={() =>
                      setFan((currentFan) =>
                        currentFan
                          ? {
                              ...currentFan,
                              window: Math.max(0, currentFan.window - fanLimit),
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
                                Math.max(0, currentFan.items.length - fanLimit),
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
        <svg
          className="spatial-scene-beams"
          aria-label="文档之间的精确文字连接"
          preserveAspectRatio="none"
        >
          {beams.map((beam) => (
            <g key={beam.id} data-beam-connection-id={beam.id}>
              <path
                ref={(node) => {
                  if (node) beamPathNodes.current.set(beam.id, node);
                  else beamPathNodes.current.delete(beam.id);
                }}
                d={beam.path}
                className={`spatial-beam ${beam.selected ? "is-selected" : ""} ${beam.exact ? "is-exact" : "is-paper-edge"}`}
                stroke={beam.color}
                fill="none"
                tabIndex={0}
                role="button"
                pointerEvents="stroke"
                data-hit-role="relation"
                aria-label={`激活${beam.label}连接；${beam.endpointLabel}${beam.exact ? "" : "；阅读另一端"}`}
                onClick={() => onFollow(beam.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onFollow(beam.id);
                  }
                }}
              >
                <title>{beam.endpointLabel}</title>
              </path>
              {!beam.exact && (
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
                  阅读另一端
                </text>
              )}
            </g>
          ))}
        </svg>
        <div className="spatial-beam-labels" aria-label="可见连接">
          {beams
            .filter((beam) => beam.selected || beam.exact)
            .slice(0, 3)
            .map((beam) => (
              <button
                type="button"
                ref={(node) => {
                  if (node) beamLabelNodes.current.set(beam.id, node);
                  else beamLabelNodes.current.delete(beam.id);
                }}
                key={beam.id}
                className={`spatial-beam-label ${beam.selected ? "is-selected" : ""}`}
                data-hit-role="relation"
                style={
                  {
                    left: 0,
                    top: 0,
                    transform: `translate3d(${beam.labelPoint.x}px, ${beam.labelPoint.y}px, 0) translate(-50%, -50%)`,
                    "--beam-color": beam.color,
                  } as React.CSSProperties
                }
                onClick={() => onFollow(beam.id)}
                aria-label={`${beam.label}：${beam.endpointLabel}`}
                title={`${beam.label}：${beam.endpointLabel}`}
              >
                <span className="spatial-beam-label-short" aria-hidden="true">
                  连接
                </span>
                <span className="spatial-beam-label-detail" aria-hidden="true">
                  {beam.label}
                </span>
              </button>
            ))}
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
