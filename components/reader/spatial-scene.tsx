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
  SpatialSceneProps as Contract,
  ReadingSurface,
  SpaceSurface,
  PassageHandle,
  SurfaceInstanceId,
  DocumentRenderContext,
} from "../../lib/reader/spatial-contract";
import { quat, vec3 } from "gl-matrix";
import type { AnchorInput, ConnectionId } from "../../lib/domain/model";
import type { SpaceView } from "../../lib/reader/space-view";
import {
  cameraTransform,
  matrixCss,
  paperTransform,
  paperToWorld,
  paperPoint,
  screenRay,
  screenPoint,
  worldPoint,
  isProjectionSafe,
  type PaperPose,
  type CameraViewport,
} from "../../lib/reader/camera";
import { SceneGeometry, visibleAnchorFragments } from "./scene-geometry";
import {
  buildRangeRibbon,
  clipRangeRibbonToCamera,
  triangleLeafGeometry,
  hitTestRangeRibbon,
  intersectPaperRay,
  type RangeRibbonMouthSegment,
  type RangeRibbonTriangle,
  type RangeRibbonProxyReason,
} from "../../lib/reader/range-ribbon";
import { defaultPaperPose, rangeScrollTarget } from "./scene-presentation";
import { SceneInteraction } from "./scene-interaction";
import { desiredFullText } from "../../lib/reader/space-residency";
import { relationStyle } from "../../lib/reader/semantic-palette";
import "./spatial-scene.css";
export interface SpatialSceneController {
  cancelInput(): void;
  measure(): void;
}
export type SpatialSceneProps = Omit<
  Contract,
  "renderDocument" | "renderDocumentMenu"
> & {
  controllerRef?: React.Ref<SpatialSceneController>;
  renderDocument(
    surface: ReadingSurface,
    context: DocumentRenderContext,
  ): React.ReactNode;
  renderDocumentMenu?(surface: ReadingSurface): React.ReactNode;
};
type Loaded = { surface: ReadingSurface };
type Band = {
  id: ConnectionId;
  triangles: readonly RangeRibbonTriangle[];
  color: string;
  label: string;
};
type ProxyMouth = {
  key: string;
  reason: RangeRibbonProxyReason;
  transform: string;
  color: string;
};
const proxyLabels: Record<RangeRibbonProxyReason, string> = {
  "outside-visible-text": "原文在可见范围外",
  unmapped: "原文范围无法映射",
  folded: "展开后定位原文",
  unloaded: "正文尚未加载",
  loading: "正文加载中",
  error: "正文加载失败",
};
const initialViewport = { width: 1280, height: 850 };
function ScenePaper({
  surface,
  detailed,
  onRetry,
  pose,
  viewport,
  register,
  registerPassage,
  invalidate,
  registerAnchors,
  hitTestAnchor,
  onScroll,
  onFocus,
  renderDocument,
  renderDocumentMenu,
}: {
  surface: SpaceSurface;
  detailed: boolean;
  onRetry(id: SurfaceInstanceId): void;
  pose: PaperPose;
  viewport: CameraViewport;
  register(id: SurfaceInstanceId, node: HTMLElement | null): void;
  registerPassage(id: SurfaceInstanceId, handle: PassageHandle | null): void;
  invalidate(id?: SurfaceInstanceId): void;
  registerAnchors(id: SurfaceInstanceId, anchors: readonly AnchorInput[]): void;
  hitTestAnchor(
    id: SurfaceInstanceId,
    anchor: AnchorInput,
    point: { x: number; y: number },
  ): boolean;
  onScroll(id: SurfaceInstanceId, top: number): void;
  onFocus(id: SurfaceInstanceId): void;
  renderDocument: SpatialSceneProps["renderDocument"];
  renderDocumentMenu: SpatialSceneProps["renderDocumentMenu"];
}) {
  const document = surface.document ?? surface.metadata;
  const title = document?.title ?? "正在读取文档…";
  const reading = surface.document
    ? {
        surfaceId: surface.surfaceId,
        position: surface.position,
        document: surface.document,
      }
    : null;
  const width = detailed
    ? Math.min(600, Math.max(320, viewport.width - 48))
    : 205;
  const height = detailed
    ? Math.max(300, Math.min(780, viewport.height - 150))
    : 116;
  const context = useMemo<DocumentRenderContext>(
    () => ({
      registerPassage: (handle) => registerPassage(surface.surfaceId, handle),
      onGeometryChange: () => invalidate(surface.surfaceId),
      registerAnchors: (anchors) => registerAnchors(surface.surfaceId, anchors),
      hitTestAnchor: (anchor, point) =>
        hitTestAnchor(surface.surfaceId, anchor, point),
    }),
    [
      surface.surfaceId,
      registerPassage,
      invalidate,
      registerAnchors,
      hitTestAnchor,
    ],
  );
  const down = useRef<{ x: number; y: number } | null>(null);
  return (
    <article
      ref={(node) => register(surface.surfaceId, node)}
      className={
        detailed ? "spatial-paper" : "spatial-paper spatial-paper-fold"
      }
      data-paper
      tabIndex={detailed ? -1 : 0}
      onKeyDown={(event) => {
        if (!detailed && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onFocus(surface.surfaceId);
        }
      }}
      data-surface-key={surface.surfaceId}
      data-document-id={surface.position.documentId}
      data-revision-id={surface.position.revisionId}
      aria-label={title}
      style={{ width, height, transform: paperTransform(pose, width, height) }}
      onPointerDown={(event) => {
        down.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        if (event.defaultPrevented) return;
        const previous = down.current;
        down.current = null;
        if (
          !previous ||
          Math.hypot(previous.x - event.clientX, previous.y - event.clientY) > 5
        )
          return;
        if (
          (event.target as Element).closest(
            "button,a,input,textarea,[data-paper-grip]",
          )
        )
          return;
        if (detailed && window.getSelection()?.isCollapsed === false) return;
        onFocus(surface.surfaceId);
      }}
    >
      <header className="spatial-paper-header">
        <div>
          <h2>{title}</h2>
          <span>{document ? `v${document.sequence}` : "文档"}</span>
        </div>
        {detailed && reading && renderDocumentMenu?.(reading)}
      </header>
      {detailed && (
        <div
          className="spatial-paper-scroll"
          data-document-scroll
          onScroll={(event) =>
            detailed &&
            reading &&
            onScroll(surface.surfaceId, event.currentTarget.scrollTop)
          }
        >
          {detailed && reading ? (
            renderDocument(reading, context)
          ) : detailed ? (
            <p role="status">
              {surface.error ?? "正在读取正文…"}
              {surface.payload === "error" && (
                <button onClick={() => onRetry(surface.surfaceId)}>重试</button>
              )}
            </p>
          ) : null}
        </div>
      )}
      {(["top", "right", "bottom", "left"] as const).map((side, index) => (
        <div
          key={side}
          data-paper-grip={surface.surfaceId}
          className={`spatial-paper-edge spatial-paper-edge-${side}`}
          tabIndex={index === 0 ? 0 : -1}
          role="separator"
          aria-label={`移动纸页：${title}。方向键平移，Shift 加上下键调整远近。`}
          title="拖动纸边移动；Shift 拖动调整远近"
        />
      ))}
    </article>
  );
}
export function SpatialScene(props: SpatialSceneProps) {
  const viewportRef = useRef<HTMLDivElement>(null),
    worldRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<SurfaceInstanceId, HTMLElement>()),
    passages = useRef(new Map<SurfaceInstanceId, PassageHandle>());
  const geometry = useRef(new SceneGeometry());
  const anchors = useRef(new Map<SurfaceInstanceId, readonly AnchorInput[]>());
  const interaction = useRef(new SceneInteraction());
  const [viewport, setViewport] = useState(initialViewport),
    [draftView, setDraftView] = useState<{
      base: SpaceView;
      view: SpaceView;
    } | null>(null),
    [bands, setBands] = useState<Band[]>([]),
    [proxies, setProxies] = useState<ProxyMouth[]>([]),
    [measureEpoch, setMeasureEpoch] = useState(0);
  const view = draftView?.base === props.view ? draftView.view : props.view;
  const live = useRef(view);
  const propsRef = useRef(props);
  const viewportValue = useRef(viewport);
  const desired = useMemo(
    () => desiredFullText(props.surfaces, view, viewport),
    [props.surfaces, view, viewport],
  );
  const desiredIds = useMemo(() => new Set(desired), [desired]);
  const loaded = useMemo<Loaded[]>(
    () =>
      props.surfaces.flatMap((surface) =>
        surface.document && desiredIds.has(surface.surfaceId)
          ? [
              {
                surface: {
                  surfaceId: surface.surfaceId,
                  position: surface.position,
                  document: surface.document,
                },
              },
            ]
          : [],
      ),
    [props.surfaces, desiredIds],
  );
  const onDemandSurfaces = props.onDemandSurfaces;
  useEffect(() => onDemandSurfaces(desired), [desired, onDemandSurfaces]);
  const loadedRef = useRef(loaded);
  useLayoutEffect(() => {
    propsRef.current = props;
    viewportValue.current = viewport;
    loadedRef.current = loaded;
  }, [props, viewport, loaded]);
  const poseFor = useCallback(
    (value: SpaceView, id: SurfaceInstanceId) =>
      value.placements.get(id) ??
      defaultPaperPose(
        Math.max(
          0,
          propsRef.current.surfaces.findIndex(
            (surface) => surface.surfaceId === id,
          ),
        ),
      ),
    [],
  );
  const paint = useCallback((value: SpaceView) => {
    live.current = value;
    setDraftView({ base: propsRef.current.view, view: value });
  }, []);
  const checkpoint = useCallback(
    (value: SpaceView) => {
      paint(value);
      propsRef.current.onViewCheckpoint({
        generation: propsRef.current.presentation.id,
        view: value,
      });
    },
    [paint],
  );
  const invalidate = useCallback((id?: SurfaceInstanceId) => {
    geometry.current.invalidate(id);
    setMeasureEpoch((value) => value + 1);
  }, []);
  const register = useCallback(
    (id: SurfaceInstanceId, node: HTMLElement | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
    },
    [],
  );
  const registerPassage = useCallback(
    (id: SurfaceInstanceId, handle: PassageHandle | null) => {
      if (handle) passages.current.set(id, handle);
      else {
        passages.current.delete(id);
        geometry.current.invalidate(id);
      }
    },
    [],
  );
  const registerAnchors = useCallback(
    (id: SurfaceInstanceId, value: readonly AnchorInput[]) => {
      anchors.current.set(id, value);
      setMeasureEpoch((epoch) => epoch + 1);
    },
    [],
  );
  const hitTestAnchor = useCallback(
    (
      id: SurfaceInstanceId,
      anchor: AnchorInput,
      point: { x: number; y: number },
    ) => {
      const owner = geometry.current;
      const layout = owner.layouts.get(id);
      const surface = propsRef.current.surfaces.find(
        (item) => item.surfaceId === id,
      );
      const scroll = nodes.current
        .get(id)
        ?.querySelector<HTMLElement>("[data-document-scroll]");
      const root = viewportRef.current;
      if (
        !layout ||
        !scroll ||
        !root ||
        !surface ||
        surface.position.revisionId !== anchor.revisionId
      )
        return false;
      const rect = root.getBoundingClientRect();
      const ray = screenRay(
        screenPoint(point.x - rect.left, point.y - rect.top),
        live.current.camera,
        viewportValue.current,
      );
      const hit = intersectPaperRay(
        ray,
        poseFor(live.current, id),
        layout.width,
        layout.height,
      );
      const cached = owner.resolveAnchor(id, anchor, undefined, scroll, false);
      return (
        !!hit &&
        !!cached &&
        visibleAnchorFragments(cached, layout, scroll).some(
          (part) =>
            hit.point.x >= part.left &&
            hit.point.x <= part.right &&
            hit.point.y >= part.top &&
            hit.point.y <= part.bottom,
        )
      );
    },
    [poseFor],
  );
  const focus = useCallback((id: SurfaceInstanceId) => {
    if (!interaction.current.consumeClick())
      propsRef.current.onFocusSurface(id);
  }, []);
  useLayoutEffect(() => {
    live.current = props.view;
  }, [props.view]);
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
      invalidate();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [invalidate]);
  useEffect(() => {
    const fonts = document.fonts;
    const changed = () => invalidate();
    fonts.addEventListener("loadingdone", changed);
    return () => fonts.removeEventListener("loadingdone", changed);
  }, [invalidate]);
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    interaction.current.configure({
      context: () => {
        const rect = node.getBoundingClientRect();
        return {
          generation: propsRef.current.presentation.id,
          view: live.current,
          viewport: viewportValue.current,
          offset: { left: rect.left, top: rect.top },
          element: node,
        };
      },
      pose: poseFor,
      paint,
      checkpoint: (value) => propsRef.current.onViewCheckpoint(value),
      settled: () => {},
      stopPresentation: () => {},
    });
    const owner = interaction.current;
    const wheel = (event: WheelEvent) => owner.wheel(event);
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", wheel);
      owner.dispose();
    };
  }, [paint, poseFor]);
  useImperativeHandle(
    props.controllerRef,
    () => ({
      cancelInput: () => {
        interaction.current.cancel();
      },
      measure: invalidate,
    }),
    [invalidate],
  );
  const restored = useRef(new Map<SurfaceInstanceId, string>());
  useLayoutEffect(() => {
    const geometryOwner = geometry.current,
      node = viewportRef.current;
    if (!node) return;
    for (const surface of props.surfaces) {
      geometryOwner.setSurfaceContext(
        surface.surfaceId,
        JSON.stringify([
          viewport,
          desiredIds.has(surface.surfaceId),
          surface.position.documentId,
          surface.position.revisionId,
        ]),
      );
    }
    // Newly discovered bindings/marks require one neutral measurement pass;
    // existing ranges survive camera, paper, scroll and unrelated binding changes.
    for (const { surface } of loaded) {
      const required = [...(anchors.current.get(surface.surfaceId) ?? [])];
      if (surface.position.focus) required.push(surface.position.focus);
      for (const binding of props.bindings)
        for (const endpoint of [binding.from, binding.to])
          if (endpoint.surfaceId === surface.surfaceId)
            required.push(endpoint.anchor);
      if (
        required.some(
          (anchor) => !geometryOwner.hasAnchor(surface.surfaceId, anchor),
        )
      )
        geometryOwner.dirty = true;
    }
    for (const id of restored.current.keys())
      if (!loaded.some((entry) => entry.surface.surfaceId === id))
        restored.current.delete(id);
    const measure = geometryOwner.dirty;
    const restore = measure
      ? geometryOwner.measureLayout(worldRef.current, nodes.current)
      : () => {};
    const local = new Map<string, RangeRibbonMouthSegment[]>();
    const proxyMouths: ProxyMouth[] = [];
    try {
      for (const { surface } of loaded) {
        const scroll = nodes.current
          .get(surface.surfaceId)
          ?.querySelector<HTMLElement>("[data-document-scroll]");
        if (!scroll) continue;
        const key = `${surface.document.revisionId}:${props.presentation.id}`;
        if (restored.current.get(surface.surfaceId) !== key) {
          scroll.scrollTop = surface.position.scrollTop;
          const anchor = surface.position.focus;
          if (
            anchor &&
            props.presentation.kind === "align-ranges" &&
            props.presentation.surfaces.includes(surface.surfaceId)
          ) {
            const resolved = geometryOwner.resolveAnchor(
              surface.surfaceId,
              anchor,
              passages.current.get(surface.surfaceId),
              scroll,
              measure,
            );
            if (resolved?.fragments.length) {
              const top = Math.min(...resolved.fragments.map((r) => r.top)),
                bottom = Math.max(...resolved.fragments.map((r) => r.bottom));
              scroll.scrollTop = rangeScrollTarget(
                top,
                bottom,
                resolved.coverage === "complete",
                scroll.clientHeight,
                scroll.scrollHeight - scroll.clientHeight,
              );
            }
          }
          restored.current.set(surface.surfaceId, key);
        }
      }
      for (const { surface } of loaded) {
        const scroll = nodes.current
          .get(surface.surfaceId)
          ?.querySelector<HTMLElement>("[data-document-scroll]");
        for (const anchor of anchors.current.get(surface.surfaceId) ?? [])
          if (anchor.revisionId === surface.position.revisionId)
            geometryOwner.resolveAnchor(
              surface.surfaceId,
              anchor,
              passages.current.get(surface.surfaceId),
              scroll,
              measure,
            );
      }
      const byId = new Map(
        props.surfaces.map((surface) => [surface.surfaceId, surface]),
      );
      const bindings = new Map(
        props.bindings.map((binding) => [binding.connectionId, binding]),
      );
      for (const connection of props.connections) {
        const binding = bindings.get(connection.id);
        if (!binding) continue;
        for (const endpoint of ["from", "to"] as const) {
          const bound = binding[endpoint],
            opposite = binding[endpoint === "from" ? "to" : "from"];
          const surface = byId.get(bound.surfaceId),
            other = byId.get(opposite.surfaceId);
          const anchor = bound.anchor,
            declared = connection[endpoint];
          if (
            !surface ||
            !other ||
            anchor.revisionId !== surface.position.revisionId ||
            declared.documentId !== surface.position.documentId ||
            anchor.revisionId !== declared.revisionId ||
            anchor.start !== declared.start ||
            anchor.end !== declared.end
          )
            continue;
          const id = surface.surfaceId,
            layout = geometryOwner.layouts.get(id);
          if (!layout) continue;
          const pose = poseFor(view, id),
            otherPose = poseFor(view, other.surfaceId);
          const direction = vec3.transformQuat(
            vec3.create(),
            [
              otherPose.position.x - pose.position.x,
              otherPose.position.y - pose.position.y,
              otherPose.position.z - pose.position.z,
            ],
            quat.conjugate(quat.create(), pose.orientation),
          );
          const edge =
            Math.abs(direction[0]) >= Math.abs(direction[1])
              ? direction[0] >= 0
                ? "right"
                : "left"
              : direction[1] >= 0
                ? "bottom"
                : "top";
          const normal = vec3.transformQuat(
            vec3.create(),
            [0, 0, 0.7],
            pose.orientation,
          );
          const toWorld = (x: number, y: number) => {
            const p = paperToWorld(
              paperPoint(x, y),
              pose,
              layout.width,
              layout.height,
            );
            return worldPoint(
              p.x + normal[0],
              p.y + normal[1],
              p.z + normal[2],
            );
          };
          const mouth: RangeRibbonMouthSegment[] = [];
          const proxy = (reason: RangeRibbonProxyReason, top?: number) => {
            const x =
              edge === "left"
                ? 4
                : edge === "right"
                  ? layout.width - 4
                  : layout.width / 2;
            const y =
              top ??
              (edge === "top"
                ? 4
                : edge === "bottom"
                  ? layout.height - 4
                  : layout.height / 2);
            const horizontal = edge === "top" || edge === "bottom";
            mouth.push({
              start: horizontal ? toWorld(x - 9, y) : toWorld(x, y - 9),
              end: horizontal ? toWorld(x + 9, y) : toWorld(x, y + 9),
              provenance: { kind: "proxy", reason },
            });
            if (!isProjectionSafe([toWorld(x, y)], view.camera)) return;
            proxyMouths.push({
              key: `${connection.id}:${endpoint}:${reason}`,
              reason,
              color: relationStyle(connection.relation)["--relation-signal"],
              transform: `${paperTransform(pose, layout.width, layout.height)} translate3d(${Math.max(8, Math.min(layout.width - 118, x - 55))}px,${Math.max(8, Math.min(layout.height - 26, y - 9))}px,1px)`,
            });
          };
          const scroll = nodes.current
            .get(id)
            ?.querySelector<HTMLElement>("[data-document-scroll]");
          if (surface.payload !== "ready") proxy(surface.payload);
          else if (!desiredIds.has(id)) proxy("folded");
          else if (!scroll) proxy("outside-visible-text");
          else {
            const resolved = geometryOwner.resolveAnchor(
              id,
              anchor,
              passages.current.get(id),
              scroll,
              measure,
            );
            if (!resolved) proxy("outside-visible-text");
            else {
              const fragments = visibleAnchorFragments(
                resolved,
                layout,
                scroll,
              );
              for (const r of fragments) {
                const horizontal = edge === "top" || edge === "bottom";
                const x = edge === "left" ? r.left : r.right;
                const y = edge === "top" ? r.top : r.bottom;
                mouth.push({
                  start: horizontal ? toWorld(r.left, y) : toWorld(x, r.top),
                  end: horizontal ? toWorld(r.right, y) : toWorld(x, r.bottom),
                  provenance: { kind: "exact" },
                });
              }
              const outside = resolved.fragments.some(
                (r) =>
                  r.top < scroll.scrollTop ||
                  r.bottom > scroll.scrollTop + scroll.clientHeight ||
                  r.left < scroll.scrollLeft ||
                  r.right > scroll.scrollLeft + scroll.clientWidth,
              );
              if (
                outside ||
                resolved.coverage === "partial" ||
                (!fragments.length && resolved.coverage !== "unmapped")
              ) {
                const before =
                  resolved.fragments.length &&
                  resolved.fragments[0].top < scroll.scrollTop;
                proxy(
                  "outside-visible-text",
                  before ? layout.scroll.top + 9 : layout.scroll.bottom - 9,
                );
              }
              if (resolved.coverage === "unmapped") proxy("unmapped");
            }
          }
          local.set(`${connection.id}:${endpoint}`, mouth);
        }
      }
    } finally {
      restore();
      geometryOwner.dirty = false;
    }
    const result: Band[] = [];
    for (const connection of props.connections) {
      const from = local.get(`${connection.id}:from`),
        to = local.get(`${connection.id}:to`);
      if (!from || !to) continue;
      result.push({
        id: connection.id,
        triangles: clipRangeRibbonToCamera(
          buildRangeRibbon(from, to),
          view.camera,
        ),
        color: relationStyle(connection.relation)["--relation-signal"],
        label: connection.label || connection.relation,
      });
    }
    setProxies(proxyMouths);
    setBands(result);
  }, [
    loaded,
    desiredIds,
    props.surfaces,
    props.connections,
    props.bindings,
    props.presentation,
    viewport,
    view,
    measureEpoch,
    poseFor,
  ]);
  const scroll = useCallback((id: SurfaceInstanceId, top: number) => {
    propsRef.current.onScroll(id, top, propsRef.current.presentation.id);
    setMeasureEpoch((value) => value + 1);
  }, []);
  return (
    <div
      ref={viewportRef}
      className="spatial-scene"
      data-hit-role="stage"
      aria-label="三维文档空间"
      style={{ perspective: view.camera.perspective }}
      onPointerDown={(e) => interaction.current.pointerDown(e)}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          (event.target as Element).closest(
            "[data-paper],button,a,input,textarea,[role='button']",
          )
        )
          return;
        if (
          interaction.current.consumeClick() ||
          window.getSelection()?.isCollapsed === false
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ray = screenRay(
          screenPoint(event.clientX - rect.left, event.clientY - rect.top),
          view.camera,
          viewport,
        );
        let nearest: {
          band: Band;
          hit: NonNullable<ReturnType<typeof hitTestRangeRibbon>>;
        } | null = null;
        for (const band of bands) {
          const hit = hitTestRangeRibbon(ray, band.triangles);
          if (hit && (!nearest || hit.distance < nearest.hit.distance))
            nearest = { band, hit };
        }
        if (!nearest) return;
        for (const surface of props.surfaces) {
          const layout = geometry.current.layouts.get(surface.surfaceId);
          if (!layout) continue;
          const pose = poseFor(view, surface.surfaceId);
          const normal = vec3.transformQuat(
            vec3.create(),
            [0, 0, 1],
            pose.orientation,
          );
          // Match the paper's CSS backface-visibility: hidden when checking occlusion.
          if (
            normal[0] * ray.direction.x +
              normal[1] * ray.direction.y +
              normal[2] * ray.direction.z >=
            0
          )
            continue;
          const hit = intersectPaperRay(ray, pose, layout.width, layout.height);
          if (
            hit &&
            isProjectionSafe([hit.worldPoint], view.camera) &&
            hit.distance < nearest.hit.distance - 0.01
          )
            return;
        }
        const binding = props.bindings.find(
          (item) => item.connectionId === nearest.band.id,
        );
        if (!binding) return;
        const endpoint = nearest.hit.endpointWeight <= 0.5 ? "from" : "to";
        event.preventDefault();
        props.onFollow({
          connectionId: binding.connectionId,
          origin: {
            kind: "surface",
            surfaceId: binding[endpoint].surfaceId,
            endpoint,
          },
        });
      }}
      onPointerMove={(e) => interaction.current.pointerMove(e)}
      onPointerUp={(e) => interaction.current.pointerUp(e)}
      onPointerCancel={() => interaction.current.cancel()}
      onLostPointerCapture={(event) =>
        interaction.current.lostPointerCapture(event)
      }
      onKeyDown={(e) => {
        if (interaction.current.keyDown(e)) return;
        if (e.key === "Escape" && view.focus) {
          checkpoint({ ...view, focus: null });
        }
      }}
    >
      <div
        className="spatial-scene-world"
        ref={worldRef}
        style={{ transform: cameraTransform(view.camera) }}
      >
        {props.surfaces.map((surface, index) => (
          <ScenePaper
            key={surface.surfaceId}
            surface={surface}
            detailed={desiredIds.has(surface.surfaceId)}
            onRetry={props.onRetrySurface}
            pose={
              view.placements.get(surface.surfaceId) ?? defaultPaperPose(index)
            }
            viewport={viewport}
            register={register}
            registerPassage={registerPassage}
            invalidate={invalidate}
            registerAnchors={registerAnchors}
            hitTestAnchor={hitTestAnchor}
            onScroll={scroll}
            onFocus={focus}
            renderDocument={props.renderDocument}
            renderDocumentMenu={props.renderDocumentMenu}
          />
        ))}
        {bands.flatMap((band) =>
          band.triangles.map((triangle, index) => {
            const leaf = triangleLeafGeometry(triangle);
            return leaf ? (
              <div
                key={`${band.id}:${index}`}
                className="spatial-range-triangle"
                data-connection-id={band.id}
                aria-hidden="true"
                style={{
                  transform: matrixCss(leaf.matrix),
                  width: leaf.width,
                  height: leaf.height,
                  clipPath: `polygon(${leaf.points.map((point) => `${point.x}px ${point.y}px`).join(",")})`,
                  backgroundColor: `color-mix(in srgb, ${band.color} 30%, transparent)`,
                }}
              />
            ) : null;
          }),
        )}
        {proxies.map((proxy) => (
          <div
            key={proxy.key}
            className="spatial-range-proxy"
            data-proxy-status={proxy.reason}
            title={proxyLabels[proxy.reason]}
            style={{ transform: proxy.transform, borderColor: proxy.color }}
          >
            {proxyLabels[proxy.reason]}
          </div>
        ))}
      </div>
      <p className="spatial-gesture-hint">
        拖动空白环顾 · Shift 拖动平移 · 滚轮靠近 · 拖动纸边移动 · Shift
        拖动纸边调整远近
      </p>
    </div>
  );
}
